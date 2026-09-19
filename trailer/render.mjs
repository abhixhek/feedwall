// Captures the trailer frame by frame through Chrome's debugging protocol. No dependencies (Node 22+ for WebSocket).
//   node trailer/render.mjs --out <dir>                  every frame, as JPEGs, plus sfx.json for the score
//   node trailer/render.mjs --out <dir> --stills 3,9,14  only these seconds, as PNGs (for checking a scene quickly)
//   --query grain=0                                      without film grain (for GIFs)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true] : null)).filter(Boolean));
const out = args.out || "frames";
const base = args.base || "http://localhost:48795";
const chromePath = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9300 + Math.floor(Math.random() * 500);
mkdirSync(out, { recursive: true });

const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "fw-trailer-"))}`,
  "--hide-scrollbars", "--mute-audio", "--no-first-run", "--force-color-profile=srgb", "--window-size=1280,720", "about:blank"], { stdio: "ignore" });
const stop = () => { try { chrome.kill(); } catch (error) { /* already gone */ } };
process.on("exit", stop);

async function target() {
  for (let i = 0; i < 100; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const page = list.find((t) => t.type === "page"); if (page) return page.webSocketDebuggerUrl; } catch (error) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Chrome did not start");
}

const socket = new WebSocket(await target());
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0; const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") console.error("page error:", message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  const waiter = pending.get(message.id); if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
};
const send = (method, params) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) {
  const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1.5, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await send("Page.navigate", { url: `${base}/trailer/index.html${args.query ? "?" + args.query : ""}` });
for (let i = 0; i < 200; i++) { if (await evaluate("Boolean(window.__trailer)").catch(() => false)) break; await new Promise((r) => setTimeout(r, 100)); }
await evaluate("window.__trailer.ready");
const { fps, duration } = await evaluate("({ fps: __trailer.fps, duration: __trailer.duration })");
writeFileSync(join(out, "sfx.json"), JSON.stringify({ fps, duration, events: await evaluate("__trailer.sfx") }));

const stills = args.stills ? new Set(String(args.stills).split(",").map((s) => Math.round(Number(s) * fps))) : null;
const last = stills ? Math.max(...stills) : Math.round(duration * fps) - 1;
const started = Date.now();
for (let frame = 0; frame <= last; frame++) {
  await evaluate(`__trailer.seek(${frame / fps})`);
  if (stills && !stills.has(frame)) continue;
  const { data } = await send("Page.captureScreenshot", stills ? { format: "png" } : { format: "jpeg", quality: 93 });
  writeFileSync(join(out, stills ? `still-${(frame / fps).toFixed(2).padStart(6, "0")}.png` : `f${String(frame).padStart(5, "0")}.jpg`), Buffer.from(data, "base64"));
  if (!stills && frame % 150 === 0) console.log(`frame ${frame}/${last}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
console.log(`done: ${stills ? stills.size + " stills" : last + 1 + " frames"} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
socket.close(); stop(); process.exit(0);
