// Rules: what the reader does not want to see, phrased as yes/no questions a decision model can answer.
// Classic script (no modules) so the same file loads in the service worker, in content scripts, and in Node tests.
(function (root) {
  "use strict";

  // Jev answers the question as written, so each preset spells out both sides of the boundary.
  const PRESETS = [
    {
      id: "engagement_bait",
      label: "Engagement bait",
      instructions: "Is this post engagement bait?",
      criteria: {
        true: "Its main purpose is to collect replies, likes, reposts, or follows: 'comment X and I will send you', 'like if you agree', 'tag someone who', hooks that withhold the point, giveaways for follows.",
        false: "It shares an actual opinion, fact, question, update, or piece of work, even if it is popular or promotional.",
      },
    },
    {
      id: "rage_bait",
      label: "Rage bait",
      instructions: "Is this post written mainly to make readers angry?",
      criteria: {
        true: "Inflammatory framing, insults aimed at a group, or a deliberately provocative claim with no argument behind it.",
        false: "Calm disagreement, criticism with reasons, or a strong opinion that is explained.",
      },
    },
    {
      id: "politics",
      label: "Politics",
      instructions: "Is this post about partisan politics?",
      criteria: {
        true: "Elections, politicians, political parties, government leaders, or culture-war issues.",
        false: "Anything else, including technology policy discussed in technical terms.",
      },
    },
    {
      id: "ai_slop",
      label: "Generic filler",
      instructions: "Is this post generic filler with nothing specific in it?",
      criteria: {
        true: "Formulaic hooks and lists, empty motivational phrasing, or broad claims with no concrete detail, number, name, example, or first-hand experience.",
        false: "It contains specifics: concrete numbers, names, code, a first-hand account, or an original argument.",
      },
    },
    {
      id: "crypto_shill",
      label: "Crypto promotion",
      instructions: "Is this post promoting a cryptocurrency, token, NFT, or trading scheme?",
      criteria: {
        true: "It urges buying, holding, minting, or joining, or hypes price movement of a specific coin or project.",
        false: "Neutral technical or news discussion of crypto, or a post about another topic.",
      },
    },
    {
      id: "hard_sell",
      label: "Hard sell",
      instructions: "Is this post mainly an advertisement for a paid course, newsletter, community, or coaching offer?",
      criteria: {
        true: "The point of the post is to push the reader toward buying or signing up, often with urgency or income claims.",
        false: "A builder sharing what they made, a launch announcement with substance, or a post that mentions a product in passing.",
      },
    },
    {
      id: "distressing_news",
      label: "Distressing news",
      instructions: "Is this post about a violent or distressing news event?",
      criteria: {
        true: "War casualties, violent crime, disasters, abuse, or graphic accidents.",
        false: "Everything else, including ordinary bad news about business or technology.",
      },
    },
  ];

  const LINT = [
    { id: "negation", re: /\b(not|never|no longer|isn't|aren't|doesn't|don't|without|except|unless)\b/i,
      message: "Avoid negations. Describe what you want hidden, not what you want kept." },
    { id: "compound", re: /\b(and|or)\b/i,
      message: "This reads like two rules. One thing per rule works better, and extra rules are nearly free." },
    { id: "vague", re: /\b(bad|annoying|boring|stupid|dumb|low quality|cringe|toxic)\b/i,
      message: "This word means different things to different people. Say what the posts look like." },
    { id: "counting", re: /\b(more than \d+|at least \d+|fewer than \d+|less than \d+|how many|number of)\b/i,
      message: "The model cannot count reliably. Describe the kind of post instead." },
  ];

  function hashString(text) {
    // cyrb53: fast, synchronous, good enough for cache keys.
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  function lintRule(text) {
    const trimmed = (text || "").trim();
    const warnings = [];
    if (trimmed.split(/\s+/).filter(Boolean).length < 2) {
      warnings.push({ id: "short", message: "Too short. Describe the kind of post, e.g. 'posts hyping a product launch countdown'." });
    }
    for (const rule of LINT) if (rule.re.test(trimmed)) warnings.push({ id: rule.id, message: rule.message });
    return warnings;
  }

  function makeCustomRule(text) {
    const description = text.trim().replace(/\s+/g, " ");
    return {
      id: "custom_" + hashString(description.toLowerCase()),
      label: description,
      custom: true,
      instructions: `Does this post match this description: "${description}"?`,
      criteria: null,
    };
  }

  function activeRules(settings) {
    const enabled = new Set(settings.enabledPresets || []);
    return PRESETS.filter((p) => enabled.has(p.id)).concat(settings.customRules || []);
  }

  function toQuestions(rules) {
    const questions = {};
    for (const rule of rules) {
      questions[rule.id] = { type: "noul", instructions: rule.instructions };
      if (rule.criteria) questions[rule.id].criteria = rule.criteria;
    }
    return questions;
  }

  // Changes whenever the wording of any active rule changes, so cached decisions are never reused across rule edits.
  function rulesVersion(rules) {
    return hashString(JSON.stringify(rules.map((r) => [r.id, r.instructions, r.criteria])));
  }

  const api = { PRESETS, lintRule, makeCustomRule, activeRules, toQuestions, rulesVersion, hashString };
  root.FW = Object.assign(root.FW || {}, { rules: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
