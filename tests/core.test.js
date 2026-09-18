const test = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../src/core/rules.js");
const judge = require("../src/core/judge.js");
const stats = require("../src/core/stats.js");

const settings = (extra = {}) => ({ ...judge.DEFAULT_SETTINGS, ...extra });

test("presets become noul questions in the documented API shape", () => {
  const active = rules.activeRules(settings({ enabledPresets: ["engagement_bait", "politics"] }));
  const questions = rules.toQuestions(active);
  assert.deepEqual(Object.keys(questions), ["engagement_bait", "politics"]);
  assert.equal(questions.politics.type, "noul");
  assert.ok(questions.politics.criteria.true && questions.politics.criteria.false);
});

test("custom rules get stable ids and no criteria", () => {
  const a = rules.makeCustomRule("  posts hyping a  launch countdown ");
  const b = rules.makeCustomRule("Posts hyping a launch countdown");
  assert.equal(a.id, b.id);
  assert.match(a.instructions, /launch countdown/);
  assert.equal(rules.toQuestions([a])[a.id].criteria, undefined);
});

test("lint flags the wording a literal model handles badly, and passes a clean rule", () => {
  const ids = (text) => rules.lintRule(text).map((w) => w.id);
  assert.deepEqual(ids("posts hyping a product launch countdown"), []);
  assert.ok(ids("posts that are not about code").includes("negation"));
  assert.ok(ids("crypto and politics").includes("compound"));
  assert.ok(ids("annoying posts").includes("vague"));
  assert.ok(ids("threads with more than 10 tweets").includes("counting"));
  assert.ok(ids("spam").includes("short"));
});

test("rules version changes when wording changes, so stale cache entries are never reused", () => {
  const base = rules.activeRules(settings());
  const edited = base.map((r, i) => (i === 0 ? { ...r, instructions: r.instructions + " Really?" } : r));
  assert.notEqual(rules.rulesVersion(base), rules.rulesVersion(edited));
  assert.equal(rules.rulesVersion(base), rules.rulesVersion(rules.activeRules(settings())));
});

test("state is clipped and only carries fields that exist", () => {
  const state = judge.buildState({ site: "x", text: "a".repeat(5000), author: "someone" });
  assert.ok(state.text.length <= 1501);
  assert.deepEqual(Object.keys(state).sort(), ["author", "site", "text"]);
  assert.equal(judge.isJudgeable({ text: "too short" }), false);
  assert.equal(judge.isJudgeable({ text: "long enough to be worth a request" }), true);
});

test("decide hides on the rule that clears its threshold by the widest margin", () => {
  const out = judge.decide({ politics: 0.8, rage_bait: 0.97 }, settings({ strictness: "balanced" }));
  assert.equal(out.action, "hide");
  assert.equal(out.ruleId, "rage_bait");
});

test("per-rule threshold overrides the slider", () => {
  const s = settings({ strictness: "strict", ruleThresholds: { politics: 0.95 } });
  assert.equal(judge.decide({ politics: 0.9 }, s).action, "dim");
  assert.equal(judge.decide({ politics: 0.96 }, s).action, "hide");
});

test("uncertain posts dim only when the reader asked for it, and clear misses show", () => {
  assert.equal(judge.decide({ politics: 0.7 }, settings()).action, "dim");
  assert.equal(judge.decide({ politics: 0.7 }, settings({ dimUncertain: false })).action, "show");
  assert.equal(judge.decide({ politics: 0.2 }, settings()).action, "show");
  assert.equal(judge.decide({}, settings()).action, "show"); // no answers = fail open
});

test("parseAnswers ignores missing or malformed answers", () => {
  const response = { answers: { a: { type: "noul", noul: 0.4 }, b: { type: "noul" } } };
  assert.deepEqual(judge.parseAnswers(response, ["a", "b", "c"]), { a: 0.4 });
  assert.deepEqual(judge.parseAnswers(null, ["a"]), {});
});

const mark = (key, p, verdict, ruleId = "politics") => ({ key, p, verdict, ruleId, state: { text: "t" + key } });

test("a rule that is wrong at low confidence gets a higher threshold suggested", () => {
  const feedback = [
    ...[0.76, 0.78, 0.8, 0.82].map((p, i) => mark("w" + i, p, "wrong")),
    ...[0.9, 0.92, 0.94, 0.95, 0.97, 0.99].map((p, i) => mark("r" + i, p, "right")),
  ];
  const report = stats.ruleReport(feedback, "politics", 0.75);
  assert.equal(report.wrong, 4);
  assert.ok(report.suggestion.threshold > 0.82 && report.suggestion.threshold <= 0.9);
});

test("a rule that is wrong at every confidence level is flagged for rewriting, not re-thresholding", () => {
  const feedback = [
    ...[0.8, 0.9, 0.95, 0.99].map((p, i) => mark("w" + i, p, "wrong")),
    ...[0.78, 0.85, 0.93, 0.97].map((p, i) => mark("r" + i, p, "right")),
  ];
  assert.equal(stats.ruleReport(feedback, "politics", 0.75).suggestion.rewrite, true);
});

test("few marks produce no suggestion; repeated misses suggest a lower threshold", () => {
  assert.equal(stats.ruleReport([mark("a", 0.8, "wrong")], "politics", 0.75).suggestion, null);
  const missed = [0.6, 0.66, 0.7].map((p, i) => mark("m" + i, p, "missed"));
  const report = stats.ruleReport(missed, "politics", 0.75);
  assert.ok(report.suggestion.threshold < 0.75 && report.suggestion.threshold >= 0.5);
});

test("marks export as jevcal rows, and a later mark on the same post replaces the earlier one", () => {
  let feedback = [];
  feedback = stats.addFeedback(feedback, mark("p1", 0.9, "right"));
  feedback = stats.addFeedback(feedback, mark("p1", 0.9, "wrong"));
  feedback = stats.addFeedback(feedback, mark("p2", 0.6, "missed"));
  assert.equal(feedback.length, 2);
  const rows = stats.toJevcalRows(feedback);
  assert.deepEqual(rows.map((r) => r.labels.politics), [false, true]);
  const yaml = stats.toJevcalQuestionsYaml(rules.PRESETS.slice(0, 1), "jev-1.13.0");
  assert.match(yaml, /engagement_bait:\n {4}type: noul/);
});
