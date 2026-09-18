// Runs the real service worker in Node with a fake chrome.* and a fake model API.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

function boot({ settings = {}, respond }) {
  const store = { settings: { apiKey: "test-key", enabledPresets: ["engagement_bait", "politics"], ...settings } };
  let listener = null;
  let changed = null;
  const calls = [];

  globalThis.self = globalThis;
  globalThis.importScripts = (...files) => files.forEach((f) => require(path.join(__dirname, "../src", f)));
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
        set: async (patch) => { await new Promise((r) => setTimeout(r, 1)); Object.assign(store, structuredClone(patch)); },
      },
      onChanged: { addListener: (fn) => (changed = fn) },
    },
    runtime: { onMessage: { addListener: (fn) => (listener = fn) }, onInstalled: { addListener() {} }, openOptionsPage() {} },
  };
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, auth: init.headers.Authorization, body });
    return respond(body);
  };

  delete require.cache[require.resolve("../src/background.js")];
  require("../src/background.js");
  const send = (message) => new Promise((resolve) => listener(message, {}, resolve));
  // what the browser does when the settings page saves
  const changeSettings = (patch) => { store.settings = { ...store.settings, ...patch }; changed({ settings: { newValue: structuredClone(store.settings) } }, "local"); };
  return { send, store, calls, changeSettings };
}

const ok = (answers) => ({ ok: true, json: async () => ({ model: "jev-1.13.0", answers, usage: { input_tokens: 400 } }) });
const post = (text, site = "x") => ({ type: "judge", item: { site, kind: "post", text } });
const T = require("../src/core/topics.js");

test("hides on a confident answer, sends the documented request shape, and records it for review", async () => {
  const { send, store, calls } = boot({ respond: () => ok({ engagement_bait: { type: "noul", noul: 0.97 }, politics: { type: "noul", noul: 0.02 } }) });
  const decision = await send(post("Comment GUIDE below and I will DM you the playbook"));
  assert.equal(decision.action, "hide");
  assert.equal(decision.topicId, "engagement_bait");
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(calls[0].auth, "Bearer test-key");
  assert.deepEqual(Object.keys(calls[0].body), ["state", "model", "questions"]);
  assert.equal(calls[0].body.questions.politics.type, "noul");
  assert.equal(store.recent.length, 1);
  assert.equal(store.recent[0].topicName, "Engagement bait");
});

test("the same post is answered from cache without a second request", async () => {
  const { send, calls, store } = boot({ respond: () => ok({ engagement_bait: { noul: 0.1 }, politics: { noul: 0.1 } }) });
  await send(post("Shipped dark mode today, replaced 40 hex values with CSS variables"));
  const again = await send(post("Shipped dark mode today, replaced 40 hex values with CSS variables"));
  assert.equal(calls.length, 1);
  assert.equal(again.cached, true);
  assert.equal(again.action, "show");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(store.counters.cached, 1);
});

test("fails open on API errors, network errors, a missing key, and when switched off", async () => {
  let env = boot({ respond: () => ({ ok: false, status: 500 }) });
  assert.match((await env.send(post("This post is definitely long enough to judge"))).reason, /^error:/);
  env = boot({ respond: () => { throw new Error("offline"); } });
  assert.equal((await env.send(post("This post is definitely long enough to judge"))).action, "show");
  env = boot({ settings: { apiKey: "" }, respond: () => ok({}) });
  assert.equal((await env.send(post("This post is definitely long enough to judge"))).reason, "no_key");
  assert.equal(env.calls.length, 0);
  env = boot({ settings: { enabled: false }, respond: () => ok({}) });
  assert.equal((await env.send(post("This post is definitely long enough to judge"))).reason, "off");
});

test("stops calling the API once the daily budget is spent, and shows posts instead", async () => {
  const { send, calls } = boot({ settings: { dailyBudget: 2 }, respond: () => ok({ engagement_bait: { noul: 0.99 }, politics: { noul: 0 } }) });
  await send(post("first post that is long enough to be judged"));
  await send(post("second post that is long enough to be judged"));
  const third = await send(post("third post that is long enough to be judged"));
  assert.equal(calls.length, 2);
  assert.deepEqual([third.action, third.reason], ["show", "budget"]);
});

