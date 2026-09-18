// One adapter per site: how to find posts and read their text. These are the only files expected to break
// when a site changes its markup, so each one is deliberately tiny. Selectors verified on 2026-09-18
// (Reddit from its documented structure only).
(function (root) {
  "use strict";

  // textContent, not innerText: innerText is empty for anything we have hidden, so the same post would read
  // differently before and after it is collapsed.
  const text = (el) => (el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "");
  const firstLine = (value) => (value || "").split(/\n| · |@/)[0].trim();

  // For web components (Reddit): a child without a slot is never rendered, so the bar sits next to the post instead of inside it.
  const siblingBar = {
    mountBar(el, bar) { el.parentNode.insertBefore(bar, el); return bar; },
    hideTargets(el) { return [el]; },
  };

  const adapters = [
    {
      site: "x",
      hosts: ["x.com", "twitter.com"],
      excludePaths: [/^\/messages/, /^\/settings/, /^\/compose/, /^\/i\/flow/, /^\/login/],
      itemSelector: 'article[data-testid="tweet"]',
      eager: true, // virtualized feed: only posts near the viewport exist in the page
      extract(el) {
        const bodies = el.querySelectorAll('[data-testid="tweetText"]');
        return {
          kind: "post",
          text: text(bodies[0]),
          quoted: text(bodies[1]),
          author: firstLine(text(el.querySelector('[data-testid="User-Name"]'))),
          linkTitle: text(el.querySelector('[data-testid="card.wrapper"]')).slice(0, 200),
        };
      },
    },
    {
      site: "hackernews",
      hosts: ["news.ycombinator.com"],
      excludePaths: [/^\/submit/, /^\/login/, /^\/user/, /^\/reply/],
      itemSelector: "tr.athing.submission, tr.athing.comtr",
      extract(el) {
        if (el.classList.contains("comtr")) {
          return { kind: "comment", text: text(el.querySelector(".commtext")), author: text(el.querySelector(".hnuser")) };
        }
        const site = text(el.querySelector(".sitestr"));
        return { kind: "post", text: text(el.querySelector(".titleline > a")) + (site ? ` (${site})` : "") };
      },
      // Table rows cannot hold a div, so the bar gets its own row and the story's subtext row is hidden with it.
      mountBar(el, bar) {
        const row = document.createElement("tr");
        row.className = "fw-bar-row";
        const cell = document.createElement("td");
        cell.colSpan = 3;
        cell.appendChild(bar);
        row.appendChild(cell);
        el.parentNode.insertBefore(row, el);
        return row;
      },
      hideTargets(el) {
        const next = el.nextElementSibling;
        return el.classList.contains("submission") && next && next.querySelector(".subtext") ? [el, next] : [el];
      },
    },
    {
      site: "reddit",
      hosts: ["www.reddit.com", "reddit.com", "old.reddit.com"],
      excludePaths: [/^\/message/, /^\/settings/, /^\/chat/, /^\/submit/, /^\/login/],
      itemSelector: "shreddit-post, shreddit-comment, .thing.link, .thing.comment",
      ...siblingBar,
      extract(el) {
        if (el.tagName === "SHREDDIT-POST") {
          return {
            kind: "post",
            text: [el.getAttribute("post-title"), text(el.querySelector('[slot="text-body"]'))].filter(Boolean).join(". "),
            author: el.getAttribute("author") || "",
            linkTitle: el.getAttribute("subreddit-prefixed-name") || "",
          };
        }
        if (el.tagName === "SHREDDIT-COMMENT") {
          return { kind: "comment", text: text(el.querySelector('[slot="comment"]')), author: el.getAttribute("author") || "" };
        }
        const isComment = el.classList.contains("comment");
        return {
          kind: isComment ? "comment" : "post",
          text: isComment ? text(el.querySelector(".usertext-body")) : text(el.querySelector("a.title")),
          author: text(el.querySelector(".author")),
        };
      },
    },
    {
      site: "youtube",
      hosts: ["www.youtube.com", "youtube.com", "m.youtube.com"],
      excludePaths: [/^\/account/, /^\/upload/, /^\/studio/],
      // a home-feed tile wraps a lockup, so lockups inside tiles are skipped to avoid judging the same video twice
      itemSelector: "ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, yt-lockup-view-model, ytd-comment-thread-renderer",
      skip(el) {
        return el.tagName === "YT-LOCKUP-VIEW-MODEL" && Boolean(el.closest("ytd-rich-item-renderer"));
      },
      extract(el) {
        if (el.tagName === "YTD-COMMENT-THREAD-RENDERER") {
          return { kind: "comment", text: text(el.querySelector("#content-text")), author: text(el.querySelector("#author-text")) };
        }
        const title = text(el.querySelector("#video-title, h3"));
        const snippet = text(el.querySelector(".metadata-snippet-text"));
        return {
          kind: "video",
          text: [title, snippet].filter(Boolean).join(". "),
          author: firstLine(text(el.querySelector("ytd-channel-name a, yt-content-metadata-view-model"))),
        };
      },
    },
    {
      site: "linkedin",
      hosts: ["www.linkedin.com", "linkedin.com"],
      excludePaths: [/^\/messaging/, /^\/mypreferences/, /^\/psettings/, /^\/login/, /^\/checkpoint/, /^\/jobs\/view/],
      itemSelector: '[data-testid="mainFeed"] [role="listitem"]',
      extract(el) {
        const actor = el.querySelector('a[href*="/in/"], a[href*="/company/"]');
        return { kind: "post", text: text(el.querySelector('[data-testid="expandable-text-box"]')), author: firstLine(text(actor)) };
      },
    },
  ];

  function adapterFor(hostname, pathname) {
    const adapter = adapters.find((a) => a.hosts.includes(hostname));
    if (!adapter) return null;
    if (adapter.excludePaths.some((re) => re.test(pathname))) return null;
    return adapter;
  }

  const api = { adapters, adapterFor };
  root.FW = Object.assign(root.FW || {}, { sites: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
