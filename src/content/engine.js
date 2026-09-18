// Content script: finds posts, asks the background worker for a decision, and collapses or dims them.
// It never sees the API key and never makes network requests itself.
(function () {
  "use strict";
  const { sites } = globalThis.FW;
  const PREFETCH_MARGIN = "1500px 0px"; // judge posts before they scroll into view, so there is no flash
  const PENDING_TIMEOUT_MS = 3000;

  let settings = null;
  let ruleLabels = {};
  const health = { site: null, seen: 0, judged: 0, hidden: 0, dimmed: 0 };

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

  function expand(el) {
    const a = adapter();
    const targets = a && a.hideTargets ? a.hideTargets(el) : [el];
    targets.forEach((t) => t.classList.remove("fw-collapsed", "fw-gone"));
    if (el._fwBarMount) { el._fwBarMount.remove(); el._fwBarMount = null; }
    el.classList.remove("fw-dim");
    el.removeAttribute("data-fw-note");
    if ((el.title || "").startsWith("Feedwall:")) el.removeAttribute("title");
  }

  function collapse(el, item, decision, label) {
    const a = adapter();
    const bar = document.createElement("div");
    bar.className = "fw-bar";
    const summary = document.createElement("span");
    summary.className = "fw-bar-text";
    const pct = typeof decision.p === "number" ? ` · ${Math.round(decision.p * 100)}%` : "";
    summary.textContent = `Hidden · ${label}${pct}`;
    bar.append(
      summary,
      button("Show", "Show this post", () => expand(el)),
      button("Wrong?", "This should not have been hidden", () => {
        send({ type: "feedback", entry: { key: decision.key, ruleId: decision.ruleId, p: decision.p, verdict: "wrong", site: item.site, state: { site: item.site, text: item.text } } });
        expand(el);
      })
    );
    if (a && a.mountBar) {
      el._fwBarMount = a.mountBar(el, bar);
      a.hideTargets(el).forEach((t) => t.classList.add("fw-gone"));
    } else {
      el.prepend(bar);
      el._fwBarMount = bar;
      el.classList.add("fw-collapsed");
    }
  }

  async function process(el) {
    const a = adapter();
    if (!a || !siteEnabled(a)) return el.classList.remove("fw-pending");
    let item;
    try {
      item = { site: a.site, ...a.extract(el) };
    } catch (error) {
      return el.classList.remove("fw-pending"); // markup changed; never break the page
    }
    el._fwItem = item;
    const timer = setTimeout(() => el.classList.remove("fw-pending"), PENDING_TIMEOUT_MS);
    const decision = (await send({ type: "judge", item })) || { action: "show" };
    clearTimeout(timer);
    el.classList.remove("fw-pending");
    if (!el.isConnected) return;
    el._fwDecision = decision;
    if (decision.reason === undefined) health.judged++;

    const label = ruleLabels[decision.ruleId] || decision.ruleId;
    if (decision.action === "hide") { health.hidden++; collapse(el, item, decision, label); }
    else if (decision.action === "dim") { health.dimmed++; el.classList.add("fw-dim"); const note = `maybe ${label} · ${Math.round(decision.p * 100)}%`; el.setAttribute("data-fw-note", note); el.title = `Feedwall: ${note}`; }
  }

  const viewport = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      viewport.unobserve(entry.target);
      process(entry.target);
    }
  }, { rootMargin: PREFETCH_MARGIN });

  function scan() {
    const a = adapter();
    health.site = a ? a.site : null;
    if (!a || !siteEnabled(a)) return;
    for (const el of document.querySelectorAll(a.itemSelector)) {
      if (el.hasAttribute("data-fw")) continue;
      el.setAttribute("data-fw", "1");
      if (a.skip && a.skip(el)) continue;
      health.seen++;
      if (settings.blurUntilJudged) el.classList.add("fw-pending");
      viewport.observe(el);
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
        send({ type: "feedback", entry: { key, ruleId, p: null, verdict: "missed", site: item.site, state: { site: item.site, text: item.text } } });
        collapse(target, item, { key, ruleId, p: null }, label);
        closeMissMenu();
      }));
    }
    document.documentElement.appendChild(missMenu);
  }
  function closeMissMenu() { if (missMenu) { missMenu.remove(); missMenu = null; } }

  document.addEventListener("mouseover", (event) => {
    const a = adapter();
    if (!a || !settings || !siteEnabled(a) || (missMenu && missMenu.contains(event.target)) || event.target === missButton) return;
    const el = event.target.closest && event.target.closest(a.itemSelector);
    if (!el || !el._fwItem || el.classList.contains("fw-collapsed") || el.classList.contains("fw-gone")) { return; }
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
    // rules or thresholds moved: put everything back and judge again (cached answers make this nearly free)
    document.querySelectorAll("[data-fw]").forEach((el) => { expand(el); el.removeAttribute("data-fw"); });
    scan();
  });

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; scan(); }, 250);
  });

  refreshSettings().then(() => {
    scan();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
})();
