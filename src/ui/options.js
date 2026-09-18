(async function () {
  "use strict";
  const { topics: T, judge, stats } = globalThis.FW;
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter((c) => c != null));
    return node;
  };
  const SITES = [["x", "X"], ["youtube", "YouTube"], ["reddit", "Reddit"], ["linkedin", "LinkedIn"], ["hackernews", "Hacker News"]];
  const ACTION_LABEL = { keep: "Keep", highlight: "Highlight", dim: "Dim", hide: "Hide" };

  async function getSettings() {
    const { settings = {} } = await chrome.storage.local.get("settings");
    const merged = { ...judge.DEFAULT_SETTINGS, ...settings };
    merged.topics = T.migrate(merged);
    return merged;
  }
  async function save(patch) {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.local.set({ settings: next });
    return next;
  }

  let settings = await getSettings();
  const saveTopics = async (topics) => { settings = await save({ topics: topics.slice(0, T.MAX_TOPICS) }); renderTopics(); renderReport(); };

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

  // ---- about you -------------------------------------------------------------------------------------------------
  $("about-me").value = settings.aboutMe || "";
  $("about-me").addEventListener("change", async (e) => { settings = await save({ aboutMe: T.clean(e.target.value, T.LIMITS.aboutMe) }); renderCost(); });

  // ---- topics list -----------------------------------------------------------------------------------------------
  function renderCost() {
    const active = T.activeTopics(settings);
    const perThousand = judge.costOf(T.estimateTokens(active, settings.aboutMe)) * 1000;
    $("cost-note").textContent = active.length ? `${active.length} active · about $${perThousand.toFixed(3)} per 1,000 posts` : "no active topics";
  }

  function renderTopics() {
    const rows = settings.topics.map((topic) => {
      const on = el("input", { type: "checkbox", checked: topic.enabled !== false, title: "Switch this topic on or off" });
      on.addEventListener("change", () => saveTopics(settings.topics.map((t) => (t.id === topic.id ? { ...t, enabled: on.checked } : t))));
      const action = el("select", {}, ...T.ACTIONS.slice().reverse().map((a) => el("option", { value: a, textContent: ACTION_LABEL[a], selected: a === topic.action })));
      action.addEventListener("change", () => saveTopics(settings.topics.map((t) => (t.id === topic.id ? { ...t, action: action.value } : t))));
      const edit = el("button", { className: "small", textContent: "Edit" });
      edit.addEventListener("click", () => openEditor(topic));
      const where = topic.sites ? topic.sites.map((s) => (SITES.find((x) => x[0] === s) || [s, s])[1]).join(", ") : "all sites";
      const taught = topic.examples.yes.length + topic.examples.no.length;
      return el("div", { className: "list-item topic-row" + (topic.enabled === false ? " off" : "") },
        el("div", { className: "row between" },
          el("label", { className: "row", style: "gap:8px;flex:1;min-width:0" }, on, el("strong", { textContent: topic.name }),
            el("span", { className: "pill " + (T.WANTED.has(topic.action) ? "want" : ""), textContent: ACTION_LABEL[topic.action] })),
          el("div", { className: "row" }, action, edit)),
        el("div", { className: "muted", textContent: `${topic.description} · ${where}${topic.threshold ? ` · needs ${Math.round(topic.threshold * 100)}%` : ""}${taught ? ` · ${taught} example${taught > 1 ? "s" : ""}` : ""}` }));
    });
    $("topics").replaceChildren(...(rows.length ? rows : [el("p", { className: "muted", textContent: "No topics yet. Add one, or start from a set below." })]));
    const have = new Set(settings.topics.map((t) => t.id));
    $("library").replaceChildren(el("option", { value: "", textContent: "Add from the starter library…" }),
      ...T.LIBRARY.filter((t) => !have.has(t.id)).map((t) => el("option", { value: t.id, textContent: `${t.name} (${ACTION_LABEL[t.action]})` })));
    renderCost();
  }
  $("library").addEventListener("change", (e) => {
    const topic = T.fromLibrary(e.target.value);
    if (topic) saveTopics(settings.topics.concat(topic));
  });

  // ---- topic editor ----------------------------------------------------------------------------------------------
  let editing = null; // the topic being edited, or null for a new one
  function draftFromForm() {
    const sites = SITES.map(([id]) => id).filter((id) => $("site-" + id).checked);
    return T.sanitizeTopic({
      id: editing ? editing.id : undefined,
      name: $("t-name").value, description: $("t-description").value, counts: $("t-counts").value, notCounts: $("t-not").value,
      action: $("t-action").value, threshold: $("t-threshold").value ? Number($("t-threshold").value) : null,
      sites: sites.length === SITES.length ? null : sites,
      examples: editing ? editing.examples : { yes: [], no: [] }, enabled: editing ? editing.enabled : true,
    });
  }

  function openEditor(topic) {
    editing = topic || null;
    $("editor").hidden = false;
    $("editor-title").textContent = topic ? `Edit "${topic.name}"` : "New topic";
    $("t-name").value = topic ? topic.name : "";
    $("t-description").value = topic ? topic.description : "";
    $("t-counts").value = topic ? topic.counts : "";
    $("t-not").value = topic ? topic.notCounts : "";
    $("t-action").value = topic ? topic.action : "highlight";
    $("t-threshold").value = topic && topic.threshold ? String(topic.threshold) : "";
    if (topic && topic.threshold && ![...$("t-threshold").options].some((o) => o.value === String(topic.threshold))) {
      $("t-threshold").append(el("option", { value: String(topic.threshold), textContent: `${Math.round(topic.threshold * 100)}% (suggested)`, selected: true }));
    }
    $("t-sites").replaceChildren(...SITES.map(([id, label]) => el("label", { className: "row", style: "gap:5px" },
      el("input", { type: "checkbox", id: "site-" + id, checked: !topic || !topic.sites || topic.sites.includes(id) }), label)));
    $("t-delete").hidden = !topic;
    $("t-test-out").replaceChildren();
    $("t-lint").textContent = "";
    renderExamples();
    $("editor").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderExamples() {
    const examples = editing ? editing.examples : { yes: [], no: [] };
    const all = [...examples.yes.map((text) => ["yes", text]), ...examples.no.map((text) => ["no", text])];
    $("t-examples-wrap").hidden = !all.length;
    $("t-examples").replaceChildren(...all.map(([side, text]) => {
      const remove = el("button", { className: "small", textContent: "Remove" });
      remove.addEventListener("click", () => { editing = { ...editing, examples: { ...editing.examples, [side]: editing.examples[side].filter((t) => t !== text) } }; renderExamples(); });
      return el("div", { className: "list-item row between" }, el("span", { className: "post-text", textContent: `${side === "yes" ? "Fits" : "Does not fit"}: ${text}` }), remove);
    }));
  }

  $("t-description").addEventListener("input", () => {
    $("t-lint").textContent = $("t-description").value.trim() ? T.lintTopic($("t-description").value).map((w) => w.message).join(" ") : "";
  });
  $("new-topic").addEventListener("click", () => openEditor(null));
  $("t-cancel").addEventListener("click", () => { $("editor").hidden = true; });
  $("t-delete").addEventListener("click", async () => { await saveTopics(settings.topics.filter((t) => t.id !== editing.id)); $("editor").hidden = true; });
  $("t-save").addEventListener("click", async () => {
    const draft = draftFromForm();
    if (!draft) { $("t-lint").textContent = "Give the topic a name and say what the posts are."; return; }
    const exists = settings.topics.some((t) => t.id === draft.id);
    await saveTopics(exists ? settings.topics.map((t) => (t.id === draft.id ? draft : t)) : settings.topics.concat(draft));
    $("editor").hidden = true;
  });

  // "Test it": the draft is run over posts you actually scrolled past, before you commit to it.
  $("t-test").addEventListener("click", async () => {
    const draft = draftFromForm();
    const out = $("t-test-out");
    if (!draft) { out.replaceChildren(el("p", { className: "warn", textContent: "Give the topic a name and say what the posts are first." })); return; }
    out.replaceChildren(el("p", { className: "muted", textContent: "Asking the model about your recent posts…" }));
    const reply = await chrome.runtime.sendMessage({ type: "testTopic", topic: draft, limit: 60 });
    if (!reply || reply.error) { out.replaceChildren(el("p", { className: "warn", textContent: (reply && reply.error) || "The test did not run." })); return; }
    const count = (t) => reply.results.filter((r) => r.p >= t).length;
    const bar = Number($("t-threshold").value) || reply.threshold;
    const summary = el("p", {}, el("strong", { textContent: `${count(bar)} of ${reply.results.length} recent posts fit at ${Math.round(bar * 100)}%. ` }),
      el("span", { className: "muted", textContent: `At 60%: ${count(0.6)} · 75%: ${count(0.75)} · 90%: ${count(0.9)}. Cost of this test: ${judge.costOf(reply.tokens) < 0.01 ? "under 1¢" : "$" + judge.costOf(reply.tokens).toFixed(2)}.${reply.failed ? ` ${reply.failed} requests failed.` : ""}` }));
    const hint = count(0.9) === 0 && count(0.5) > 0
      ? el("p", { className: "warn", textContent: "Nothing scores above 90%. The model is unsure what you mean: add 'What counts' and 'What doesn't count', or make the description more concrete." })
      : null;
    const rows = reply.results.slice(0, 40).map((r) => {
      const fits = r.p >= bar;
      const verdict = (value, label) => {
        const b = el("button", { className: "small", textContent: label });
        b.addEventListener("click", async () => {
          await chrome.runtime.sendMessage({ type: "feedback", entry: { key: r.key, topicId: draft.id, p: r.p, verdict: value, site: r.site, state: r.state } });
          b.textContent = "✓ " + label; renderReport();
        });
        return b;
      };
      return el("div", { className: "list-item" + (fits ? "" : " below") },
        el("div", { className: "row" }, el("span", { className: "pill " + (fits ? "want" : ""), textContent: Math.round(r.p * 100) + "%" }),
          el("span", { className: "muted", textContent: `${r.site}${r.author ? " · " + r.author : ""}` })),
        el("div", { className: "post-text", textContent: r.text }),
        el("div", { className: "row" }, fits ? verdict("right", "Right, it fits") : verdict("missed", "This should fit"), fits ? verdict("wrong", "Wrong") : null));
    });
    out.replaceChildren(summary, hint, ...rows);
  });

  // ---- sets ------------------------------------------------------------------------------------------------------
  function previewSet(set) {
    const list = el("div", {}, ...set.topics.map((t) => el("div", { className: "list-item" },
      el("span", { className: "pill " + (T.WANTED.has(t.action) ? "want" : ""), textContent: ACTION_LABEL[t.action] }), " ", el("strong", { textContent: t.name }),
      el("div", { className: "muted", textContent: t.description }))));
    const apply = (mode) => async () => {
      const merged = mode === "replace" ? set.topics : settings.topics.filter((t) => !set.topics.some((s) => s.id === t.id)).concat(set.topics);
      settings = await save({ topics: merged.slice(0, T.MAX_TOPICS), aboutMe: mode === "replace" || !settings.aboutMe ? set.aboutMe : settings.aboutMe });
      $("about-me").value = settings.aboutMe; $("set-preview").replaceChildren(el("p", { className: "good", textContent: `"${set.name}" applied.` }));
      renderTopics(); renderReport();
    };
    const replace = el("button", { className: "primary", textContent: "Replace my topics with this set" });
    const add = el("button", { textContent: "Add to my topics" });
    replace.addEventListener("click", apply("replace")); add.addEventListener("click", apply("add"));
    $("set-preview").replaceChildren(el("p", {}, el("strong", { textContent: set.name }), set.aboutMe ? el("span", { className: "muted", textContent: ` · About you: ${set.aboutMe}` }) : null),
      list, el("div", { className: "row", style: "margin-top:10px" }, replace, add));
  }
  $("built-in-sets").replaceChildren(...T.BUILT_IN_SETS.map((set) => {
    const b = el("button", { textContent: set.name });
    b.addEventListener("click", () => previewSet({ name: set.name, aboutMe: set.aboutMe, topics: T.topicsFromSet(set) }));
    return b;
  }));
  $("import-set").addEventListener("click", () => {
    try { previewSet(T.importSet($("import-code").value)); }
    catch (error) { $("set-preview").replaceChildren(el("p", { className: "bad", textContent: error.message })); }
  });
  $("export-set").addEventListener("click", async () => {
    const code = T.exportSet("My Feedwall set", settings);
    try { await navigator.clipboard.writeText(code); $("set-preview").replaceChildren(el("p", { className: "good", textContent: "Copied. Paste it anywhere; whoever imports it sees a preview first." })); }
    catch (error) { $("import-code").value = code; $("import-code").select(); }
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
  $("focus-sites").replaceChildren(...SITES.map(([id, label]) => {
    const box = el("input", { type: "checkbox", checked: settings.focusSites.includes(id) });
    box.addEventListener("change", async () => {
      const next = new Set(settings.focusSites);
      if (box.checked) next.add(id); else next.delete(id);
      settings = await save({ focusSites: [...next] });
    });
    return el("label", { className: "row", style: "gap:5px" }, box, label);
  }));

  // ---- accuracy report -------------------------------------------------------------------------------------------
  async function renderReport() {
    const { feedback = [] } = await chrome.storage.local.get("feedback");
    $("report-note").textContent = `${feedback.length} marks so far`;
    const table = el("table", {}, el("tr", {}, ...["Topic", "Acts at", "Right", "Wrong", "Missed", ""].map((h) => el("th", { textContent: h }))));
    for (const topic of settings.topics) {
      const threshold = judge.thresholdFor(topic, settings);
      const report = stats.topicReport(feedback, topic.id, threshold);
      const action = el("td");
      const setThreshold = (value) => saveTopics(settings.topics.map((t) => (t.id === topic.id ? { ...t, threshold: value } : t)));
      if (report.suggestion && report.suggestion.threshold) {
        const apply = el("button", { className: "small", textContent: `Use ${Math.round(report.suggestion.threshold * 100)}%`, title: report.suggestion.reason });
        apply.addEventListener("click", () => setThreshold(report.suggestion.threshold));
        action.append(apply);
      } else if (report.suggestion && report.suggestion.rewrite) {
        action.append(el("span", { className: "warn", textContent: "Reword this topic", title: report.suggestion.reason }));
      } else if (typeof topic.threshold === "number") {
        const reset = el("button", { className: "small", textContent: "Reset" });
        reset.addEventListener("click", () => setThreshold(null));
        action.append(reset);
      }
      table.append(el("tr", {}, el("td", { textContent: `${topic.name} (${ACTION_LABEL[topic.action]})` }), el("td", { textContent: Math.round(threshold * 100) + "%" }),
        el("td", { textContent: report.right }), el("td", { textContent: report.wrong, className: report.wrong ? "bad" : "" }),
        el("td", { textContent: report.missed }), action));
    }
    $("report").replaceChildren(settings.topics.length ? table : el("p", { className: "muted", textContent: "No topics yet." }));
  }

  // ---- recently hidden -------------------------------------------------------------------------------------------
  async function renderRecent() {
    const { recent = [], feedback = [] } = await chrome.storage.local.get(["recent", "feedback"]);
    const marked = new Map(feedback.map((f) => [f.key + "|" + (f.topicId || f.ruleId), f.verdict]));
    const items = recent.slice().reverse().slice(0, 60).map((entry) => {
      const topicId = entry.topicId || entry.ruleId;
      const verdict = marked.get(entry.key + "|" + topicId);
      const mark = (value) => async () => {
        await chrome.runtime.sendMessage({ type: "feedback", entry: { key: entry.key, topicId, p: entry.p, verdict: value, site: entry.site, state: entry.state } });
        renderRecent(); renderReport();
      };
      const right = el("button", { className: "small", textContent: verdict === "right" ? "✓ Right" : "Right" });
      const wrong = el("button", { className: "small", textContent: verdict === "wrong" ? "✕ Wrong" : "Wrong" });
      right.addEventListener("click", mark("right"));
      wrong.addEventListener("click", mark("wrong"));
      return el("div", { className: "list-item" },
        el("div", { className: "row" }, el("span", { className: "pill", textContent: entry.topicName || entry.ruleLabel || topicId }), el("span", { className: "pill", textContent: Math.round(entry.p * 100) + "%" }),
          el("span", { className: "muted", textContent: `${entry.site}${entry.author ? " · " + entry.author : ""}` })),
        el("div", { className: "post-text", textContent: entry.text }),
        el("div", { className: "row" }, right, wrong));
    });
    $("recent").replaceChildren(...(items.length ? items : [el("p", { className: "muted", textContent: "Nothing hidden yet. Open a feed and scroll." })]));
  }
  $("clear-recent").addEventListener("click", async () => { await chrome.storage.local.set({ recent: [] }); renderRecent(); });

  // ---- your data -------------------------------------------------------------------------------------------------
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    el("a", { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("export-rows").addEventListener("click", async () => {
    const { feedback = [] } = await chrome.storage.local.get("feedback");
    download("data.jsonl", stats.toJevcalRows(feedback).map((row) => JSON.stringify(row)).join("\n") + "\n");
  });
  $("export-questions").addEventListener("click", () => download("questions.yaml", stats.toJevcalQuestionsYaml(T.toQuestions(settings.topics), settings.model)));
  $("clear-seen").addEventListener("click", async (e) => { await chrome.runtime.sendMessage({ type: "clearSeen" }); e.target.textContent = "Forgotten"; });

  renderTopics(); renderReport(); renderRecent();
  if (location.hash === "#review") $("review").scrollIntoView();
})();
