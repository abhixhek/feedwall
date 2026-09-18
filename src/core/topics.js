// Topics: the reader's own classifications. Each one is a yes/no question a decision model can answer, plus what to
// do when a post fits. Classic script (no modules) so the same file loads in the worker, in pages, and in Node tests.
(function (root) {
  "use strict";

  const ACTIONS = ["hide", "dim", "highlight", "keep"]; // keep = highlight + never hidden by another topic
  const WANTED = new Set(["highlight", "keep"]);
  const MAX_TOPICS = 40;
  const MAX_EXAMPLES = 3;
  const LIMITS = { name: 60, description: 300, counts: 300, example: 160, aboutMe: 300 };

  // The model answers the question as written, so each starter topic spells out both sides of the boundary.
  const LIBRARY = [
    { id: "engagement_bait", name: "Engagement bait", action: "hide",
      description: "Is this post engagement bait?",
      counts: "Its main purpose is to collect replies, likes, reposts, or follows: 'comment X and I will send you', 'like if you agree', 'tag someone who', hooks that withhold the point, giveaways for follows.",
      notCounts: "It shares an actual opinion, fact, question, update, or piece of work, even if it is popular or promotional." },
    { id: "rage_bait", name: "Rage bait", action: "hide",
      description: "Is this post written mainly to make readers angry?",
      counts: "Inflammatory framing, insults aimed at a group, or a deliberately provocative claim with no argument behind it.",
      notCounts: "Calm disagreement, criticism with reasons, or a strong opinion that is explained." },
    { id: "politics", name: "Politics", action: "hide",
      description: "Is this post about partisan politics?",
      counts: "Elections, politicians, political parties, government leaders, or culture-war issues.",
      notCounts: "Anything else, including technology policy discussed in technical terms." },
    { id: "ai_slop", name: "Generic filler", action: "hide",
      description: "Is this post generic filler with nothing specific in it?",
      counts: "Formulaic hooks and lists, empty motivational phrasing, or broad claims with no concrete detail, number, name, example, or first-hand experience.",
      notCounts: "It contains specifics: concrete numbers, names, code, a first-hand account, or an original argument." },
    { id: "crypto_shill", name: "Crypto promotion", action: "hide",
      description: "Is this post promoting a cryptocurrency, token, NFT, or trading scheme?",
      counts: "It urges buying, holding, minting, or joining, or hypes price movement of a specific coin or project.",
      notCounts: "Neutral technical or news discussion of crypto, or a post about another topic." },
    { id: "hard_sell", name: "Hard sell", action: "hide",
      description: "Is this post mainly an advertisement for a paid course, newsletter, community, or coaching offer?",
      counts: "The point of the post is to push the reader toward buying or signing up, often with urgency or income claims.",
      notCounts: "A builder sharing what they made, a launch announcement with substance, or a post that mentions a product in passing." },
    { id: "distressing_news", name: "Distressing news", action: "hide",
      description: "Is this post about a violent or distressing news event?",
      counts: "War casualties, violent crime, disasters, abuse, or graphic accidents.",
      notCounts: "Everything else, including ordinary bad news about business or technology." },
    { id: "indie_building", name: "Indie building", action: "highlight",
      description: "Is this post about building, launching, pricing, or marketing a small software product?",
      counts: "Build logs, launch write-ups, revenue or user numbers, pricing experiments, distribution tactics, lessons from shipping, by an individual or a tiny team.",
      notCounts: "Generic motivation, course or community ads, big-company news, or commentary with no product behind it." },
    { id: "technical_depth", name: "Technical depth", action: "highlight",
      description: "Does this post teach something technical in concrete detail?",
      counts: "Code, benchmarks, architecture decisions, debugging stories, or measurements with specifics a practitioner could reuse.",
      notCounts: "Opinions about tools with no detail, announcements, hype, or jokes." },
    { id: "hiring", name: "Hiring and jobs", action: "highlight",
      description: "Is this post announcing an open role or looking for someone to hire?",
      counts: "A specific role, company or project, and a way to apply or get in touch.",
      notCounts: "Career advice, layoffs news, or people saying they are looking for work." },
  ];

  const BUILT_IN_SETS = [
    { name: "Indie builder", aboutMe: "I build small software products on my own and care about launches, distribution, pricing, and honest numbers.",
      topics: [["indie_building", "keep"], ["technical_depth", "highlight"], ["engagement_bait", "hide"], ["hard_sell", "hide"], ["ai_slop", "hide"], ["crypto_shill", "hide"]] },
    { name: "Deep work", aboutMe: "I want a calm feed with substance and nothing designed to provoke me.",
      topics: [["technical_depth", "keep"], ["engagement_bait", "hide"], ["rage_bait", "hide"], ["politics", "hide"], ["distressing_news", "hide"], ["ai_slop", "hide"]] },
    { name: "Job hunt", aboutMe: "I am looking for a software job and want to see real openings.",
      topics: [["hiring", "keep"], ["hard_sell", "hide"], ["engagement_bait", "hide"], ["ai_slop", "dim"]] },
    { name: "Research", aboutMe: "I read feeds to learn. I want evidence and detail, not takes.",
      topics: [["technical_depth", "keep"], ["ai_slop", "hide"], ["engagement_bait", "hide"], ["rage_bait", "hide"], ["crypto_shill", "hide"]] },
  ];

  const LINT = [
    { id: "negation", re: /\b(not|never|no longer|isn't|aren't|doesn't|don't|without|except|unless)\b/i,
      message: "Avoid negations. Describe what the posts look like; use 'What doesn't count' for the other side." },
    { id: "compound", re: /\b(and also|as well as)\b|;/i,
      message: "This reads like two topics. One thing per topic works better, and extra topics are nearly free." },
    { id: "vague", re: /\b(bad|annoying|boring|stupid|dumb|low quality|cringe|toxic|good|interesting|useful|relevant)\b/i,
      message: "This word means different things to different people. Say what the posts look like." },
    { id: "counting", re: /\b(more than \d+|at least \d+|fewer than \d+|less than \d+|how many|number of)\b/i,
      message: "The model cannot count reliably. Describe the kind of post instead." },
  ];

  function hashString(text) {
    // cyrb53: fast, synchronous, good enough for cache keys and ids.
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

  const clean = (value, max) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);

  function lintTopic(description) {
    const text = clean(description, LIMITS.description);
    const warnings = [];
    if (text.split(" ").filter(Boolean).length < 3) {
      warnings.push({ id: "short", message: "Too short. Describe the kind of post, e.g. 'posts about launching or pricing a small software product'." });
    }
    for (const rule of LINT) if (rule.re.test(text)) warnings.push({ id: rule.id, message: rule.message });
    return warnings;
  }

  // Everything that comes from outside (imports, old settings, the editor) passes through here, so a topic is always
  // a small bag of bounded strings and known enums. Returns null when there is nothing usable.
  function sanitizeTopic(raw) {
    if (!raw || typeof raw !== "object") return null;
    const description = clean(raw.description, LIMITS.description);
    const name = clean(raw.name || description, LIMITS.name);
    if (!name || !description) return null;
    const examples = raw.examples && typeof raw.examples === "object" ? raw.examples : {};
    const list = (values) => (Array.isArray(values) ? values : []).map((v) => clean(v, LIMITS.example)).filter(Boolean).slice(-MAX_EXAMPLES);
    const sites = Array.isArray(raw.sites) && raw.sites.length ? raw.sites.map((s) => clean(s, 20)).filter(Boolean) : null;
    const threshold = typeof raw.threshold === "number" && raw.threshold >= 0.05 && raw.threshold <= 0.99 ? raw.threshold : null;
    return {
      id: clean(raw.id, 40).replace(/[^a-z0-9_]/gi, "_") || "t_" + hashString(name.toLowerCase() + "|" + description.toLowerCase()),
      name, description,
      counts: clean(raw.counts, LIMITS.counts),
      notCounts: clean(raw.notCounts, LIMITS.counts),
      examples: { yes: list(examples.yes), no: list(examples.no) },
      action: ACTIONS.includes(raw.action) ? raw.action : "hide",
      sites, threshold,
      enabled: raw.enabled !== false,
    };
  }

  const fromLibrary = (id, action) => {
    const entry = LIBRARY.find((t) => t.id === id);
    return entry ? sanitizeTopic({ ...entry, action: action || entry.action }) : null;
  };

  function topicsFromSet(set) {
    return (set.topics || []).map((t) => (Array.isArray(t) ? fromLibrary(t[0], t[1]) : sanitizeTopic(t))).filter(Boolean).slice(0, MAX_TOPICS);
  }

  // v0.1 stored presets, custom rules and per-rule thresholds separately. Carry them over once.
  function migrate(settings) {
    if (Array.isArray(settings.topics)) return settings.topics.map(sanitizeTopic).filter(Boolean).slice(0, MAX_TOPICS);
    const thresholds = settings.ruleThresholds || {};
    const enabled = settings.enabledPresets || ["engagement_bait", "rage_bait", "ai_slop"];
    const topics = enabled.map((id) => fromLibrary(id)).filter(Boolean);
    for (const rule of settings.customRules || []) {
      const topic = sanitizeTopic({ id: rule.id, name: rule.label, description: rule.label, action: "hide" });
      if (topic) topics.push(topic);
    }
    for (const topic of topics) if (typeof thresholds[topic.id] === "number") topic.threshold = thresholds[topic.id];
    return topics;
  }

  function activeTopics(settings, site) {
    return (settings.topics || []).filter((t) => t.enabled !== false && (!site || !t.sites || t.sites.includes(site)));
  }

  function toQuestion(topic) {
    const asked = /\?\s*$/.test(topic.description) ? topic.description : `Does this post fit this description: "${topic.description}"?`;
    const side = (text, examples, lead) => [text, examples.length ? `${lead} ${examples.map((e) => `"${e}"`).join(" | ")}` : ""].filter(Boolean).join(" ");
    const yes = side(topic.counts, topic.examples.yes, "Examples that fit:");
    const no = side(topic.notCounts, topic.examples.no, "Examples that do not fit:");
    const question = { type: "noul", instructions: asked };
    if (yes || no) question.criteria = { true: yes || "The post fits the description.", false: no || "The post does not fit the description." };
    return question;
  }

  const toQuestions = (topics) => Object.fromEntries(topics.map((t) => [t.id, toQuestion(t)]));

  // Changes whenever the wording sent to the model changes, so cached answers are never reused across edits.
  // Actions, thresholds and sites are not part of it: those only change what we do with an answer.
  function questionsVersion(topics, aboutMe) {
    return hashString(JSON.stringify([clean(aboutMe, LIMITS.aboutMe), topics.map((t) => [t.id, toQuestion(t)])]));
  }

  // Calibrated against real usage on 2026-09-18: about 3 characters per token for this JSON, plus a typical post.
  const estimateTokens = (topics, aboutMe) =>
    Math.ceil((JSON.stringify(toQuestions(topics)).length + clean(aboutMe, LIMITS.aboutMe).length) / 3) + 110;

  // Sets: a shareable bundle of "about me" + topics. The code is plain text so it can be pasted anywhere.
  const SET_PREFIX = "feedwall:v1:";
  const b64encode = (text) => (typeof btoa === "function" ? btoa(unescape(encodeURIComponent(text))) : Buffer.from(text, "utf8").toString("base64"));
  const b64decode = (text) => (typeof atob === "function" ? decodeURIComponent(escape(atob(text))) : Buffer.from(text, "base64").toString("utf8"));

  function exportSet(name, settings) {
    const payload = { name: clean(name, LIMITS.name) || "My set", aboutMe: clean(settings.aboutMe, LIMITS.aboutMe),
                      topics: (settings.topics || []).map(({ enabled, ...topic }) => topic) };
    return SET_PREFIX + b64encode(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function importSet(code) {
    const text = String(code || "").trim();
    let payload;
    try {
      payload = text.startsWith(SET_PREFIX)
        ? JSON.parse(b64decode(text.slice(SET_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/")))
        : JSON.parse(text);
    } catch (error) {
      throw new Error("That is not a Feedwall set. Paste the whole code, starting with feedwall:v1:");
    }
    const topics = topicsFromSet(payload || {});
    if (!topics.length) throw new Error("This set has no usable topics.");
    return { name: clean(payload.name, LIMITS.name) || "Imported set", aboutMe: clean(payload.aboutMe, LIMITS.aboutMe), topics };
  }

  const api = { ACTIONS, WANTED, LIBRARY, BUILT_IN_SETS, MAX_TOPICS, MAX_EXAMPLES, LIMITS, lintTopic, sanitizeTopic, fromLibrary,
                topicsFromSet, migrate, activeTopics, toQuestion, toQuestions, questionsVersion, estimateTokens,
                exportSet, importSet, hashString, clean };
  root.FW = Object.assign(root.FW || {}, { topics: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
