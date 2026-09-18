// Service worker. Holds the API key and makes every model request; content scripts never see the key or the network.
// (The options page makes one direct request when you press "Save and test", before the key is stored.)
importScripts("core/rules.js", "core/judge.js", "core/stats.js");

const { rules, judge, stats } = self.FW;
const CONCURRENCY = 6;
const TIMEOUT_MS = 8000;
const CACHE_MAX = 4000;
const RECENT_MAX = 300;

let settings = null;
let cache = null; // key -> decision
let cacheDirty = false;
let running = 0;
const waiting = [];

// Several posts are judged at once, and storage has no transactions: run every read-modify-write one at a time.
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));

async function load() {
  if (settings && cache) return;
  const stored = await chrome.storage.local.get(["settings", "cache"]);
  settings = { ...judge.DEFAULT_SETTINGS, ...(stored.settings || {}) };
  cache = stored.cache || {};
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) settings = { ...judge.DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
});

function persistCacheSoon() {
  if (cacheDirty) return;
  cacheDirty = true;
  setTimeout(async () => {
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) for (const key of keys.slice(0, keys.length - CACHE_MAX)) delete cache[key];
    await chrome.storage.local.set({ cache });
    cacheDirty = false;
  }, 3000);
}

const bumpCounters = (delta) => serial(async () => {
  const day = judge.today();
  const { counters = {} } = await chrome.storage.local.get("counters");
  const todayCounters = counters.day === day ? counters : { day, judged: 0, hidden: 0, dimmed: 0, cached: 0, errors: 0, tokens: 0, requests: 0 };
  for (const [key, value] of Object.entries(delta)) todayCounters[key] = (todayCounters[key] || 0) + value;
  await chrome.storage.local.set({ counters: todayCounters });
  return todayCounters;
});

const rememberHidden = (entry) => serial(async () => {
  const { recent = [] } = await chrome.storage.local.get("recent");
  const next = recent.filter((r) => r.key !== entry.key);
  next.push(entry);
  await chrome.storage.local.set({ recent: next.slice(-RECENT_MAX) });
});

function slot() {
  if (running < CONCURRENCY) { running++; return Promise.resolve(); }
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else running--;
}

async function callModel(item, activeRules) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(settings.baseUrl.replace(/\/$/, "") + "/v1/systemone", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${settings.apiKey.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify(judge.buildRequest(item, rules.toQuestions(activeRules), settings.model)),
    });
    if (!response.ok) throw new Error(`model API returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Every failure path returns "show": a filter that hides things when it breaks is worse than no filter.
async function judgeItem(item) {
  await load();
  const show = (reason) => ({ action: "show", reason });
  if (!settings.enabled) return show("off");
  if (!settings.apiKey) return show("no_key");
  if ((settings.disabledSites || []).includes(item.site)) return show("site_off");
  if (!judge.isJudgeable(item)) return show("too_short");

  const activeRules = rules.activeRules(settings);
  if (!activeRules.length) return show("no_rules");

  const key = rules.hashString(item.site + "|" + judge.clip(item.text, 1500)) + "." + rules.rulesVersion(activeRules);
  if (cache[key]) {
    bumpCounters({ cached: 1 });
    // thresholds may have moved since this was cached, so decide again from the stored probabilities
    return { ...judge.decide(cache[key].probabilities, settings), key, cached: true };
  }

  const counters = await bumpCounters({});
  if (counters.requests >= settings.dailyBudget) return show("budget");

  await slot();
  try {
    const response = await callModel(item, activeRules);
    const probabilities = judge.parseAnswers(response, activeRules.map((r) => r.id));
    cache[key] = { probabilities };
    persistCacheSoon();
    const decision = judge.decide(probabilities, settings);
    await bumpCounters({
      requests: 1, judged: 1, tokens: (response.usage && response.usage.input_tokens) || 0,
      hidden: decision.action === "hide" ? 1 : 0, dimmed: decision.action === "dim" ? 1 : 0,
    });
    if (decision.action === "hide") {
      const rule = activeRules.find((r) => r.id === decision.ruleId);
      await rememberHidden({ key, ts: Date.now(), site: item.site, ruleId: decision.ruleId, ruleLabel: rule ? rule.label : decision.ruleId,
                             p: decision.p, text: judge.clip(item.text, 280), author: item.author || "", state: judge.buildState(item) });
    }
    return { ...decision, key };
  } catch (error) {
    const message = error && error.name === "AbortError" ? "the model took longer than 8 seconds" : (error && error.message) || "unknown";
    await bumpCounters({ requests: 1, errors: 1 });
    await serial(() => chrome.storage.local.set({ lastError: { ts: Date.now(), message } })); // failing open must not mean failing silently
    return show("error:" + message);
  } finally {
    release();
  }
}

const recordFeedback = (entry) => serial(async () => {
  const { feedback = [] } = await chrome.storage.local.get("feedback");
  await chrome.storage.local.set({ feedback: stats.addFeedback(feedback, { ...entry, ts: Date.now() }) });
  return { ok: true };
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    judge: () => judgeItem(message.item),
    feedback: () => recordFeedback(message.entry),
    getSettings: async () => { await load(); const { apiKey, ...safe } = settings; return { ...safe, hasKey: Boolean(apiKey) }; },
    activeRules: async () => { await load(); return rules.activeRules(settings).map((r) => ({ id: r.id, label: r.label })); },
  };
  const handler = handlers[message && message.type];
  if (!handler) return false;
  handler().then(sendResponse, (error) => sendResponse({ action: "show", reason: "error:" + error.message }));
  return true; // async response
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await load();
  if (reason === "install" && !settings.apiKey) chrome.runtime.openOptionsPage();
});
