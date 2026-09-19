// The trailer's timeline. Nothing here runs on the wall clock: window.__trailer.seek(t) puts every element where it
// belongs at second t, so render.mjs can capture frame by frame and get the same film every time.
(function () {
  "use strict";
  const D = window.TRAILER_DATA;
  const $ = (id) => document.getElementById(id);
  const FPS = 30, DUR = 78, BAR_H = 37;

  // ---------------------------------------------------------------- engine
  const ease = {
    lin: (p) => p,
    out: (p) => 1 - Math.pow(1 - p, 3),
    out5: (p) => 1 - Math.pow(1 - p, 5),
    in: (p) => p * p * p,
    inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    back: (p) => 1 + 2.4 * Math.pow(p - 1, 3) + 1.4 * Math.pow(p - 1, 2),
  };
  const groups = new Map(), cues = [], perFrame = [], sfxList = [], dirty = new Set();
  let uid = 0, cueIndex = 0;

  function tw(el, prop, t0, dur, from, to, e) {
    if (!el.__id) el.__id = ++uid;
    const key = el.__id + ":" + prop;
    if (!groups.has(key)) groups.set(key, { el, prop, tracks: [] });
    groups.get(key).tracks.push({ t0, dur, from, to, e: e || ease.out });
  }
  const cue = (t, fn) => cues.push({ t, fn });
  const sfx = (t, type, extra) => sfxList.push({ t: Math.round(t * 1000) / 1000, type, ...(extra || {}) });
  const onFrame = (fn) => perFrame.push(fn);

  function applyProp(el, prop, v) {
    if (el.apply) return el.apply(v);
    if (prop === "opacity") {
      el.style.opacity = v;
      if (el.__vis) el.style.visibility = v > 0.001 ? "visible" : "hidden";
    } else if (prop === "h") el.style.height = v + "px";
    else { (el.__tf || (el.__tf = { x: 0, y: 0, s: 1, r: 0 }))[prop] = v; dirty.add(el); }
  }
  const resolve = (track, side) => (typeof track[side] === "function" ? (track[side] = track[side]()) : track[side]);

  async function seek(t) {
    while (cueIndex < cues.length && cues[cueIndex].t <= t + 1e-6) { const r = cues[cueIndex++].fn(); if (r && r.then) await r; }
    for (const { el, prop, tracks } of groups.values()) {
      let active = null;
      for (const track of tracks) { if (track.t0 <= t + 1e-6) active = track; else break; }
      if (!active) { if (typeof tracks[0].from !== "function") applyProp(el, prop, tracks[0].from); continue; }
      const from = resolve(active, "from"), to = resolve(active, "to");
      const p = active.dur <= 0 ? 1 : Math.min(1, Math.max(0, (t - active.t0) / active.dur));
      applyProp(el, prop, from + (to - from) * active.e(p));
    }
    for (const fn of perFrame) fn(t);
    for (const node of fixed) if (node.scrollTop || node.scrollLeft) { node.scrollTop = 0; node.scrollLeft = 0; }
    for (const el of dirty) { const f = el.__tf; el.style.transform = `translate(${f.x}px, ${f.y}px) rotate(${f.r}deg) scale(${f.s})`; }
    dirty.clear();
  }

  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
  const el = (tag, cls, html) => { const node = document.createElement(tag); if (cls) node.className = cls; if (html != null) node.innerHTML = html; return node; };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const fade = (node, tIn, tOut, dIn, dOut) => { tw(node, "opacity", tIn, dIn || 0.4, 0, 1); if (tOut != null) tw(node, "opacity", tOut, dOut || 0.3, 1, 0, ease.inOut); };
  const vis = (...nodes) => nodes.forEach((n) => { n.__vis = true; });

  function words(container, text, t0, step, highlight) {
    text.split(" ").forEach((word, i) => {
      const span = el("span", highlight && highlight.includes(word.replace(/[^\w’]/g, "")) ? "hl" : "", esc(word));
      container.append(span, " ");
      tw(span, "opacity", t0 + i * step, 0.35, 0, 1); tw(span, "y", t0 + i * step, 0.5, 16, 0, ease.out5);
    });
  }
  function caption(t0, t1, kicker, text) {
    const node = el("div", "cap", `<div class="k">${esc(kicker)}</div><div class="t">${esc(text)}</div>`);
    $("captions").append(node);
    fade(node, t0, t1 - 0.3, 0.35, 0.3); tw(node, "y", t0, 0.5, 14, 0, ease.out5);
  }

  // ---------------------------------------------------------------- camera, cursor
  const cam = $("cam"), cursor = $("cursor"), win = $("win");
  const fixed = [document.scrollingElement, $("stage"), win, document.querySelector(".win-body"), ...document.querySelectorAll(".site")];
  cursor.__tf = { x: 700, y: 380, s: 1, r: 0 };
  function camTo(t0, dur, fx, fy, s, e) { // put stage point (fx, fy) at the middle of the picture, at scale s
    tw(cam, "s", t0, dur, () => cam.__tf.s, s, e || ease.inOut);
    tw(cam, "x", t0, dur, () => cam.__tf.x, 640 - fx * s, e || ease.inOut);
    tw(cam, "y", t0, dur, () => cam.__tf.y, 318 - fy * s, e || ease.inOut);
  }
  function winPoint(node, frame) { // centre of a node in #win coordinates, whatever the camera is doing
    const wr = win.getBoundingClientRect(), k = wr.width / win.offsetWidth, r = node.getBoundingClientRect();
    if (!frame) return { x: (r.left + r.width / 2 - wr.left) / k, y: (r.top + r.height / 2 - wr.top) / k };
    const fr = frame.getBoundingClientRect();
    return { x: (fr.left - wr.left) / k + r.left + r.width / 2, y: (fr.top - wr.top) / k + r.top + r.height / 2 };
  }
  function click(t, target, action, sound) {
    let point; const at = () => point || (point = target());
    tw(cursor, "x", t - 0.8, 0.68, () => cursor.__tf.x, () => at().x + 2, ease.inOut);
    tw(cursor, "y", t - 0.8, 0.68, () => cursor.__tf.y, () => at().y + 4, ease.inOut);
    tw(cursor, "s", t - 0.07, 0.07, 1, 0.8); tw(cursor, "s", t, 0.2, 0.8, 1);
    const ring = el("div", "ripple"); $("ripples").append(ring);
    tw(ring, "x", t, 0, 0, () => at().x); tw(ring, "y", t, 0, 0, () => at().y);
    tw(ring, "s", t, 0.5, 0.25, 1.5); tw(ring, "opacity", t, 0.5, 0.95, 0);
    if (action) cue(t, action);
    sfx(t, sound || "click");
  }

  // ---------------------------------------------------------------- what the extension does to a post
  const noteFor = (v) => (v[0] === "keep" ? "★ kept " : v[0] === "highlight" ? "★ " : "") + `${v[1]} · ${v[2]}%`;
  function bar(v) {
    const node = el("div", "fw-bar", `<span class="fw-bar-text">Hidden · ${esc(v[1])} · ${v[2]}%</span><button class="fw-btn">Show</button><button class="fw-btn">Wrong?</button>`);
    return node;
  }
  function collapse(post, t, quiet) {
    const d = quiet ? 0 : 1;
    tw(post.__body, "opacity", t, 0.22 * d, 1, 0); tw(post, "h", t + 0.04 * d, 0.38 * d, post.__h, post.__barH, ease.inOut); tw(post.__bar, "opacity", t + 0.16 * d, 0.26 * d, 0, 1);
    if (!quiet) sfx(t, "pop");
  }
  function expand(post, t) {
    tw(post.__bar, "opacity", t, 0.18, 1, 0); tw(post, "h", t, 0.42, post.__barH, post.__h, ease.inOut); tw(post.__body, "opacity", t + 0.14, 0.3, 0, 1);
    sfx(t, "unpop");
  }
  function mark(post, t, v, quiet) {
    cue(t, () => { post.setAttribute("data-fw-state", "marked"); post.setAttribute("data-fw-note", noteFor(v)); });
    if (quiet) return;
    tw(post.__glow, "opacity", t, 0.14, 0, 1); tw(post.__glow, "opacity", t + 0.14, 1.0, 1, 0, ease.inOut);
    sfx(t, "spark");
  }
  function dim(post, t, v, quiet) {
    tw(post, "opacity", t, quiet ? 0 : 0.45, 1, 0.42, ease.inOut);
    cue(t, () => { post.setAttribute("data-fw-state", "dim"); post.setAttribute("data-fw-note", noteFor(v)); });
    if (!quiet) sfx(t, "dim");
  }
  function act(post, t, quiet) {
    const v = post.__v; if (!v) return;
    if (v[0] === "hide") collapse(post, t, quiet); else if (v[0] === "dim") dim(post, t, v, quiet); else mark(post, t, v, quiet);
  }
  const initials = (name) => name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("");
  const avatar = (p) => `<div class="av" style="background:${p.c}">${initials(p.n || p.ch)}</div>`;
  const ICON = {
    reply: '<svg viewBox="0 0 24 24"><path d="M4 11.5a7.5 7.5 0 0 1 7.500-7.500h1a7.500 7.500 0 0 1 3.600 14.080L10 21v-3.500A7.500 7.500 0 0 1 4 11.500z"/></svg>',
    repost: '<svg viewBox="0 0 24 24"><path d="M5 9l3-3 3 3M8 6v9a3 3 0 0 0 3 3h3M19 15l-3 3-3-3M16 18V9a3 3 0 0 0-3-3h-3"/></svg>',
    like: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.400-7-9.500A4 4 0 0 1 12 8a4 4 0 0 1 7 2.500C19 15.600 12 20 12 20z"/></svg>',
    views: '<svg viewBox="0 0 24 24"><path d="M6 20v-6M12 20V5M18 20v-9"/></svg>',
  };

  // ---------------------------------------------------------------- build the sample sites
  function buildX() {
    const site = $("site-x");
    site.innerHTML = `<div class="x-nav">${["Home", "Explore", "Notifications", "Chat", "Bookmarks", "Profile"].map((n) => `<div><i></i>${n}</div>`).join("")}<div class="postbtn">Post</div></div>
      <div class="x-col"><div class="x-tabs"><div>For you</div><div>Following</div></div><div class="x-feed" id="x-feed"></div>
        <div class="fw-chip" id="x-chip"><span class="fw-chip-text">Focus · 9 filtered</span><button class="fw-btn">Peek</button></div></div>
      <div class="x-side"><div class="x-search"></div><div class="x-card"><b>What’s happening</b><p>Trending<strong>#Outrage</strong>412K posts</p><p>Trending<strong>Hot take of the day</strong>98K posts</p><p>Promoted<strong>10x your morning</strong></p><p>Trending<strong>#Giveaway</strong>1.2M posts</p></div></div>`;
    return D.x.map((p) => {
      const post = el("div", "xp", `<div class="glow"></div><div class="xp-body">${avatar(p)}<div class="xp-main"><div class="xp-head"><b>${esc(p.n)}</b><span>${p.h} · ${p.tm}</span></div>
        <div class="xp-text">${esc(p.tx)}</div><div class="xp-stats"><span>${ICON.reply}${p.st[0]}</span><span>${ICON.repost}${p.st[1]}</span><span>${ICON.like}${p.st[2]}</span><span>${ICON.views}${p.st[3]}</span></div></div></div>`);
      return finishPost(post, p, $("x-feed"), ".xp-body", BAR_H);
    });
  }
  function finishPost(post, p, parent, bodySelector, barH) {
    post.__v = p.v; post.__body = post.querySelector(bodySelector); post.__glow = post.querySelector(".glow");
    if (p.v && p.v[0] === "hide") { post.__bar = bar(p.v); post.prepend(post.__bar); }
    parent.append(post); post.__barH = barH;
    return post;
  }
  function buildLinkedIn() {
    const site = $("site-li");
    site.innerHTML = `<div class="li-top"><div class="li-mark"></div><div class="li-search"></div><div class="li-navdots"><i></i><i></i><i></i><i></i><i></i></div></div><div class="li-left"></div><div class="li-feed" id="li-feed"></div>`;
    return D.linkedin.map((p) => {
      const post = el("div", "lp", `<div class="glow"></div><div class="lp-body"><div class="lp-head">${avatar(p)}<div><b>${esc(p.n)}</b><span>${esc(p.hl)}</span><span>2h · Edited</span></div></div>
        <div class="lp-text">${esc(p.tx)}</div><div class="lp-react">👍❤️👏 ${p.r}</div><div class="lp-actions"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div></div>`);
      return finishPost(post, p, $("li-feed"), ".lp-body", BAR_H + 2);
    });
  }
  function buildYouTube() {
    const site = $("site-yt");
    site.innerHTML = `<div class="yt-top"><div class="yt-play"></div><div class="yt-search"></div></div><div class="yt-chips">${["All", "Programming", "Podcasts", "Live", "Databases", "Recently uploaded"].map((c) => `<span>${c}</span>`).join("")}</div><div class="yt-grid" id="yt-grid"></div>`;
    return D.youtube.map((p) => {
      const card = el("div", "yv", `<div class="yv-thumb" style="background:${p.bg}">${p.bait ? `<b>${esc(p.bait)}</b>` : `<code>${esc(p.code)}</code>`}<em>${p.d}</em></div>
        <div class="yv-meta">${avatar(p)}<div><b>${esc(p.t)}</b><span>${esc(p.ch)}</span><span>${esc(p.m)}</span></div></div>`);
      card.__v = p.v; $("yt-grid").append(card);
      return card;
    });
  }

  // ---------------------------------------------------------------- background, grain, heat
  function buildAtmosphere() {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 220;
    const ctx = canvas.getContext("2d"), image = ctx.createImageData(220, 220), rand = rng(7);
    for (let i = 0; i < image.data.length; i += 4) { const v = rand() * 255; image.data[i] = image.data[i + 1] = image.data[i + 2] = v; image.data[i + 3] = 255; }
    ctx.putImageData(image, 0, 0);
    $("grain").style.backgroundImage = `url(${canvas.toDataURL()})`;
    if (new URLSearchParams(location.search).get("grain") === "0") $("grain").style.display = "none"; // for GIFs, where grain costs megabytes
    const blobs = [...document.querySelectorAll(".blob")];
    const hot = [[255, 45, 45], [255, 120, 0], [214, 0, 110]], cool = [[37, 99, 235], [20, 184, 166], [99, 60, 220]];
    const heat = { v: 1 }, level = { v: 0.55 };
    onFrame((t) => {
      const grain = rng(Math.round(t * FPS) + 11);
      $("grain").style.transform = `translate(${Math.round(grain() * 90)}px, ${Math.round(grain() * 90)}px)`;
      blobs.forEach((blob, i) => {
        const mix = hot[i].map((h, c) => Math.round(cool[i][c] + (h - cool[i][c]) * heat.v));
        blob.style.background = `rgb(${mix})`;
        blob.style.opacity = level.v * (0.75 + 0.25 * Math.sin(t * 0.9 + i * 2));
        const x = [-260, 620, 200][i] + Math.sin(t * 0.23 + i * 1.7) * 160, y = [-380, 60, 260][i] + Math.cos(t * 0.19 + i * 2.3) * 110;
        blob.style.transform = `translate(${x}px, ${y}px)`;
      });
    });
    return { heat: (t0, dur, to) => tw(groupTarget("heat", heat), "v", t0, dur, () => heat.v, to, ease.inOut), level: (t0, dur, to) => tw(groupTarget("level", level), "v", t0, dur, () => level.v, to, ease.inOut) };
  }
  const targets = {};
  function groupTarget(name, box) { return targets[name] || (targets[name] = { apply: (v) => (box.v = v) }); }

  // ---------------------------------------------------------------- scene: chaos (0 to 7)
  function sceneChaos(atmo) {
    const scene = $("chaos"); vis(scene); tw(scene, "opacity", 0, 0, 1, 1); tw(scene, "opacity", 7, 0, 1, 0);
    const rand = rng(42), shards = [];
    D.shards.forEach((s, i) => {
      const node = el("div", "shard", `<div class="in"><div class="who"><span style="background:hsl(${Math.round(rand() * 360)},55%,45%)"></span>${esc(s[0])} <em>· now</em></div>${esc(s[1])}<div class="meta">${esc(s[2])}</div></div>`);
      $("shards").append(node);
      const born = 0.15 + 5.6 * Math.pow(i / D.shards.length, 0.72), angle = rand() * Math.PI * 2;
      const tx = 40 + rand() * 900, ty = 20 + rand() * 560, rot = (rand() - 0.5) * 22, size = 0.72 + rand() * 0.5;
      tw(node, "opacity", born, 0.18, 0, 1);
      tw(node, "x", born, 0.75, tx + Math.cos(angle) * 900, tx, ease.out5); tw(node, "y", born, 0.75, ty + Math.sin(angle) * 700, ty, ease.out5);
      tw(node, "r", born, 0.75, rot * 3, rot, ease.out5); tw(node, "s", born, 0.75, size * 1.5, size, ease.out5);
      tw(node, "s", 5.7, 1.3, size, size * (1.25 + rand() * 0.5), ease.in);
      sfx(born, "tick", { pan: tx / 640 - 1 });
      shards.push({ inner: node.firstChild, f: 2 + rand() * 5, ph: rand() * 6 });
    });
    const unread = document.querySelector(".unread"); fade(unread, 0.4, null, 0.3);
    fade($("cl1"), 0.7, 2.75, 0.25, 0.2); tw($("cl1"), "s", 0.7, 2.3, 1.06, 1, ease.out);
    fade($("cl2"), 3.0, 5.6, 0.25, 0.25); tw($("cl2"), "s", 3.0, 2.8, 1.06, 1, ease.out);
    tw($("shards"), "s", 5.6, 1.4, 1, 1.22, ease.in); tw($("flash"), "opacity", 5.8, 1.2, 0, 0.42, ease.in);
    onFrame((t) => {
      if (t > 7.05) return;
      const amp = 1.5 + Math.pow(Math.min(1, t / 7), 3) * 10, r = rng(Math.round(t * FPS) * 3 + 1);
      shards.forEach((s) => { s.inner.style.transform = `translate(${Math.sin(t * s.f + s.ph) * amp}px, ${Math.cos(t * s.f * 1.3 + s.ph) * amp}px)`; });
      $("unread-n").textContent = Math.floor(3 + Math.pow(t / 7, 2.4) * 4800).toLocaleString("en-US");
      const shake = t > 5.2 ? (t - 5.2) * 5 : 0;
      scene.style.transform = `translate(${(r() - 0.5) * shake}px, ${(r() - 0.5) * shake}px)`;
      for (const line of [$("cl1"), $("cl2")]) {
        const dx = (r() < 0.22 ? 5 + r() * 9 : 1.2) * (r() < 0.5 ? 1 : -1);
        line.style.textShadow = `${dx}px 0 rgba(255,0,70,0.85), ${-dx}px 0 rgba(0,210,255,0.85), 0 4px 40px rgba(0,0,0,0.95)`;
      }
    });
    sfx(0, "riser", { dur: 7 }); sfx(7, "impact");
    atmo.heat(6.95, 0.05, 0); atmo.level(6.95, 0.05, 0); atmo.level(7.6, 2.4, 0.4);
  }

  // ---------------------------------------------------------------- scene: the question and the logo (7 to 12)
  function logoIn(logo, t) {
    const mid = logo.querySelector(".mid"), pip = mid.querySelector("b");
    tw(logo, "opacity", t, 0.3, 0, 1); tw(logo, "s", t, 0.7, 0.55, 1, ease.back);
    tw({ apply: (v) => (mid.style.background = `rgba(245,244,239,${v})`) }, "v", t + 0.75, 0.4, 1, 0.34, ease.inOut);
    tw(pip, "opacity", t + 0.75, 0.25, 0, 1); tw(pip, "s", t + 0.75, 0.45, 0.2, 1, ease.back);
  }
  function sceneAskAndSting(atmo) {
    const ask = $("ask"), sting = $("sting"); vis(ask, sting);
    tw(ask, "opacity", 7.2, 0, 0, 1); words($("ask-line"), "What if you could just tell it what you want?", 7.5, 0.17, ["tell", "it"]);
    tw(ask, "opacity", 9.55, 0.35, 1, 0, ease.inOut);
    tw(sting, "opacity", 9.95, 0, 0, 1); logoIn($("logo"), 10.0);
    tw($("wordmark"), "opacity", 10.3, 0.4, 0, 1); tw($("wordmark"), "y", 10.3, 0.6, 22, 0, ease.out5);
    words($("tagline"), "Your feed. Your rules. In plain English.", 10.6, 0.085);
    tw(sting, "opacity", 11.6, 0.4, 1, 0, ease.inOut);
    sfx(10, "sting"); atmo.level(10, 0.6, 0.62); atmo.level(11.4, 0.8, 0.42);
  }

  // ---------------------------------------------------------------- scene: the product (12 to 64)
  function popupOpen(frame, t) { tw(frame, "opacity", t, 0.2, 0, 1); tw(frame, "s", t, 0.32, 0.86, 1, ease.back); }
  function popupClose(frame, t) { tw(frame, "opacity", t, 0.2, 1, 0); }
  function swapSite(t, from, to, url) {
    tw(from, "opacity", t, 0.28, 1, 0, ease.inOut); tw(to, "opacity", t + 0.2, 0.35, 0, 1, ease.inOut);
    tw(cam, "s", t, 0.24, () => cam.__tf.s, 0.965, ease.inOut); tw(cam, "x", t, 0.24, () => cam.__tf.x, 22.4, ease.inOut); tw(cam, "y", t, 0.24, () => cam.__tf.y, 11, ease.inOut);
    camTo(t + 0.24, 0.5, 640, 318, 1, ease.out5);
    cue(t + 0.22, () => { $("url-text").textContent = url; });
    sfx(t, "whoosh");
  }
  function toast(phrases) { // [{t0, dur, text, action, tAction}]
    const node = $("toast"), text = $("toast-text"), badge = $("toast-action");
    onFrame((t) => {
      node.style.transform = `translateX(-50%) translateY(${node.__y || 0}px)`;
      let current = null; for (const p of phrases) if (p.t0 <= t) current = p;
      if (!current) return;
      const n = Math.floor(Math.min(1, Math.max(0, (t - current.t0) / current.dur)) * current.text.length);
      text.textContent = current.text.slice(0, n); badge.textContent = current.action;
      const pop = Math.min(1, Math.max(0, (t - current.tAction) / 0.25));
      badge.style.opacity = pop; badge.style.transform = `scale(${0.6 + 0.4 * ease.back(pop)})`;
    });
    for (const p of phrases) { for (let i = 0; i < p.text.length; i++) sfx(p.t0 + (i * p.dur) / p.text.length, "key"); sfx(p.tAction, "toggle"); }
    return node;
  }

  function sceneProduct(atmo, xPosts, liPosts, ytCards) {
    const product = $("product"), sx = $("site-x"), ss = $("site-settings"), sl = $("site-li"), sy = $("site-yt");
    const popOff = $("popup-off"), popOn = $("popup-on"), frame = $("settings-frame"), hud = $("hud");
    vis(product, sx, ss, sl, sy, popOff, popOn);
    const doc = () => frame.contentDocument, inFrame = (id) => () => winPoint(doc().getElementById(id), frame);
    const xFeed = $("x-feed"), liFeed = $("li-feed"), ytGrid = $("yt-grid");
    cam.__tf = { x: 38.4, y: 50, s: 0.94, r: 0 };

    // --- X, before and after (12 to 24)
    tw(product, "opacity", 11.9, 0.5, 0, 1); tw(sx, "opacity", 11.9, 0, 1, 1); camTo(11.9, 0.9, 640, 318, 1, ease.out5);
    sfx(11.9, "whoosh"); atmo.heat(12, 2, 0.55); atmo.level(12, 1, 0.5);
    tw(xFeed, "y", 12.3, 2.6, 0, -150, ease.inOut);
    caption(12.3, 15.7, "Before", "A normal feed. Mostly noise.");
    tw(cursor, "opacity", 13.6, 0.3, 0, 1);
    click(14.8, () => winPoint($("ext-btn")), null); popupOpen(popOff, 14.85);
    click(16.0, () => winPoint(popOff.contentDocument.getElementById("enabled"), popOff), () => {
      popOff.contentDocument.getElementById("enabled").click();
      popOff.contentDocument.getElementById("site-health").textContent = "13 posts found · 7 hidden · 4 marked"; // what the popup reads once filtering is on
    }, "switch");
    atmo.heat(16, 1.2, 0); atmo.level(16, 0.3, 0.75); atmo.level(16.4, 2, 0.5);
    xPosts.forEach((post, i) => act(post, 16.06 + Math.min(i, 7) * 0.13, i > 6));
    tw(hud, "opacity", 16.2, 0.4, 0, 1);
    const counts = { judged: 13, hidden: 7, kept: 4 };
    onFrame((t) => { const p = ease.out(Math.min(1, Math.max(0, (t - 16.05) / 1.6))); $("hud-text").textContent = `Feedwall on · ${Math.round(counts.judged * p)} judged · ${Math.round(counts.hidden * p)} hidden · ${Math.round(counts.kept * p)} kept`; });
    caption(16.2, 19.9, "Feedwall on", "Plain-English rules, applied to every post.");
    popupClose(popOff, 17.4);
    tw(xFeed, "y", 17.7, 1.5, -150, () => -Math.max(0, xPosts[6].offsetTop - 250), ease.inOut);
    const shown = xPosts[6]; // the crypto post: zoom in on its bar, then bring it back
    cue(19.2, () => { const p = winPoint(shown.__bar); shown.__focus = { x: 120 + p.x, y: 30 + p.y }; });
    tw(cam, "s", 19.25, 1.0, 1, 1.85, ease.inOut); tw(cam, "x", 19.25, 1.0, 0, () => 640 - shown.__focus.x * 1.85, ease.inOut); tw(cam, "y", 19.25, 1.0, 0, () => 300 - shown.__focus.y * 1.85, ease.inOut);
    caption(20.1, 23.5, "Nothing is lost", "Every hidden post is one click away.");
    click(21.5, () => winPoint(shown.__bar.querySelector(".fw-btn")), null); expand(shown, 21.5);
    camTo(22.5, 1.0, 640, 318, 1);
    tw(hud, "opacity", 19.0, 0.3, 1, 0);

    // --- your own topic, in the real settings page (24 to 40)
    swapSite(23.6, sx, ss, "Feedwall · Topics and settings");
    const scroller = { apply: (v) => frame.contentWindow.scrollTo(0, v) };
    const topOf = (id, offset) => () => Math.max(0, doc().getElementById(id).getBoundingClientRect().top + frame.contentWindow.scrollY - offset);
    tw(scroller, "v", 23.6, 0, 0, () => Math.max(0, doc().getElementById("topics").getBoundingClientRect().top - 90));
    caption(24.2, 27.0, "Make it yours", "Your topics. Your words.");
    click(26.0, inFrame("new-topic"), () => doc().getElementById("new-topic").click());
    tw(scroller, "v", 26.05, 0.6, () => frame.contentWindow.scrollY, topOf("editor", 10), ease.inOut);
    function type(id, t0, dur, text) {
      let last = -1;
      tw({ apply: (p) => { const n = Math.floor(p * text.length + 1e-6); if (n === last) return; last = n; const input = doc().getElementById(id); input.value = text.slice(0, n); input.dispatchEvent(new Event("input", { bubbles: true })); } }, "v", t0, dur, 0, 1, ease.lin);
      for (let i = 0; i < text.length; i++) sfx(t0 + (i * dur) / text.length, "key");
    }
    const focus = (id) => () => doc().getElementById(id).focus({ preventScroll: true });
    click(27.5, inFrame("t-name"), focus("t-name"));
    type("t-name", 27.6, 0.8, "Real revenue numbers");
    click(28.7, inFrame("t-description"), focus("t-description"));
    type("t-description", 28.8, 2.3, "Posts sharing real revenue numbers from a small product");
    caption(27.2, 31.2, "New topic", "Describe a category in your own words.");
    click(31.4, inFrame("t-counts"), focus("t-counts"));
    type("t-counts", 31.5, 1.8, "MRR, pricing results, launch numbers");
    caption(31.4, 35.1, "Your call", "Keep it, highlight it, dim it or hide it.");
    const menu = $("menu"), rows = [...menu.children];
    click(33.6, inFrame("t-action"), () => { const r = doc().getElementById("t-action").getBoundingClientRect(), f = frame.getBoundingClientRect(), w = win.getBoundingClientRect(); menu.style.left = f.left - w.left + r.left + "px"; menu.style.top = f.top - w.top + r.top - menu.offsetHeight - 4 + "px"; menu.style.width = r.width + "px"; });
    tw(menu, "opacity", 33.6, 0.15, 0, 1); tw(menu, "y", 33.6, 0.25, 8, 0, ease.out5);
    rows.forEach((row, i) => { tw(row, "opacity", 33.62 + i * 0.05, 0.2, 0, 1); });
    cue(34.25, () => rows.forEach((row) => row.classList.toggle("on", row.dataset.v === "keep")));
    click(34.6, () => winPoint(rows[0]), () => { const s = doc().getElementById("t-action"); s.value = "keep"; s.dispatchEvent(new Event("change", { bubbles: true })); }, "toggle");
    tw(menu, "opacity", 34.68, 0.15, 1, 0);
    click(35.5, inFrame("t-test"), async () => { doc().getElementById("t-test").click(); await new Promise((r) => setTimeout(r, 250)); });
    tw(scroller, "v", 35.62, 0.7, () => frame.contentWindow.scrollY, topOf("t-test-out", 170), ease.inOut);
    D.testPosts.forEach((_, i) => sfx(35.75 + i * 0.09, i < 3 ? "spark" : "tick"));
    caption(35.4, 38.3, "Test it first", "Try it on posts you actually scrolled past.");
    camTo(36.2, 0.9, 640, 400, 1.32); camTo(37.6, 0.7, 640, 318, 1);
    click(38.6, inFrame("t-save"), async () => { doc().getElementById("t-save").click(); await new Promise((r) => setTimeout(r, 250)); }, "save");
    tw(scroller, "v", 38.75, 0.7, () => frame.contentWindow.scrollY, topOf("topics", 90), ease.inOut);
    caption(38.6, 40.0, "Saved", "Add as many as you like.");

    // --- LinkedIn (40 to 48)
    swapSite(39.6, ss, sl, "linkedin.com/feed");
    tw(cursor, "opacity", 39.6, 0.3, 1, 0);
    const chip = toast([
      { t0: 40.6, dur: 1.4, text: "Humblebrags and hustle sermons", action: "Hide", tAction: 42.1 },
      { t0: 48.4, dur: 0.9, text: "Clickbait titles", action: "Dim", tAction: 49.4 },
      { t0: 51.2, dur: 0.9, text: "Deep technical talks", action: "Highlight", tAction: 52.2 },
    ]);
    const chipY = { apply: (v) => (chip.__y = v) };
    tw(chip, "opacity", 40.3, 0.3, 0, 1); tw(chipY, "v", 40.3, 0.5, -24, 0, ease.back);
    liPosts.forEach((post, i) => act(post, 42.55 + Math.min(i, 5) * 0.16, i > 5));
    tw(chip, "opacity", 43.7, 0.3, 1, 0);
    tw(liFeed, "y", 40.0, 2.5, 0, -40, ease.inOut); tw(liFeed, "y", 43.9, 3.3, -40, -215, ease.inOut);
    caption(42.5, 47.5, "LinkedIn", "Same rules. Minus the sermons.");

    // --- YouTube (48 to 56)
    swapSite(47.6, sl, sy, "youtube.com");
    tw(chip, "opacity", 48.2, 0.3, 0, 1); tw(chipY, "v", 48.2, 0.5, -24, 0, ease.back);
    ytCards.filter((c) => c.__v && c.__v[0] === "dim").forEach((card, i) => dim(card, 49.95 + i * 0.13, card.__v));
    ytCards.filter((c) => c.__v && c.__v[0] === "highlight").forEach((card, i) => {
      const glow = el("div", "glow"); card.prepend(glow); card.__glow = glow; mark(card, 52.5 + i * 0.2, card.__v);
    });
    tw(chip, "opacity", 53.6, 0.3, 1, 0);
    tw(ytGrid, "y", 53.4, 2.2, 0, -110, ease.inOut);
    caption(50.0, 55.5, "YouTube", "Clickbait fades. The good stuff stands out.");

    // --- focus mode, back on X (56 to 64)
    tw(xFeed, "y", 55.7, 0, 0, 0); collapse(shown, 55.7, true);
    swapSite(55.6, sy, sx, "x.com/home");
    tw(cursor, "opacity", 56.0, 0.3, 0, 1);
    click(56.9, () => winPoint($("ext-btn")), null); popupOpen(popOn, 56.95);
    click(58.0, () => winPoint(popOn.contentDocument.getElementById("site-focus"), popOn), () => popOn.contentDocument.getElementById("site-focus").click(), "drop");
    xPosts.forEach((post, i) => {
      if (post.__v && (post.__v[0] === "keep" || post.__v[0] === "highlight")) return;
      const t = 58.04 + i * 0.035;
      tw(post, "h", t, 0.5, () => post.offsetHeight, 0, ease.inOut); tw(post, "opacity", t, 0.3, () => Number(post.style.opacity || 1), 0);
      cue(t + 0.5, () => { post.style.borderBottomWidth = "0"; });
    });
    atmo.level(58, 0.25, 0.9); atmo.level(58.3, 2.5, 0.5);
    tw($("x-chip"), "opacity", 58.5, 0.35, 0, 1); tw($("x-chip"), "y", 58.5, 0.5, 14, 0, ease.back);
    popupClose(popOn, 59.0); tw(cursor, "opacity", 59.3, 0.4, 1, 0);
    caption(58.1, 63.5, "Focus mode", "Only what you asked for.");
    camTo(59.6, 3.8, 618, 250, 1.14, ease.inOut);
    tw(product, "opacity", 63.5, 0.45, 1, 0, ease.inOut);
  }

  // ---------------------------------------------------------------- scene: trust lines and end card (64 to 78)
  function sceneTrustAndEnd(atmo) {
    const trust = $("trust"), end = $("end"); vis(trust, end);
    tw(trust, "opacity", 63.9, 0, 0, 1); tw(trust, "opacity", 69.95, 0, 1, 0);
    [["Wrong? <em>One click</em> fixes it.", "And it keeps score of its own mistakes."],
     ["No server. No account.", "Posts go from your browser straight to the model, under your own key."],
     ["<em>Open source.</em>", "Plain JavaScript you can read in one sitting."]].forEach(([big, small], i) => {
      const node = $("tr" + (i + 1)), t = 64 + i * 2;
      node.innerHTML = `<div class="t1">${big}</div><div class="t2">${small}</div>`;
      fade(node, t, t + 1.75, 0.3, 0.22); tw(node, "s", t, 2, 0.94, 1.02, ease.out); tw(node.lastChild, "y", t, 0.6, 18, 0, ease.out5);
      sfx(t, "hit");
    });
    tw(end, "opacity", 69.95, 0, 0, 1); logoIn($("end-logo"), 70.0);
    tw($("end-word"), "opacity", 70.3, 0.4, 0, 1); tw($("end-word"), "y", 70.3, 0.6, 22, 0, ease.out5);
    tw($("end-tag"), "opacity", 70.8, 0.5, 0, 1); tw($("end-tag"), "y", 70.8, 0.6, 14, 0, ease.out5);
    const url = $("end-url");
    tw(url, "opacity", 71.7, 0.4, 0, 1);
    onFrame((t) => { const p = ease.back(Math.min(1, Math.max(0, (t - 71.7) / 0.6))); url.style.transform = `translateX(-50%) scale(${0.85 + 0.15 * p})`; });
    tw($("end-sub"), "opacity", 72.5, 0.6, 0, 1);
    sfx(70, "sting"); atmo.level(70, 0.6, 0.7); atmo.level(71, 5, 0.45);
    tw($("black"), "opacity", 76.6, 1.3, 0, 1, ease.inOut);
    tw($("black"), "opacity", 7.0, 0, 0, 1); tw($("black"), "opacity", 7.25, 0.6, 1, 0);
  }

  // ---------------------------------------------------------------- start
  const ready = (async () => {
    const frame = $("settings-frame"), popups = [$("popup-off"), $("popup-on")];
    const until = async (test) => { for (let i = 0; i < 200; i++) { try { if (test()) return; } catch (error) { /* not loaded yet */ } await new Promise((r) => setTimeout(r, 50)); } throw new Error("trailer: a frame did not load"); };
    await until(() => frame.contentDocument.getElementById("topics").children.length > 0);
    await until(() => popups.every((p) => p.contentDocument.getElementById("site-name").textContent === "X"));
    frame.contentWindow.__testPosts = D.testPosts;
    for (const p of popups) p.style.height = p.contentDocument.documentElement.scrollHeight + "px";
    const xPosts = buildX(), liPosts = buildLinkedIn(), ytCards = buildYouTube();
    for (const post of [...xPosts, ...liPosts]) post.__h = post.offsetHeight;
    const atmo = buildAtmosphere();
    sceneChaos(atmo); sceneAskAndSting(atmo); sceneProduct(atmo, xPosts, liPosts, ytCards); sceneTrustAndEnd(atmo);
    for (const group of groups.values()) group.tracks.sort((a, b) => a.t0 - b.t0);
    cues.sort((a, b) => a.t - b.t); sfxList.sort((a, b) => a.t - b.t);
    await seek(0);
  })();

  window.__trailer = { fps: FPS, duration: DUR, ready, seek, sfx: sfxList };
})();
