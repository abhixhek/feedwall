// Service worker. Holds the API key and makes every model request; content scripts never see the key or the network.
// (The options page makes one direct request when you press "Save and test", before the key is stored.)
importScripts("core/topics.js", "core/judge.js", "core/stats.js");

const { topics: T, judge, stats } = self.FW;
const CONCURRENCY = 6;
const TIMEOUT_MS = 8000;
const CACHE_MAX = 4000;
const RECENT_MAX = 300;
const SEEN_MAX = 200; // recent posts kept locally so a new topic can be tried on real posts before it is saved

let settings = null;
let cache = null; // key -> { probabilities }
let seen = null; // recent post states, newest last
let dirty = false;
let running = 0;
const waiting = [];

// Several posts are judged at once, and storage has no transactions: run every read-modify-write one at a time.
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));

function withTopics(stored) {
  const merged = { ...judge.DEFAULT_SETTINGS, ...(stored || {}) };
  merged.topics = T.migrate(merged);
  return merged;
}

async function load() {
  if (settings && cache && seen) return;
  const stored = await chrome.storage.local.get(["settings", "cache", "seen"]);
  settings = withTopics(stored.settings);
  cache = stored.cache || {};
  seen = stored.seen || [];
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) settings = withTopics(changes.settings.newValue);
});

function persistSoon() {
  if (dirty) return;
  dirty = true;
  setTimeout(async () => {
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) for (const key of keys.slice(0, keys.length - CACHE_MAX)) delete cache[key];
    await chrome.storage.local.set({ cache, seen });
    dirty = false;
  }, 3000);
}

