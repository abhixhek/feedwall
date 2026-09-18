const test = require("node:test");
const assert = require("node:assert/strict");

const T = require("../src/core/topics.js");
const judge = require("../src/core/judge.js");
const stats = require("../src/core/stats.js");

const topic = (id, action, extra = {}) => T.sanitizeTopic({ id, name: id, description: `Is this post about ${id}?`, action, ...extra });
const settings = (extra = {}) => ({ ...judge.DEFAULT_SETTINGS, ...extra });

test("a topic becomes a noul question in the documented API shape, with context and examples in the criteria", () => {
  const t = T.sanitizeTopic({ name: "Indie building", description: "Posts about launching a small software product",
    counts: "Build logs and revenue numbers.", notCounts: "Course ads.", examples: { yes: ["Hit $1k MRR today"], no: ["Buy my course"] }, action: "keep" });
  const q = T.toQuestion(t);
  assert.equal(q.type, "noul");
  assert.match(q.instructions, /^Does this post fit this description: "Posts about launching/);
  assert.match(q.criteria.true, /Build logs.*Examples that fit: "Hit \$1k MRR today"/);
  assert.match(q.criteria.false, /Course ads.*Examples that do not fit: "Buy my course"/);
  assert.equal(T.toQuestion(topic("x", "hide")).criteria, undefined); // no context given, none invented
  assert.equal(T.toQuestion(T.fromLibrary("politics")).instructions, "Is this post about partisan politics?"); // already a question: left alone
});

test("everything from outside is bounded: long strings clipped, unknown actions and bad thresholds dropped, examples capped", () => {
  const t = T.sanitizeTopic({ name: "n".repeat(500), description: "d".repeat(2000), action: "delete-everything", threshold: 7,
    examples: { yes: ["a", "b", "c", "d", "e"], no: "not-a-list" }, sites: ["x", 42], enabled: "yes" });
  assert.equal(t.name.length, T.LIMITS.name);
  assert.equal(t.description.length, T.LIMITS.description);
  assert.equal(t.action, "hide");
  assert.equal(t.threshold, null);
  assert.deepEqual(t.examples, { yes: ["c", "d", "e"], no: [] });
  assert.deepEqual(t.sites, ["x", "42"]);
  assert.equal(T.sanitizeTopic({ name: "", description: "" }), null);
  assert.equal(T.sanitizeTopic("nope"), null);
});

test("v0.1 settings carry over: presets, custom rules and per-rule thresholds become topics", () => {
  const old = { enabledPresets: ["politics", "ai_slop"], customRules: [{ id: "custom_abc", label: "posts hyping a launch countdown" }],
                ruleThresholds: { politics: 0.95 } };
  const migrated = T.migrate(old);
  assert.deepEqual(migrated.map((t) => [t.id, t.action]), [["politics", "hide"], ["ai_slop", "hide"], ["custom_abc", "hide"]]);
  assert.equal(migrated[0].threshold, 0.95);
  assert.deepEqual(T.migrate({}).map((t) => t.id), ["engagement_bait", "rage_bait", "ai_slop"]); // fresh install defaults
  assert.equal(T.migrate({ topics: [] }).length, 0); // an emptied list stays empty
});

test("topics can be limited to sites and switched off", () => {
  const s = settings({ topics: [topic("a", "hide", { sites: ["x"] }), topic("b", "hide"), topic("c", "hide", { enabled: false })] });
  assert.deepEqual(T.activeTopics(s, "x").map((t) => t.id), ["a", "b"]);
  assert.deepEqual(T.activeTopics(s, "reddit").map((t) => t.id), ["b"]);
});

test("the cache version follows wording only: actions and thresholds can change without re-asking the model", () => {
  const base = [topic("a", "hide")];
  assert.equal(T.questionsVersion(base, ""), T.questionsVersion([topic("a", "keep", { threshold: 0.9 })], ""));
  assert.notEqual(T.questionsVersion(base, ""), T.questionsVersion([topic("a", "hide", { counts: "new context" })], ""));
  assert.notEqual(T.questionsVersion(base, ""), T.questionsVersion(base, "I build iOS apps"));
});

test("lint flags wording a literal model handles badly, and passes a clean description", () => {
  const ids = (text) => T.lintTopic(text).map((w) => w.id);
  assert.deepEqual(ids("posts about launching or pricing a small software product"), []);
  assert.ok(ids("posts that are not about code").includes("negation"));
  assert.ok(ids("really interesting posts about startups").includes("vague"));
  assert.ok(ids("threads with more than 10 tweets in them").includes("counting"));
  assert.ok(ids("spam").includes("short"));
});

test("sets round-trip through a pasteable code, and imports are sanitized", () => {
  const mine = settings({ aboutMe: "indie iOS dev", topics: [topic("indie", "keep", { counts: "émojis 🚀 survive" }), topic("bait", "hide")] });
  const code = T.exportSet("My set", mine);
  assert.match(code, /^feedwall:v1:[A-Za-z0-9_-]+$/);
  const back = T.importSet(code);
  assert.equal(back.name, "My set");
  assert.equal(back.aboutMe, "indie iOS dev");
  assert.deepEqual(back.topics.map((t) => [t.id, t.action, t.counts]), [["indie", "keep", "émojis 🚀 survive"], ["bait", "hide", ""]]);
  const hostile = T.importSet(JSON.stringify({ name: "x", topics: [{ name: "ok", description: "fine topic here", action: "rm -rf" }, { junk: true }] }));
  assert.deepEqual(hostile.topics.map((t) => t.action), ["hide"]);
  assert.throws(() => T.importSet("not a set"), /not a Feedwall set/);
  assert.throws(() => T.importSet(JSON.stringify({ topics: [] })), /no usable topics/);
});

test("built-in sets resolve to real topics with the intended actions", () => {
  for (const set of T.BUILT_IN_SETS) {
    const resolved = T.topicsFromSet(set);
    assert.equal(resolved.length, set.topics.length, set.name);
    assert.ok(resolved.some((t) => T.WANTED.has(t.action)), `${set.name} should want something`);
  }
});

test("state is clipped, carries only fields that exist, and includes the reader once", () => {
  const state = judge.buildState({ site: "x", text: "a".repeat(5000), author: "someone" }, "indie dev");
  assert.ok(state.text.length <= 1501);
  assert.deepEqual(Object.keys(state).sort(), ["author", "reader", "site", "text"]);
  assert.equal("reader" in judge.buildState({ site: "x", text: "long enough text here" }, ""), false);
});

// ---- the decision order -----------------------------------------------------------------------------------------
const ALL = [topic("want", "keep"), topic("like", "highlight"), topic("bait", "hide"), topic("meh", "dim")];

test("1. keep beats everything, including a hide that fits more strongly", () => {
  const d = judge.decide({ want: 0.8, bait: 0.99 }, ALL, settings(), "x");
  assert.deepEqual([d.action, d.topicId], ["keep", "want"]);
});

test("2. hide beats dim and highlight", () => {
  const d = judge.decide({ like: 0.95, bait: 0.9, meh: 0.9 }, ALL, settings(), "x");
  assert.deepEqual([d.action, d.topicId], ["hide", "bait"]);
});

test("3. focus mode filters posts that fit nothing wanted, and only on the sites where it is on", () => {
  const focused = settings({ focusSites: ["x"] });
  assert.equal(judge.decide({ want: 0.1, like: 0.1, bait: 0.1, meh: 0.1 }, ALL, focused, "x").action, "filter");
  assert.equal(judge.decide({ want: 0.1, like: 0.9, bait: 0.1, meh: 0.1 }, ALL, focused, "x").action, "highlight");
  assert.equal(judge.decide({ want: 0.1, like: 0.1, bait: 0.1, meh: 0.1 }, ALL, focused, "reddit").action, "show");
  // in a focused feed a hidden post is counted with the rest rather than leaving a bar, but keeps its reason for "Peek"
  const hiddenInFocus = judge.decide({ like: 0.9, bait: 0.95 }, ALL, focused, "x");
  assert.deepEqual([hiddenInFocus.action, hiddenInFocus.topicId], ["filter", "bait"]);
  assert.equal(judge.decide({ want: 0.9, bait: 0.95 }, ALL, focused, "x").action, "keep");
});

test("focus mode never blanks a feed: no answers, or no wanted topics, means show", () => {
  const focused = settings({ focusSites: ["x"] });
  assert.equal(judge.decide({}, ALL, focused, "x").action, "show"); // the model failed
  assert.equal(judge.decide({ bait: 0.1 }, [topic("bait", "hide")], focused, "x").action, "show"); // nothing to focus on
});

test("4-6. dim, then highlight, then a near-miss hide dims only if the reader asked for it", () => {
  assert.equal(judge.decide({ like: 0.9, meh: 0.9 }, ALL, settings(), "x").action, "dim");
  assert.equal(judge.decide({ like: 0.9 }, ALL, settings(), "x").action, "highlight");
  const near = judge.decide({ bait: 0.7 }, ALL, settings(), "x");
  assert.deepEqual([near.action, near.near], ["dim", true]);
  assert.equal(judge.decide({ bait: 0.7 }, ALL, settings({ dimUncertain: false }), "x").action, "show");
  assert.equal(judge.decide({ like: 0.7 }, ALL, settings(), "x").action, "show"); // a near-miss highlight is just a normal post
});

test("a topic's own threshold overrides the slider", () => {
  const strictSlider = settings({ strictness: "strict" });
  const picky = [topic("bait", "hide", { threshold: 0.95 })];
  assert.equal(judge.decide({ bait: 0.9 }, picky, strictSlider, "x").action, "dim");
  assert.equal(judge.decide({ bait: 0.96 }, picky, strictSlider, "x").action, "hide");
});

test("parseAnswers ignores missing or malformed answers", () => {
  assert.deepEqual(judge.parseAnswers({ answers: { a: { noul: 0.4 }, b: { type: "noul" } } }, ["a", "b", "c"]), { a: 0.4 });
  assert.deepEqual(judge.parseAnswers(null, ["a"]), {});
});

// ---- the accuracy report ----------------------------------------------------------------------------------------
const mark = (key, p, verdict, topicId = "bait") => ({ key, p, verdict, topicId, state: { text: "t" + key } });

test("a topic that is wrong at low confidence gets a higher threshold suggested", () => {
  const feedback = [...[0.76, 0.78, 0.8, 0.82].map((p, i) => mark("w" + i, p, "wrong")), ...[0.9, 0.92, 0.94, 0.95, 0.97, 0.99].map((p, i) => mark("r" + i, p, "right"))];
  const report = stats.topicReport(feedback, "bait", 0.75);
  assert.equal(report.wrong, 4);
  assert.ok(report.suggestion.threshold > 0.82 && report.suggestion.threshold <= 0.9);
});

test("a topic that is wrong at every confidence level is flagged for rewording, not re-thresholding", () => {
  const feedback = [...[0.8, 0.9, 0.95, 0.99].map((p, i) => mark("w" + i, p, "wrong")), ...[0.78, 0.85, 0.93, 0.97].map((p, i) => mark("r" + i, p, "right"))];
  assert.equal(stats.topicReport(feedback, "bait", 0.75).suggestion.rewrite, true);
});

test("few marks produce no suggestion; repeated misses suggest a lower threshold; v0.1 marks still count", () => {
  assert.equal(stats.topicReport([mark("a", 0.8, "wrong")], "bait", 0.75).suggestion, null);
  const report = stats.topicReport([0.6, 0.66, 0.7].map((p, i) => mark("m" + i, p, "missed")), "bait", 0.75);
  assert.ok(report.suggestion.threshold < 0.75 && report.suggestion.threshold >= 0.5);
  assert.equal(stats.topicReport([{ key: "old", p: 0.9, verdict: "right", ruleId: "bait" }], "bait", 0.75).right, 1);
});

test("marks export as jevcal rows and questions; a later mark on the same post replaces the earlier one", () => {
  let feedback = [];
  feedback = stats.addFeedback(feedback, mark("p1", 0.9, "right"));
  feedback = stats.addFeedback(feedback, mark("p1", 0.9, "wrong"));
  feedback = stats.addFeedback(feedback, mark("p2", 0.6, "missed"));
  assert.equal(feedback.length, 2);
  assert.deepEqual(stats.toJevcalRows(feedback).map((r) => r.labels.bait), [false, true]);
  const yaml = stats.toJevcalQuestionsYaml(T.toQuestions([T.fromLibrary("engagement_bait")]), "jev-1.13.0");
  assert.match(yaml, /engagement_bait:\n {4}type: noul\n {4}instructions: "Is this post engagement bait\?"/);
});
