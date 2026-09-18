(async function () {
  "use strict";
  const { rules, judge, stats } = globalThis.FW;
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  async function getSettings() {
    const { settings = {} } = await chrome.storage.local.get("settings");
    return { ...judge.DEFAULT_SETTINGS, ...settings };
  }
  async function save(patch) {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.local.set({ settings: next });
    return next;
  }

  let settings = await getSettings();

  // ---- key -------------------------------------------------------------------------------------------------------
  if (settings.apiKey) { $("api-key").placeholder = "Key saved. Paste a new one to replace it."; $("key-status").textContent = "A key is saved in this browser."; }
  $("save-key").addEventListener("click", async () => {
    const key = $("api-key").value.trim();
    if (!key) return;
    $("key-status").className = "muted";
    $("key-status").textContent = "Testing…";
    try {
      const response = await fetch(settings.baseUrl.replace(/\/$/, "") + "/v1/systemone", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ state: "Comment YES and I will DM you the guide.", model: settings.model,
                               questions: { t: { type: "noul", instructions: "Is this post engagement bait?" } } }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? "TypeSafe rejected this key." : `TypeSafe returned ${response.status}.`);
      const body = await response.json();
      settings = await save({ apiKey: key });
      $("api-key").value = "";
      $("key-status").className = "good";
      $("key-status").textContent = `Key works (answered by ${body.model || "Jev"}). Open a feed and scroll.`;
    } catch (error) {
      $("key-status").className = "bad";
      $("key-status").textContent = `Key not saved. ${error.message}`;
    }
  });

  // ---- rules -----------------------------------------------------------------------------------------------------
  function renderPresets() {
    $("presets").replaceChildren(...rules.PRESETS.map((preset) => {
      const box = el("input", { type: "checkbox", checked: settings.enabledPresets.includes(preset.id) });
      box.addEventListener("change", async () => {
        const enabled = new Set(settings.enabledPresets);
        if (box.checked) enabled.add(preset.id); else enabled.delete(preset.id);
        settings = await save({ enabledPresets: [...enabled] });
        renderReport();
      });
      return el("label", { className: "check" }, box, el("span", {}, el("strong", { textContent: preset.label }), el("br"), el("span", { className: "muted", textContent: preset.criteria.true })));
    }));
  }

  function renderCustoms() {
    $("customs").replaceChildren(...settings.customRules.map((rule) => {
      const remove = el("button", { className: "small", textContent: "Remove" });
      remove.addEventListener("click", async () => {
        settings = await save({ customRules: settings.customRules.filter((r) => r.id !== rule.id) });
        renderCustoms(); renderReport();
      });
      return el("div", { className: "list-item row between" }, el("span", { textContent: rule.label }), remove);
    }));
  }

  $("custom-text").addEventListener("input", () => {
    const warnings = rules.lintRule($("custom-text").value);
    $("custom-lint").textContent = $("custom-text").value.trim() ? warnings.map((w) => w.message).join(" ") : "";
  });
  $("add-custom").addEventListener("click", async () => {
    const text = $("custom-text").value.trim();
    if (text.split(/\s+/).length < 2) return;
    const rule = rules.makeCustomRule(text);
    if (!settings.customRules.some((r) => r.id === rule.id)) settings = await save({ customRules: settings.customRules.concat(rule) });
    $("custom-text").value = ""; $("custom-lint").textContent = "";
    renderCustoms(); renderReport();
  });

  // ---- behaviour -------------------------------------------------------------------------------------------------
  $("strictness").value = settings.strictness;
  $("dim").checked = settings.dimUncertain;
  $("blur").checked = settings.blurUntilJudged;
  $("budget").value = settings.dailyBudget;
  $("strictness").addEventListener("change", async (e) => { settings = await save({ strictness: e.target.value }); renderReport(); });
  $("dim").addEventListener("change", async (e) => { settings = await save({ dimUncertain: e.target.checked }); });
  $("blur").addEventListener("change", async (e) => { settings = await save({ blurUntilJudged: e.target.checked }); });
  $("budget").addEventListener("change", async (e) => { settings = await save({ dailyBudget: Math.max(100, Number(e.target.value) || 3000) }); });

  // ---- accuracy report -------------------------------------------------------------------------------------------
  async function renderReport() {
    const { feedback = [] } = await chrome.storage.local.get("feedback");
    const active = rules.activeRules(settings);
    $("report-note").textContent = `${feedback.length} marks so far`;
    const table = el("table", {}, el("tr", {}, ...["Rule", "Hides at", "Right", "Wrong", "Missed", ""].map((h) => el("th", { textContent: h }))));
    for (const rule of active) {
      const threshold = judge.thresholdFor(rule.id, settings);
      const report = stats.ruleReport(feedback, rule.id, threshold);
      const action = el("td");
      if (report.suggestion && report.suggestion.threshold) {
        const apply = el("button", { className: "small", textContent: `Use ${Math.round(report.suggestion.threshold * 100)}%` });
        apply.title = report.suggestion.reason;
        apply.addEventListener("click", async () => {
          settings = await save({ ruleThresholds: { ...settings.ruleThresholds, [rule.id]: report.suggestion.threshold } });
          renderReport();
        });
        action.append(apply);
      } else if (report.suggestion && report.suggestion.rewrite) {
        action.append(el("span", { className: "warn", textContent: "Reword this rule" , title: report.suggestion.reason }));
      } else if (typeof settings.ruleThresholds[rule.id] === "number") {
        const reset = el("button", { className: "small", textContent: "Reset" });
        reset.addEventListener("click", async () => {
          const next = { ...settings.ruleThresholds }; delete next[rule.id];
          settings = await save({ ruleThresholds: next }); renderReport();
        });
        action.append(reset);
      }
      table.append(el("tr", {}, el("td", { textContent: rule.label }), el("td", { textContent: Math.round(threshold * 100) + "%" }),
        el("td", { textContent: report.right }), el("td", { textContent: report.wrong, className: report.wrong ? "bad" : "" }),
        el("td", { textContent: report.missed }), action));
    }
    $("report").replaceChildren(active.length ? table : el("p", { className: "muted", textContent: "No rules are switched on." }));
  }

  // ---- recently hidden -------------------------------------------------------------------------------------------
  async function renderRecent() {
    const { recent = [], feedback = [] } = await chrome.storage.local.get(["recent", "feedback"]);
    const marked = new Map(feedback.map((f) => [f.key + "|" + f.ruleId, f.verdict]));
    const items = recent.slice().reverse().slice(0, 60).map((entry) => {
      const verdict = marked.get(entry.key + "|" + entry.ruleId);
      const mark = (value) => async () => {
        await chrome.runtime.sendMessage({ type: "feedback", entry: { key: entry.key, ruleId: entry.ruleId, p: entry.p, verdict: value, site: entry.site, state: entry.state } });
        renderRecent(); renderReport();
      };
      const right = el("button", { className: "small", textContent: verdict === "right" ? "✓ Right" : "Right" });
      const wrong = el("button", { className: "small", textContent: verdict === "wrong" ? "✕ Wrong" : "Wrong" });
      right.addEventListener("click", mark("right"));
      wrong.addEventListener("click", mark("wrong"));
      return el("div", { className: "list-item" },
        el("div", { className: "row" }, el("span", { className: "pill", textContent: entry.ruleLabel }), el("span", { className: "pill", textContent: Math.round(entry.p * 100) + "%" }),
          el("span", { className: "muted", textContent: `${entry.site}${entry.author ? " · " + entry.author : ""}` })),
        el("div", { className: "post-text", textContent: entry.text }),
        el("div", { className: "row" }, right, wrong));
    });
    $("recent").replaceChildren(...(items.length ? items : [el("p", { className: "muted", textContent: "Nothing hidden yet. Open a feed and scroll." })]));
  }
  $("clear-recent").addEventListener("click", async () => { await chrome.storage.local.set({ recent: [] }); renderRecent(); });

  // ---- export ----------------------------------------------------------------------------------------------------
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    el("a", { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("export-rows").addEventListener("click", async () => {
    const { feedback = [] } = await chrome.storage.local.get("feedback");
    download("data.jsonl", stats.toJevcalRows(feedback).map((row) => JSON.stringify(row)).join("\n") + "\n");
  });
  $("export-questions").addEventListener("click", () => download("questions.yaml", stats.toJevcalQuestionsYaml(rules.activeRules(settings), settings.model)));

  renderPresets(); renderCustoms(); renderReport(); renderRecent();
  if (location.hash === "#review") $("review").scrollIntoView();
})();
