// The accuracy loop: the reader's "right / wrong / missed" marks become a per-rule report and a threshold suggestion.
(function (root) {
  "use strict";

  const MIN_MARKS = 8; // below this a suggestion would be noise
  const TARGET_WRONG_RATE = 0.1;
  const MAX_FEEDBACK = 2000;

  function addFeedback(list, entry) {
    const next = list.filter((f) => f.key !== entry.key || f.ruleId !== entry.ruleId);
    next.push(entry);
    return next.slice(-MAX_FEEDBACK);
  }

  // verdicts: "right" (hidden, correctly) | "wrong" (hidden, should not have been) | "missed" (shown, should have been hidden)
  function ruleReport(feedback, ruleId, currentThreshold) {
    const marks = feedback.filter((f) => f.ruleId === ruleId);
    const right = marks.filter((f) => f.verdict === "right");
    const wrong = marks.filter((f) => f.verdict === "wrong");
    const missed = marks.filter((f) => f.verdict === "missed");
    const hidden = right.length + wrong.length;
    const report = {
      ruleId, right: right.length, wrong: wrong.length, missed: missed.length,
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
          report.suggestion = { threshold: Math.min(0.99, Math.round(t * 100) / 100), reason: "too many wrong hides at the current level" };
          break;
        }
      }
      if (!report.suggestion) report.suggestion = { rewrite: true, reason: "wrong at every confidence level: the rule wording is the problem, not the threshold" };
    } else if (missed.length >= 3 && wrong.length === 0) {
      const lowest = Math.min(...missed.map((f) => (typeof f.p === "number" ? f.p : currentThreshold)));
      const t = Math.max(0.5, Math.round(Math.min(currentThreshold - 0.05, lowest) * 100) / 100);
      if (t < currentThreshold) report.suggestion = { threshold: t, reason: "it keeps missing posts you wanted hidden and has not been wrong yet" };
    }
    return report;
  }

  // jevcal's dataset format: one row per marked post, one boolean label per rule the reader judged.
  function toJevcalRows(feedback) {
    const rows = new Map();
    for (const f of feedback) {
      if (!f.state) continue;
      const row = rows.get(f.key) || { id: f.key, state: f.state, labels: {} };
      row.labels[f.ruleId] = f.verdict !== "wrong";
      rows.set(f.key, row);
    }
    return [...rows.values()];
  }

  function toJevcalQuestionsYaml(rules, model) {
    const lines = [`model: ${model}`, "", "questions:"];
    for (const rule of rules) {
      lines.push(`  ${rule.id}:`, "    type: noul", `    instructions: ${JSON.stringify(rule.instructions)}`);
      if (rule.criteria) {
        lines.push("    criteria:", `      "true": ${JSON.stringify(rule.criteria.true)}`, `      "false": ${JSON.stringify(rule.criteria.false)}`);
      }
    }
    return lines.join("\n") + "\n";
  }

  const api = { MIN_MARKS, TARGET_WRONG_RATE, addFeedback, ruleReport, toJevcalRows, toJevcalQuestionsYaml };
  root.FW = Object.assign(root.FW || {}, { stats: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
