// Content script: finds posts, asks the background worker for a decision, and applies it to the page.
// It never sees the API key and never makes network requests itself.
(function () {
  "use strict";
  const { sites } = globalThis.FW;
  const PREFETCH_MARGIN = "3000px 0px"; // judge posts well before they scroll into view, so there is no flash
  const PENDING_TIMEOUT_MS = 3000;
  const MEMO_MAX = 600;

  let settings = null;
  let topicsById = {};
  const health = { site: null, seen: 0, judged: 0, hidden: 0, dimmed: 0, marked: 0, filtered: 0, errors: 0 };

  // Decisions already made on this page, keyed by post text. React-driven sites (X) throw post elements away and
  // rebuild them while you scroll; remembering the decision lets a rebuilt post get the same treatment at once,
  // with no request and no flash.
  const memo = new Map();
  const memoKey = (item) => item.site + "|" + (item.text || "").slice(0, 1500);
  function remember(item, decision) {
    memo.set(memoKey(item), decision);
    if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
  }

  const adapter = () => sites.adapterFor(location.hostname, location.pathname);

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (reply) => resolve(chrome.runtime.lastError ? null : reply));
      } catch (error) {
        resolve(null); // extension was reloaded; fail open
      }
    });
  }

  async function refreshSettings() {
    settings = (await send({ type: "getSettings" })) || { enabled: false };
    topicsById = Object.fromEntries((settings.topics || []).map((t) => [t.id, t]));
  }

  const siteEnabled = (a) => settings && settings.enabled && settings.hasKey && !(settings.disabledSites || []).includes(a.site);
  const topicsHere = (a) => (settings.topics || []).filter((t) => t.enabled !== false && (!t.sites || t.sites.includes(a.site)));
  const nameOf = (id) => (topicsById[id] ? topicsById[id].name : id);
  const pct = (p) => (typeof p === "number" ? ` · ${Math.round(p * 100)}%` : "");

  function button(label, title, onClick) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "fw-btn";
    el.textContent = label;
    el.title = title;
    el.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); onClick(); });
    return el;
  }

  function read(el, a) {
    try {
      return { site: a.site, ...a.extract(el) };
    } catch (error) {
      return null; // markup changed; never break the page
    }
  }

  const mark = (item, decision, verdict, topicId) => send({ type: "feedback", entry: {
    key: decision.key || "mark-" + Date.now(), topicId: topicId || decision.topicId, p: typeof decision.p === "number" ? decision.p : null,
    verdict, site: item.site, state: { site: item.site, text: item.text } } });

  // State lives in data attributes, never classes: React rewrites className on every re-render and would silently
  // undo a class while leaving our bar in place.
  function clearMarks(el) {
    const a = adapter();
    const targets = a && a.hideTargets ? a.hideTargets(el) : [el];
    targets.forEach((t) => { t.removeAttribute("data-fw-gone"); t.removeAttribute("data-fw-filtered"); });
    el.querySelectorAll(":scope > .fw-bar").forEach((bar) => bar.remove());
    if (el._fwBarMount) { el._fwBarMount.remove(); el._fwBarMount = null; }
    for (const name of ["data-fw-note", "data-fw-reason"]) el.removeAttribute(name);
    if ((el.title || "").startsWith("Feedwall:")) el.removeAttribute("title");
  }

  function mountBar(el, bar, goneAttribute) {
    const a = adapter();
    if (a && a.mountBar) {
      el._fwBarMount = a.mountBar(el, bar);
      a.hideTargets(el).forEach((t) => t.setAttribute(goneAttribute, "1"));
    } else {
      el.prepend(bar);
      el._fwBarMount = bar;
    }
  }

  function showAnyway(el, item) {
    remember(item, { action: "show", reason: "reader" });
    clearMarks(el);
    el.setAttribute("data-fw-state", "shown");
    updateFocusChip();
  }

  function collapse(el, item, decision) {
    const bar = document.createElement("div");
    bar.className = "fw-bar";
    const summary = document.createElement("span");
    summary.className = "fw-bar-text";
    summary.textContent = `Hidden · ${nameOf(decision.topicId)}${pct(decision.p)}`;
    bar.append(
      summary,
      button("Show", "Show this post", () => showAnyway(el, item)),
      button("Wrong?", "This should not have been hidden", () => { mark(item, decision, "wrong"); showAnyway(el, item); })
    );
    mountBar(el, bar, "data-fw-gone");
    el.setAttribute("data-fw-state", "hidden");
  }

  // Focus mode removes most of a feed, so it leaves no bar per post. One chip counts them and "Peek" shows them dimmed.
  function filterOut(el) {
    const a = adapter();
    (a && a.hideTargets ? a.hideTargets(el) : [el]).forEach((t) => t.setAttribute("data-fw-filtered", "1"));
    el.setAttribute("data-fw-state", "filtered");
  }

  function apply(el, item, decision) {
    el._fwDecision = decision;
    clearMarks(el);
    const name = nameOf(decision.topicId);
    switch (decision.action) {
      case "hide": collapse(el, item, decision); break;
      case "filter": filterOut(el); break;
      case "keep":
      case "highlight":
        el.setAttribute("data-fw-state", "marked");
        el.setAttribute("data-fw-note", `${decision.action === "keep" ? "★ kept" : "★"} ${name}${pct(decision.p)}`);
        el.title = `Feedwall: fits "${name}"${pct(decision.p)}`;
        break;
      case "dim":
        el.setAttribute("data-fw-state", "dim");
        el.setAttribute("data-fw-note", `${decision.near ? "maybe " : ""}${name}${pct(decision.p)}`);
        el.title = `Feedwall: ${decision.near ? "maybe " : ""}${name}${pct(decision.p)}`;
        break;
      default:
        el.setAttribute("data-fw-state", "shown");
        if (decision.reason) el.setAttribute("data-fw-reason", String(decision.reason).slice(0, 60)); // why it was let through
    }
    updateFocusChip();
  }

  async function process(el, item) {
    const a = adapter();
    if (!a || !siteEnabled(a)) return el.removeAttribute("data-fw-pending");
    item = item || read(el, a);
    if (!item) return el.removeAttribute("data-fw-pending");
    el._fwItem = item;
    const timer = setTimeout(() => el.removeAttribute("data-fw-pending"), PENDING_TIMEOUT_MS);
    const decision = (await send({ type: "judge", item })) || { action: "show", reason: "no_reply" };
    clearTimeout(timer);
    el.removeAttribute("data-fw-pending");
    const reason = String(decision.reason || "");
    if (!reason) health.judged++;
    if (decision.action === "hide") health.hidden++;
    if (decision.action === "dim") health.dimmed++;
    if (decision.action === "filter") health.filtered++;
    if (decision.action === "keep" || decision.action === "highlight") health.marked++;
    if (reason.startsWith("error")) health.errors++;
    // transient failures are not remembered, so the post gets another chance when it is rebuilt
    if (!/^(error|budget|no_reply)/.test(reason)) remember(item, decision);
    if (el.isConnected) apply(el, item, decision);
  }

  const viewport = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      viewport.unobserve(entry.target);
      process(entry.target, entry.target._fwItem);
    }
  }, { rootMargin: PREFETCH_MARGIN });

  function scan() {
    const a = adapter();
    health.site = a ? a.site : null;
    if (!a || !siteEnabled(a)) return;
    for (const el of document.querySelectorAll(a.itemSelector)) {
      if (el.hasAttribute("data-fw")) {
        if (!a.eager || !el._fwItem) continue;
        // virtualized feeds sometimes reuse an element for a different post: notice, reset, and judge it again
        const now = read(el, a);
        if (!now || memoKey(now) === memoKey(el._fwItem)) continue;
        clearMarks(el);
        el.removeAttribute("data-fw-state");
      }
      el.setAttribute("data-fw", "1");
      if (a.skip && a.skip(el)) continue;
      health.seen++;
      const item = read(el, a);
      el._fwItem = item;
      const known = item && memo.get(memoKey(item));
      if (known) { apply(el, item, known); continue; } // rebuilt post: same decision, instantly
      if (settings.blurUntilJudged) el.setAttribute("data-fw-pending", "1");
      // a virtualized feed keeps only posts near the viewport in the page, so everything present is worth judging now
      if (a.eager) process(el, item); else viewport.observe(el);
    }
  }

  // ---- focus chip ---------------------------------------------------------------------------------------------------
  let chip = null;
  let filteredTotal = 0;
  function updateFocusChip() {
    const a = adapter();
    const on = a && settings && (settings.focusSites || []).includes(a.site);
    const nowFiltered = document.querySelectorAll('[data-fw-state="filtered"]').length;
    filteredTotal = Math.max(filteredTotal, health.filtered, nowFiltered);
    if (!on || !filteredTotal) { if (chip) { chip.remove(); chip = null; } return; }
    if (!chip) {
      chip = document.createElement("div");
      chip.className = "fw-chip";
      const label = document.createElement("span");
      label.className = "fw-chip-text";
      const peek = button("Peek", "Show what focus mode filtered out, dimmed", () => {
        const peeking = document.documentElement.toggleAttribute("data-fw-peek");
        peek.textContent = peeking ? "Hide again" : "Peek";
      });
      chip.append(label, peek);
      document.documentElement.appendChild(chip);
    }
    chip.querySelector(".fw-chip-text").textContent = `Focus · ${filteredTotal} filtered`;
  }

  // ---- teach menu: tell Feedwall a visible post fits one of your topics ------------------------------------------------
  const teachButton = button("Feedwall", "Tell Feedwall this post fits one of your topics", () => openMenu());
  teachButton.classList.add("fw-miss");
  let target = null;
  let menu = null;

  function openMenu() {
    const a = adapter();
    if (!target || !a) return;
    const el = target;
    closeMenu();
    menu = document.createElement("div");
    menu.className = "fw-menu";
    const rect = teachButton.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.max(8, rect.right - 240)}px`;

    const item = el._fwItem || {};
    const decision = el._fwDecision || {};
    const heading = document.createElement("div");
    heading.className = "fw-menu-title";
    heading.textContent = "This post fits…";
    menu.appendChild(heading);

    const teach = document.createElement("label");
    teach.className = "fw-menu-check";
    const box = document.createElement("input");
    box.type = "checkbox";
    teach.append(box, document.createTextNode(" also teach it as an example"));

    for (const topic of topicsHere(a)) {
      menu.appendChild(button(`${topic.name}  (${topic.action})`, `Mark this post as fitting "${topic.name}"`, () => {
        mark(item, decision, "missed", topic.id);
        if (box.checked) send({ type: "addExample", topicId: topic.id, side: "yes", text: item.text });
        const local = { action: topic.action, key: decision.key, topicId: topic.id, p: null };
        remember(item, local);
        apply(el, item, local);
        closeMenu();
        teachButton.style.display = "none";
      }));
    }
    if (el.getAttribute("data-fw-state") === "marked" || el.getAttribute("data-fw-state") === "dim") {
      menu.appendChild(button(`✕ Does not fit "${nameOf(decision.topicId)}"`, "Feedwall got this one wrong", () => {
        mark(item, decision, "wrong");
        if (box.checked) send({ type: "addExample", topicId: decision.topicId, side: "no", text: item.text });
        showAnyway(el, item);
        closeMenu();
      }));
    }
    menu.appendChild(teach);
    document.documentElement.appendChild(menu);
  }
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }

  document.addEventListener("mouseover", (event) => {
    const a = adapter();
    if (!a || !settings || !siteEnabled(a) || (menu && menu.contains(event.target)) || event.target === teachButton) return;
    const el = event.target.closest && event.target.closest(a.itemSelector);
    if (!el || !el._fwItem || el.getAttribute("data-fw-state") === "hidden" || el.hasAttribute("data-fw-gone")) return;
    target = el;
    const rect = el.getBoundingClientRect();
    teachButton.style.top = `${Math.max(4, rect.top + 6)}px`;
    teachButton.style.left = `${rect.right - 84}px`;
    if (!teachButton.isConnected) document.documentElement.appendChild(teachButton);
    teachButton.style.display = "block";
  }, { passive: true });
  document.addEventListener("scroll", () => { teachButton.style.display = "none"; closeMenu(); }, { passive: true, capture: true });
  document.addEventListener("click", (event) => { if (menu && !menu.contains(event.target) && event.target !== teachButton) closeMenu(); });

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message && message.type === "health") reply({ ...health, enabled: Boolean(settings && adapter() && siteEnabled(adapter())) });
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !changes.settings) return;
    await refreshSettings();
    // topics, actions or thresholds moved: put everything back and judge again (the worker's cache makes this nearly free)
    memo.clear();
    filteredTotal = 0;
    health.filtered = 0;
    document.documentElement.removeAttribute("data-fw-peek");
    document.querySelectorAll("[data-fw]").forEach((el) => { clearMarks(el); el.removeAttribute("data-fw-state"); el.removeAttribute("data-fw"); });
    updateFocusChip();
    scan();
  });

  // Scan on the next frame, so a rebuilt post is treated again before it is on screen for long. Frames do not fire
  // in background tabs, so a short timer backs it up.
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    let ran = false;
    const run = () => { if (ran) return; ran = true; scheduled = false; scan(); };
    requestAnimationFrame(run);
    setTimeout(run, 150);
  });

  refreshSettings().then(() => {
    scan();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
})();
