// Turning a post into a request, and a response into a decision. Pure functions, no I/O.
(function (root) {
  "use strict";

  const STRICTNESS = { relaxed: 0.9, balanced: 0.75, strict: 0.6 };
  const DIM_BAND = 0.15;
  const MAX_TEXT = 1500; // irrelevant state is a distractor, and long posts make their point early
  const MIN_TEXT = 15;
  const PRICE_PER_MTOK = 0.042;

  const DEFAULT_SETTINGS = {
    enabled: true,
    apiKey: "",
    baseUrl: "https://api.typesafe.ai",
    model: "jev-latest",
    strictness: "balanced",
    dimUncertain: true,
    blurUntilJudged: false,
    aboutMe: "",
    focusSites: [], // sites where only posts that fit a wanted topic are shown
    disabledSites: ["linkedin"], // LinkedIn is the least tolerant of extensions, so the reader opts in
    dailyBudget: 3000,
    // `topics` is filled in by topics.migrate() so that v0.1 settings carry over
  };

  function clip(text, max) {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    return clean.length > max ? clean.slice(0, max) + "…" : clean;
  }

  function buildState(item, aboutMe) {
    const state = { site: item.site, text: clip(item.text, MAX_TEXT) };
    if (item.author) state.author = clip(item.author, 80);
    if (item.quoted) state.quoted_post = clip(item.quoted, 400);
    if (item.linkTitle) state.link_title = clip(item.linkTitle, 200);
    if (item.kind) state.kind = item.kind; // "post" | "comment" | "video"
    if (aboutMe) state.reader = clip(aboutMe, 300); // sent once per post, shared by every question
    return state;
  }

  function isJudgeable(item) {
    return Boolean(item && item.text && item.text.replace(/\s+/g, " ").trim().length >= MIN_TEXT);
  }

  function buildRequest(item, questions, model, aboutMe) {
    return { state: buildState(item, aboutMe), model, questions };
  }

  function parseAnswers(response, topicIds) {
    const probabilities = {};
    const answers = (response && response.answers) || {};
    for (const id of topicIds) {
      const answer = answers[id];
      if (answer && typeof answer.noul === "number") probabilities[id] = answer.noul;
    }
    return probabilities;
  }

  function thresholdFor(topic, settings) {
    return typeof topic.threshold === "number" ? topic.threshold : STRICTNESS[settings.strictness] || STRICTNESS.balanced;
  }

  // One fixed order, so the reader can predict it:
  //   1. a "keep" topic fits            -> shown and marked, whatever else fits
  //   2. a "hide" topic fits            -> collapsed (in a focused feed: filtered out with the rest)
  //   3. focus mode, no wanted topic    -> filtered out
  //   4. a "dim" topic fits             -> dimmed
  //   5. a "highlight" topic fits       -> marked
  //   6. a "hide" topic nearly fits     -> dimmed (optional)
  // Within a step, the topic that clears its own threshold by the widest margin is the one we name.
  function decide(probabilities, topics, settings, site) {
    const fits = { keep: null, hide: null, dim: null, highlight: null };
    let nearHide = null;
    for (const topic of topics) {
      const p = probabilities[topic.id];
      if (typeof p !== "number") continue;
      const threshold = thresholdFor(topic, settings);
      const margin = p - threshold;
      const entry = { topicId: topic.id, p, threshold, margin };
      if (margin >= 0) {
        if (!fits[topic.action] || margin > fits[topic.action].margin) fits[topic.action] = entry;
      } else if (topic.action === "hide" && margin >= -DIM_BAND && (!nearHide || margin > nearHide.margin)) {
        nearHide = entry;
      }
    }
    const out = (action, entry, extra) => ({ action, topicId: entry.topicId, p: entry.p, threshold: entry.threshold, ...extra });
    // Focus needs an answer to act on and something to focus on: no answer or no wanted topic must never blank the feed.
    const answered = Object.keys(probabilities).length > 0;
    const hasWanted = topics.some((t) => t.action === "keep" || t.action === "highlight");
    const focus = answered && hasWanted && (settings.focusSites || []).includes(site);

    if (fits.keep) return out("keep", fits.keep);
    // a focused feed shows only what was asked for, so a hidden post is counted with the rest instead of leaving a bar
    if (fits.hide) return out(focus ? "filter" : "hide", fits.hide);
    if (focus && !fits.highlight) return { action: "filter" };
    if (fits.dim) return out("dim", fits.dim);
    if (fits.highlight) return out("highlight", fits.highlight);
    if (nearHide && settings.dimUncertain) return out("dim", nearHide, { near: true });
    return { action: "show" };
  }

  function costOf(inputTokens) {
    return (inputTokens * PRICE_PER_MTOK) / 1e6;
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  const api = { STRICTNESS, DIM_BAND, DEFAULT_SETTINGS, PRICE_PER_MTOK, buildState, buildRequest, parseAnswers, thresholdFor, decide,
                isJudgeable, costOf, today, clip };
  root.FW = Object.assign(root.FW || {}, { judge: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
