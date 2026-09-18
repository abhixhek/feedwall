// The accuracy loop: the reader's "right / wrong / missed" marks become a per-topic report and a threshold suggestion.
(function (root) {
  "use strict";

  const MIN_MARKS = 8; // below this a suggestion would be noise
  const TARGET_WRONG_RATE = 0.1;
  const MAX_FEEDBACK = 2000;

  const idOf = (f) => f.topicId || f.ruleId; // v0.1 marks used ruleId

  function addFeedback(list, entry) {
    const next = list.filter((f) => f.key !== entry.key || idOf(f) !== idOf(entry));
    next.push(entry);
    return next.slice(-MAX_FEEDBACK);
  }

  // verdicts: "right" (matched, correctly) | "wrong" (matched, should not have) | "missed" (not matched, should have)
  function topicReport(feedback, topicId, currentThreshold) {
    const marks = feedback.filter((f) => idOf(f) === topicId);
    const right = marks.filter((f) => f.verdict === "right");
    const wrong = marks.filter((f) => f.verdict === "wrong");
    const missed = marks.filter((f) => f.verdict === "missed");
    const hidden = right.length + wrong.length;
    const report = {
      topicId, right: right.length, wrong: wrong.length, missed: missed.length,
      wrongRate: hidden ? wrong.length / hidden : null,
      suggestion: null,
    };

    if (hidden >= MIN_MARKS && report.wrongRate > TARGET_WRONG_RATE) {
      // lowest threshold at which the marked posts that would still be hidden are wrong at most 10% of the time
      const candidates = [...new Set(right.concat(wrong).map((f) => f.p))].sort((a, b) => a - b);
      for (const t of candidates) {
        const keptRight = right.filter((f) => f.p >= t).length;
        const keptWrong = wrong.filter((f) => f.p >= t).length;
        if (keptRight + keptWrong >= 3 && keptWrong / (keptRight + keptWrong) <= TARGET_WRONG_RATE && t > currentThreshold) {
          report.suggestion = { threshold: Math.min(0.99, Math.round(t * 100) / 100), reason: "too many wrong matches at the current level" };
          break;
        }
      }
      if (!report.suggestion) report.suggestion = { rewrite: true, reason: "wrong at every confidence level: the wording is the problem, not the threshold" };
    } else if (missed.length >= 3 && wrong.length === 0) {
      const lowest = Math.min(...missed.map((f) => (typeof f.p === "number" ? f.p : currentThreshold)));
      const t = Math.max(0.5, Math.round(Math.min(currentThreshold - 0.05, lowest) * 100) / 100);
      if (t < currentThreshold) report.suggestion = { threshold: t, reason: "it keeps missing posts that fit and has not been wrong yet" };
    }
    return report;
  }

  // jevcal's dataset format: one row per marked post, one boolean label per rule the reader judged.
  function toJevcalRows(feedback) {
    const rows = new Map();
    for (const f of feedback) {
      if (!f.state) continue;
      const row = rows.get(f.key) || { id: f.key, state: f.state, labels: {} };
      row.labels[idOf(f)] = f.verdict !== "wrong";
      rows.set(f.key, row);
    }
    return [...rows.values()];
  }

  // `questions` is the map the model is sent: { topicId: { type, instructions, criteria? } }
  function toJevcalQuestionsYaml(questions, model) {
    const lines = [`model: ${model}`, "", "questions:"];
    for (const [id, question] of Object.entries(questions)) {
      lines.push(`  ${id}:`, "    type: noul", `    instructions: ${JSON.stringify(question.instructions)}`);
      if (question.criteria) {
        lines.push("    criteria:", `      "true": ${JSON.stringify(question.criteria.true)}`, `      "false": ${JSON.stringify(question.criteria.false)}`);
      }
    }
    return lines.join("\n") + "\n";
  }

  const api = { MIN_MARKS, TARGET_WRONG_RATE, addFeedback, topicReport, toJevcalRows, toJevcalQuestionsYaml };
  root.FW = Object.assign(root.FW || {}, { stats: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