test("counters survive many posts judged at once", async () => {
  const { send, store } = boot({ respond: () => ok({ engagement_bait: { noul: 0.99 }, politics: { noul: 0 } }) });
  await Promise.all(Array.from({ length: 25 }, (_, i) => send(post(`parallel post number ${i} with enough text to judge`))));
  assert.equal(store.counters.judged, 25);
  assert.equal(store.counters.hidden, 25);
  assert.equal(store.counters.tokens, 25 * 400);
  assert.equal(store.recent.length, 25);
});

test("content scripts can read settings but never the key", async () => {
  const { send } = boot({ respond: () => ok({}) });
  const safe = await send({ type: "getSettings" });
  assert.equal(safe.hasKey, true);
  assert.equal("apiKey" in safe, false);
});

test("short posts and disabled sites cost nothing", async () => {
  const { send, calls } = boot({ settings: { disabledSites: ["x"] }, respond: () => ok({}) });
  assert.equal((await send(post("a long enough post but the site is switched off"))).reason, "site_off");
  assert.equal((await send({ type: "judge", item: { site: "reddit", text: "lol" } })).reason, "too_short");
  assert.equal(calls.length, 0);
});

test("a keep topic protects a post that a hide topic also fits, and 'about me' is sent once in the state", async () => {
  const topics = [T.fromLibrary("indie_building", "keep"), T.fromLibrary("hard_sell", "hide")];
  const { send, calls } = boot({ settings: { topics, aboutMe: "indie iOS developer" },
    respond: () => ok({ indie_building: { noul: 0.91 }, hard_sell: { noul: 0.97 } }) });
  const decision = await send(post("Launched my app today: $49 lifetime, 120 sales in 6 hours. Here is the full breakdown of what worked."));
  assert.deepEqual([decision.action, decision.topicId], ["keep", "indie_building"]);
  assert.equal(calls[0].body.state.reader, "indie iOS developer");
  assert.deepEqual(Object.keys(calls[0].body.questions), ["indie_building", "hard_sell"]);
});

test("focus mode filters on the chosen site only; switching it off re-decides from cache with no new request", async () => {
  const topics = [T.fromLibrary("indie_building", "highlight")];
  const env = boot({ settings: { topics, focusSites: ["x"] }, respond: () => ok({ indie_building: { noul: 0.05 } }) });
  const gossip = "Celebrity gossip that has nothing to do with software at all";
  assert.equal((await env.send(post(gossip))).action, "filter");
  assert.equal((await env.send(post(gossip, "reddit"))).action, "show");
  assert.equal(env.calls.length, 2);
  env.changeSettings({ focusSites: [] });
  const again = await env.send(post(gossip));
  assert.deepEqual([again.action, again.cached], ["show", true]);
  assert.equal(env.calls.length, 2);
});

test("'Test it' runs a draft topic over recently seen posts, sorted by fit, without touching saved topics", async () => {
  const env = boot({ respond: (body) => ok(body.questions.t
    ? { t: { noul: /launch/i.test(body.state.text) ? 0.93 : 0.04 } }
    : { engagement_bait: { noul: 0.01 }, politics: { noul: 0.01 } }) });
  await env.send(post("We launched our invoicing app today and got our first ten customers"));
  await env.send(post("Does anyone know a good way to debounce scroll handlers in React?"));
  const before = JSON.stringify(env.store.settings);
  const out = await env.send({ type: "testTopic", topic: { name: "Launches", description: "Posts announcing a product launch", action: "highlight" } });
  assert.equal(out.results.length, 2);
  assert.match(out.results[0].text, /launched/);
  assert.ok(out.results[0].p > out.results[1].p);
  assert.equal(JSON.stringify(env.store.settings), before);
  const empty = boot({ respond: () => ok({}) });
  assert.match((await empty.send({ type: "testTopic", topic: { name: "x", description: "some topic text" } })).error, /No recent posts/);
});

test("teaching an example changes that topic's wording and nothing else", async () => {
  const topics = [T.fromLibrary("indie_building", "keep"), T.fromLibrary("hard_sell", "hide")];
  const env = boot({ settings: { topics }, respond: () => ok({}) });
  await env.send({ type: "addExample", topicId: "indie_building", side: "yes", text: "Hit $1k MRR with my habit tracker. Pricing went from $3 to $5 and churn did not move." });
  const saved = env.store.settings.topics;
  assert.equal(saved[0].examples.yes.length, 1);
  assert.deepEqual(saved[1].examples, { yes: [], no: [] });
  assert.match(T.toQuestion(saved[0]).criteria.true, /Examples that fit: "Hit \$1k MRR/);
  assert.equal(env.store.settings.apiKey, "test-key"); // the rest of the settings survive the write
});
