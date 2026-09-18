// Content script: finds posts, asks the background worker for a decision, and collapses or dims them.
// It never sees the API key and never makes network requests itself.
(function () {
  "use strict";
  const { sites } = globalThis.FW;
  const PREFETCH_MARGIN = "3000px 0px"; // judge posts well before they scroll into view, so there is no flash
  const PENDING_TIMEOUT_MS = 3000;
  const MEMO_MAX = 600;

  let settings = null;
  let ruleLabels = {};
  const health = { site: null, seen: 0, judged: 0, hidden: 0, dimmed: 0, errors: 0 };

  // Decisions already made on this page, keyed by post text. React-driven sites (X) throw post elements away and
  // rebuild them while you scroll; remembering the decision lets a rebuilt post collapse again at once, with no
  // request and no flash.
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
    const active = (await send({ type: "activeRules" })) || [];
    ruleLabels = Object.fromEntries(active.map((r) => [r.id, r.label]));
  }

  const siteEnabled = (a) => settings && settings.enabled && settings.hasKey && !(settings.disabledSites || []).includes(a.site);

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

  // State lives in data attributes, never classes: React rewrites className on every re-render and would silently
  // undo a class while leaving our bar in place.
  function clearMarks(el) {
    const a = adapter();
    const targets = a && a.hideTargets ? a.hideTargets(el) : [el];
    targets.forEach((t) => t.removeAttribute("data-fw-gone"));
    el.querySelectorAll(":scope > .fw-bar").forEach((bar) => bar.remove());
    if (el._fwBarMount) { el._fwBarMount.remove(); el._fwBarMount = null; }
    el.removeAttribute("data-fw-note");
    el.removeAttribute("data-fw-reason");
    if ((el.title || "").startsWith("Feedwall:")) el.removeAttribute("title");
  }

  function expand(el) {
    clearMarks(el);
    el.setAttribute("data-fw-state", "shown");
  }

  function collapse(el, item, decision, label) {
    const a = adapter();
    clearMarks(el);
    const bar = document.createElement("div");
    bar.className = "fw-bar";
    const summary = document.createElement("span");
    summary.className = "fw-bar-text";
    const pct = typeof decision.p === "number" ? ` · ${Math.round(decision.p * 100)}%` : "";
    summary.textContent = `Hidden · ${label}${pct}`;
    const keepShown = () => { remember(item, { action: "show", reason: "reader" }); expand(el); };
    bar.append(
      summary,
      button("Show", "Show this post", keepShown),
      button("Wrong?", "This should not have been hidden", () => {
        send({ type: "feedback", entry: { key: decision.key, ruleId: decision.ruleId, p: decision.p, verdict: "wrong", site: item.site, state: { site: item.site, text: item.text } } });
        keepShown();
      })
    );
    if (a && a.mountBar) {
      el._fwBarMount = a.mountBar(el, bar);
      a.hideTargets(el).forEach((t) => t.setAttribute("data-fw-gone", "1"));
    } else {
      el.prepend(bar);
      el._fwBarMount = bar;
    }
    el.setAttribute("data-fw-state", "hidden");
  }

  function apply(el, item, decision) {
    el._fwDecision = decision;
    const label = ruleLabels[decision.ruleId] || decision.ruleId;
    if (decision.action === "hide") return collapse(el, item, decision, label);
    clearMarks(el);
    if (decision.action === "dim") {
      const note = `maybe ${label} · ${Math.round(decision.p * 100)}%`;
      el.setAttribute("data-fw-state", "dim");
      el.setAttribute("data-fw-note", note);
      el.title = `Feedwall: ${note}`;
      return;
    }
    el.setAttribute("data-fw-state", "shown");
    if (decision.reason) el.setAttribute("data-fw-reason", String(decision.reason).slice(0, 60)); // why it was let through
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

  // "Hide like this": lets the reader record a miss for a rule on any visible post.
  const missButton = button("Hide like this", "Feedwall missed this one", () => openMissMenu());
  missButton.classList.add("fw-miss");
  let missTarget = null;
  let missMenu = null;

  function openMissMenu() {
    if (!missTarget) return;
    const target = missTarget;
    closeMissMenu();
    missMenu = document.createElement("div");
    missMenu.className = "fw-menu";
    const rect = missButton.getBoundingClientRect();
    missMenu.style.top = `${rect.bottom + 4}px`;
    missMenu.style.left = `${Math.max(8, rect.right - 220)}px`;
    for (const [ruleId, label] of Object.entries(ruleLabels)) {
      missMenu.appendChild(button(label, `Should have been hidden as: ${label}`, () => {
        const item = target._fwItem || {};
        const key = (target._fwDecision && target._fwDecision.key) || "miss-" + Date.now();
        const decision = { action: "hide", key, ruleId, p: null };
        send({ type: "feedback", entry: { key, ruleId, p: null, verdict: "missed", site: item.site, state: { site: item.site, text: item.text } } });
        remember(item, decision);
        apply(target, item, decision);
        closeMissMenu();
        missButton.style.display = "none";
      }));
    }
    document.documentElement.appendChild(missMenu);
  }
  function closeMissMenu() { if (missMenu) { missMenu.remove(); missMenu = null; } }

  document.addEventListener("mouseover", (event) => {
    const a = adapter();
    if (!a || !settings || !siteEnabled(a) || (missMenu && missMenu.contains(event.target)) || event.target === missButton) return;
    const el = event.target.closest && event.target.closest(a.itemSelector);
    if (!el || !el._fwItem || el.getAttribute("data-fw-state") === "hidden" || el.hasAttribute("data-fw-gone")) return;
    missTarget = el;
    const rect = el.getBoundingClientRect();
    missButton.style.top = `${Math.max(4, rect.top + 6)}px`;
    missButton.style.left = `${rect.right - 118}px`;
    if (!missButton.isConnected) document.documentElement.appendChild(missButton);
    missButton.style.display = "block";
  }, { passive: true });
  document.addEventListener("scroll", () => { missButton.style.display = "none"; closeMissMenu(); }, { passive: true, capture: true });
  document.addEventListener("click", (event) => { if (missMenu && !missMenu.contains(event.target) && event.target !== missButton) closeMissMenu(); });

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message && message.type === "health") reply({ ...health, enabled: Boolean(settings && adapter() && siteEnabled(adapter())) });
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !changes.settings) return;
    await refreshSettings();
    // rules or thresholds moved: put everything back and judge again (the worker's cache makes this nearly free)
    memo.clear();
    document.querySelectorAll("[data-fw]").forEach((el) => { clearMarks(el); el.removeAttribute("data-fw-state"); el.removeAttribute("data-fw"); });
    scan();
  });

  // Scan on the next frame, so a rebuilt post is collapsed again before it is on screen for long. Frames do not fire
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