const bumpCounters = (delta) => serial(async () => {
  const day = judge.today();
  const { counters = {} } = await chrome.storage.local.get("counters");
  const todayCounters = counters.day === day ? counters : { day, judged: 0, hidden: 0, dimmed: 0, marked: 0, filtered: 0, cached: 0, errors: 0, tokens: 0, requests: 0 };
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

function rememberSeen(key, state) {
  if (seen.some((s) => s.key === key)) return;
  const { reader, ...post } = state; // "about me" is added fresh at test time, not stored with every post
  seen.push({ key, state: { ...post, text: judge.clip(post.text, 400) } });
  if (seen.length > SEEN_MAX) seen.splice(0, seen.length - SEEN_MAX);
  persistSoon();
}

function slot() {
  if (running < CONCURRENCY) { running++; return Promise.resolve(); }
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else running--;
}

async function callModel(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(settings.baseUrl.replace(/\/$/, "") + "/v1/systemone", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${settings.apiKey.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`model API returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const describe = (error) => (error && error.name === "AbortError" ? "the model took longer than 8 seconds" : (error && error.message) || "unknown");

// Every failure path returns "show": a filter that hides things when it breaks is worse than no filter.
async function judgeItem(item) {
  await load();
  const show = (reason) => ({ action: "show", reason });
  if (!settings.enabled) return show("off");
  if (!settings.apiKey) return show("no_key");
  if ((settings.disabledSites || []).includes(item.site)) return show("site_off");
  if (!judge.isJudgeable(item)) return show("too_short");

  const active = T.activeTopics(settings, item.site);
  if (!active.length) return show("no_topics");

  const state = judge.buildState(item, settings.aboutMe);
  const postKey = T.hashString(item.site + "|" + state.text);
  const key = postKey + "." + T.questionsVersion(active, settings.aboutMe);
  rememberSeen(postKey, state);

  if (cache[key]) {
    bumpCounters({ cached: 1 });
    // actions and thresholds may have moved since this was cached, so decide again from the stored probabilities
    return { ...judge.decide(cache[key].probabilities, active, settings, item.site), key, cached: true };
  }

  const counters = await bumpCounters({});
  if (counters.requests >= settings.dailyBudget) return show("budget");

  await slot();
  try {
    const response = await callModel({ state, model: settings.model, questions: T.toQuestions(active) });
    const probabilities = judge.parseAnswers(response, active.map((t) => t.id));
    cache[key] = { probabilities };
    persistSoon();
    const decision = judge.decide(probabilities, active, settings, item.site);
    await bumpCounters({
      requests: 1, judged: 1, tokens: (response.usage && response.usage.input_tokens) || 0,
      hidden: decision.action === "hide" ? 1 : 0, dimmed: decision.action === "dim" ? 1 : 0,
      marked: decision.action === "keep" || decision.action === "highlight" ? 1 : 0, filtered: decision.action === "filter" ? 1 : 0,
    });
    if (decision.action === "hide") {
      const topic = active.find((t) => t.id === decision.topicId);
      await rememberHidden({ key, ts: Date.now(), site: item.site, topicId: decision.topicId, topicName: topic ? topic.name : decision.topicId,
                             p: decision.p, text: judge.clip(item.text, 280), author: item.author || "", state });
    }
    return { ...decision, key };
  } catch (error) {
    const message = describe(error);
    await bumpCounters({ requests: 1, errors: 1 });
    await serial(() => chrome.storage.local.set({ lastError: { ts: Date.now(), message } })); // failing open must not mean failing silently
    return show("error:" + message);
  } finally {
    release();
  }
}

// "Test it": run one draft topic over the posts the reader recently scrolled past. One request per post, one question each.
async function testTopic(draft, limit) {
  await load();
  const topic = T.sanitizeTopic(draft);
  if (!topic) return { error: "Describe the topic first." };
  if (!settings.apiKey) return { error: "Add your API key first." };
  const sample = seen.slice(-Math.min(limit || 60, SEEN_MAX)).reverse();
  if (!sample.length) return { error: "No recent posts yet. Scroll a feed for a minute, then try again." };
  const counters = await bumpCounters({});
  if (counters.requests + sample.length > settings.dailyBudget) return { error: "This test would go past today's request limit." };

  const questions = { t: T.toQuestion(topic) };
  let tokens = 0;
  const results = await Promise.all(sample.map(async (entry) => {
    await slot();
    try {
      const state = settings.aboutMe ? { ...entry.state, reader: judge.clip(settings.aboutMe, 300) } : entry.state;
      const response = await callModel({ state, model: settings.model, questions });
      tokens += (response.usage && response.usage.input_tokens) || 0;
      const p = judge.parseAnswers(response, ["t"]).t;
      return typeof p === "number" ? { key: entry.key, p, text: entry.state.text, site: entry.state.site, author: entry.state.author || "", state: entry.state } : null;
    } catch (error) {
      return null;
    } finally {
      release();
    }
  }));
  const ok = results.filter(Boolean).sort((a, b) => b.p - a.p);
  await bumpCounters({ requests: sample.length, tokens, errors: sample.length - ok.length });
  return { results: ok, failed: sample.length - ok.length, tokens, threshold: judge.thresholdFor(topic, settings) };
}

const recordFeedback = (entry) => serial(async () => {
  const { feedback = [] } = await chrome.storage.local.get("feedback");
  await chrome.storage.local.set({ feedback: stats.addFeedback(feedback, { ...entry, ts: Date.now() }) });
  return { ok: true };
});

// "Teach this as an example": the post's text becomes part of the topic's wording, so it is an explicit reader action.
const addExample = ({ topicId, side, text }) => serial(async () => {
  await load();
  const next = settings.topics.map((topic) => {
    if (topic.id !== topicId) return topic;
    const examples = { yes: [...topic.examples.yes], no: [...topic.examples.no] };
    const clipped = T.clean(text, T.LIMITS.example);
    const list = side === "no" ? examples.no : examples.yes;
    if (clipped && !list.includes(clipped)) list.push(clipped);
    return T.sanitizeTopic({ ...topic, examples });
  });
  const { settings: stored = {} } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...stored, topics: next } });
  return { ok: true };
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    judge: () => judgeItem(message.item),
    feedback: () => recordFeedback(message.entry),
    addExample: () => addExample(message),
    testTopic: () => testTopic(message.topic, message.limit),
    getSettings: async () => { await load(); const { apiKey, ...safe } = settings; return { ...safe, hasKey: Boolean(apiKey) }; },
    clearSeen: async () => { await load(); seen = []; await chrome.storage.local.set({ seen }); return { ok: true }; },
  };
  const handler = handlers[message && message.type];
  if (!handler) return false;
  handler().then(sendResponse, (error) => sendResponse({ action: "show", reason: "error:" + error.message, error: error.message }));
  return true; // async response
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await load();
  if (reason === "install" && !settings.apiKey) chrome.runtime.openOptionsPage();
});
