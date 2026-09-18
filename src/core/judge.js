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
    enabledPresets: ["engagement_bait", "rage_bait", "ai_slop"],
    customRules: [],
    ruleThresholds: {},
    disabledSites: [],
    dailyBudget: 3000,
  };

  function clip(text, max) {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    return clean.length > max ? clean.slice(0, max) + "…" : clean;
  }

  function buildState(item) {
    const state = { site: item.site, text: clip(item.text, MAX_TEXT) };
    if (item.author) state.author = clip(item.author, 80);
    if (item.quoted) state.quoted_post = clip(item.quoted, 400);
    if (item.linkTitle) state.link_title = clip(item.linkTitle, 200);
    if (item.kind) state.kind = item.kind; // "post" | "comment" | "video"
    return state;
  }

  function isJudgeable(item) {
    return Boolean(item && item.text && item.text.replace(/\s+/g, " ").trim().length >= MIN_TEXT);
  }

  function buildRequest(item, questions, model) {
    return { state: buildState(item), model, questions };
  }

  function parseAnswers(response, ruleIds) {
    const probabilities = {};
    const answers = (response && response.answers) || {};
    for (const id of ruleIds) {
      const answer = answers[id];
      if (answer && typeof answer.noul === "number") probabilities[id] = answer.noul;
    }
    return probabilities;
  }

  function thresholdFor(ruleId, settings) {
    const override = settings.ruleThresholds && settings.ruleThresholds[ruleId];
    return typeof override === "number" ? override : STRICTNESS[settings.strictness] || STRICTNESS.balanced;
  }

  // The rule that clears its own threshold by the widest margin is the one we name in the bar.
  function decide(probabilities, settings) {
    let best = null;
    let nearest = null;
    for (const [ruleId, p] of Object.entries(probabilities)) {
      const threshold = thresholdFor(ruleId, settings);
      const margin = p - threshold;
      if (margin >= 0 && (!best || margin > best.margin)) best = { ruleId, p, threshold, margin };
      if (margin < 0 && margin >= -DIM_BAND && (!nearest || margin > nearest.margin)) nearest = { ruleId, p, threshold, margin };
    }
    if (best) return { action: "hide", ruleId: best.ruleId, p: best.p, threshold: best.threshold };
    if (nearest && settings.dimUncertain) return { action: "dim", ruleId: nearest.ruleId, p: nearest.p, threshold: nearest.threshold };
    return { action: "show" };
  }

  function costOf(inputTokens) {
    return (inputTokens * PRICE_PER_MTOK) / 1e6;
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  const api = { STRICTNESS, DIM_BAND, DEFAULT_SETTINGS, buildState, buildRequest, parseAnswers, thresholdFor, decide,
                isJudgeable, costOf, today, clip };
  root.FW = Object.assign(root.FW || {}, { judge: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
