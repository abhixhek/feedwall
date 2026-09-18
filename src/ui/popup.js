(async function () {
  "use strict";
  const { topics: T, judge, sites } = globalThis.FW;
  const $ = (id) => document.getElementById(id);
  const SITE_NAMES = { x: "X", hackernews: "Hacker News", reddit: "Reddit", youtube: "YouTube", linkedin: "LinkedIn" };

  async function getSettings() {
    const { settings = {} } = await chrome.storage.local.get("settings");
    const merged = { ...judge.DEFAULT_SETTINGS, ...settings };
    merged.topics = T.migrate(merged);
    return merged;
  }
  async function saveSettings(patch) {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.local.set({ settings: next });
    return next;
  }

  let settings = await getSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let adapter = null;
  try {
    const url = new URL(tab.url);
    adapter = sites.adapterFor(url.hostname, url.pathname);
  } catch (error) { /* chrome:// pages and the like */ }

  $("enabled").checked = settings.enabled;
  $("strictness").value = settings.strictness;
  $("needs-key").hidden = Boolean(settings.apiKey);

  if (adapter) {
    $("site-name").textContent = SITE_NAMES[adapter.site];
    $("site-enabled").checked = !settings.disabledSites.includes(adapter.site);
    $("site-focus").checked = settings.focusSites.includes(adapter.site);
    const wanted = T.activeTopics(settings, adapter.site).filter((t) => T.WANTED.has(t.action));
    if (!wanted.length) { $("site-focus").disabled = true; $("focus-note").textContent = "needs a Keep or Highlight topic first"; }
    chrome.tabs.sendMessage(tab.id, { type: "health" }, (health) => {
      if (chrome.runtime.lastError || !health) { $("site-health").textContent = "Reload the page to start filtering."; return; }
      $("site-health").textContent = health.seen
        ? `${health.seen} posts found · ${health.hidden} hidden · ${health.marked} marked${health.filtered ? ` · ${health.filtered} filtered` : ""}`
        : "0 posts found on this page. If this is a feed, the site may have changed its layout.";
    });
  } else {
    $("site-name").textContent = "Not a supported page";
    $("site-health").textContent = "Works on X, YouTube, Reddit, LinkedIn and Hacker News.";
    $("site-enabled").disabled = true;
    $("site-focus").disabled = true;
  }

  const { counters = {} } = await chrome.storage.local.get("counters");
  const todays = counters.day === judge.today() ? counters : {};
  $("judged").textContent = (todays.judged || 0).toLocaleString();
  $("hidden").textContent = (todays.hidden || 0).toLocaleString();
  const cost = judge.costOf(todays.tokens || 0);
  $("cost").textContent = cost === 0 ? "$0" : cost < 0.01 ? "<1¢" : "$" + cost.toFixed(2);
  const notes = [];
  if (todays.cached) notes.push(`${todays.cached.toLocaleString()} answered from cache for free`);
  const { lastError } = await chrome.storage.local.get("lastError");
  if (todays.errors) {
    const recent = lastError && Date.now() - lastError.ts < 24 * 3600 * 1000 ? ` Last error: ${lastError.message}.` : "";
    notes.push(`${todays.errors} requests failed, so those posts were shown.${recent}`);
  }
  if ((todays.requests || 0) >= settings.dailyBudget) notes.push("daily budget reached, so filtering is paused until tomorrow");
  $("note").textContent = notes.join(" · ");

  $("enabled").addEventListener("change", (e) => saveSettings({ enabled: e.target.checked }));
  $("strictness").addEventListener("change", (e) => saveSettings({ strictness: e.target.value }));
  $("site-enabled").addEventListener("change", async (e) => {
    settings = await getSettings();
    const disabled = new Set(settings.disabledSites);
    if (e.target.checked) disabled.delete(adapter.site); else disabled.add(adapter.site);
    saveSettings({ disabledSites: [...disabled] });
  });
  $("site-focus").addEventListener("change", async (e) => {
    settings = await getSettings();
    const focus = new Set(settings.focusSites);
    if (e.target.checked) focus.add(adapter.site); else focus.delete(adapter.site);
    saveSettings({ focusSites: [...focus] });
  });
  const openOptions = (hash) => chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/options.html") + (hash || "") });
  $("open-options").addEventListener("click", () => openOptions());
  $("open-options-key").addEventListener("click", () => openOptions());
  $("open-review").addEventListener("click", () => openOptions("#review"));
})();
