// Runs the real service worker in Node with a fake chrome.* and a fake model API.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

function boot({ settings = {}, respond }) {
  const store = { settings: { apiKey: "test-key", enabledPresets: ["engagement_bait", "politics"], ...settings } };
  let listener = null;
  const calls = [];

  globalThis.self = globalThis;
  globalThis.importScripts = (...files) => files.forEach((f) => require(path.join(__dirname, "../src", f)));
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
        set: async (patch) => { await new Promise((r) => setTimeout(r, 1)); Object.assign(store, structuredClone(patch)); },
      },
      onChanged: { addListener() {} },
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
  return { send, store, calls };
}

const ok = (answers) => ({ ok: true, json: async () => ({ model: "jev-1.13.0", answers, usage: { input_tokens: 400 } }) });
const post = (text) => ({ type: "judge", item: { site: "x", kind: "post", text } });

test("hides on a confident answer, sends the documented request shape, and records it for review", async () => {
  const { send, store, calls } = boot({ respond: () => ok({ engagement_bait: { type: "noul", noul: 0.97 }, politics: { type: "noul", noul: 0.02 } }) });
  const decision = await send(post("Comment GUIDE below and I will DM you the playbook"));
  assert.equal(decision.action, "hide");
  assert.equal(decision.ruleId, "engagement_bait");
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(calls[0].auth, "Bearer test-key");
  assert.deepEqual(Object.keys(calls[0].body), ["state", "model", "questions"]);
  assert.equal(calls[0].body.questions.politics.type, "noul");
  assert.equal(store.recent.length, 1);
  assert.equal(store.recent[0].ruleLabel, "Engagement bait");
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
