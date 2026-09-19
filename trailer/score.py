# The trailer's soundtrack, synthesized from nothing so there is no licence to worry about.
# Shape: seven seconds of rising noise, a hard stop, then a calm 120 BPM groove that opens up when Feedwall switches on.
#   uv run --with numpy --with scipy python trailer/score.py <sfx.json> <out.wav>
# sfx.json is written by render.mjs: the clicks, keystrokes and collapses land exactly where the picture puts them.
import json, sys, wave
import numpy as np
from scipy.signal import butter, lfilter, fftconvolve

SR = 44100
DUR = 78.0
N = int(SR * DUR)
rng = np.random.default_rng(7)
dry = np.zeros((N, 2)); send = np.zeros((N, 2))

def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def tt(d): return np.arange(int(SR * d)) / SR
def lp(x, fc, order=2): b, a = butter(order, min(0.99, fc / (SR / 2))); return lfilter(b, a, x)
def hp(x, fc, order=2): b, a = butter(order, fc / (SR / 2), "high"); return lfilter(b, a, x)
def bp(x, lo, hi): b, a = butter(2, [lo / (SR / 2), hi / (SR / 2)], "band"); return lfilter(b, a, x)
def saw(f, t, ph=0.0): return 2 * ((f * t + ph) % 1.0) - 1
def fade(x, a=0.004, r=0.01):
    n = len(x); na, nr = min(n // 2, int(SR * a)), min(n // 2, int(SR * r)); x = x.copy()
    if na: x[:na] *= np.linspace(0, 1, na)
    if nr: x[-nr:] *= np.linspace(1, 0, nr)
    return x
def put(sig, t, gain=1.0, pan=0.0, wet=0.0, bus=None):
    i = int(t * SR)
    if i >= N or i < 0: return
    sig = sig[: N - i]; l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    st = np.stack([sig * l, sig * r], 1) * gain
    (dry if bus is None else bus)[i:i + len(sig)] += st
    if wet: send[i:i + len(sig)] += st * wet

# ---------------------------------------------------------------- instruments
def kick(g=1.0, dark=False):
    t = tt(0.38); f = 44 + 120 * np.exp(-t * 30); x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 8.5)
    x += rng.standard_normal(len(t)) * np.exp(-t * 500) * 0.25
    return fade(lp(x, 220) if dark else x) * g
def hat(open_=False):
    t = tt(0.3 if open_ else 0.07); return fade(hp(rng.standard_normal(len(t)), 7500) * np.exp(-t * (16 if open_ else 85)))
def clap():
    t = tt(0.4); e = sum(np.exp(-np.clip(t - d, 0, None) * 160) * (t >= d) for d in (0, 0.011, 0.023)) * 0.5 + np.exp(-t * 20) * 0.6
    return fade(bp(rng.standard_normal(len(t)), 900, 3800) * e)
def bass(m, d=0.24):
    t = tt(d); f = hz(m); x = lp(saw(f, t) * 0.6 + np.sin(2 * np.pi * f * t), 420) * np.exp(-t * 6); return fade(x, 0.004, 0.03)
def pad(notes, d, fc=1500, attack=0.3, release=0.9):
    t = tt(d + release); x = np.zeros(len(t))
    for m in notes:
        for det in (-0.004, 0.0, 0.0045): x += saw(hz(m) * (1 + det), t, rng.random())
    e = np.minimum(1, t / attack) * np.where(t < d, 1, np.exp(-(t - d) * 4.2))
    return lp(x, fc) * e / (3 * len(notes))
def pluck(m, fc=2600):
    t = tt(0.32); f = hz(m); x = lp(saw(f, t) * 0.7 + np.sign(np.sin(2 * np.pi * f * t)) * 0.3, fc) * np.exp(-t * 15); return fade(x, 0.002, 0.02)
def bell(m, d=4.0, idx=2.2):
    t = tt(d); f = hz(m); return fade(np.sin(2 * np.pi * f * t + idx * np.exp(-t * 3) * np.sin(2 * np.pi * f * 3.5 * t)) * np.exp(-t * 1.5), 0.003, 0.2)
def boom(d=2.6, g=1.0):
    t = tt(d); f = 32 + 60 * np.exp(-t * 5); x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.7)
    x += lp(rng.standard_normal(len(t)), 800) * np.exp(-t * 7) * 0.7
    return fade(x, 0.002, 0.3) * g
def swell(d, lo=400, hi=6000):  # noise that rises into a cut
    t = tt(d); x = bp(rng.standard_normal(len(t)), lo, hi) * (t / d) ** 2.4; return fade(x, 0.01, 0.006)
def whoosh():
    t = tt(0.7); x = bp(rng.standard_normal(len(t)), 300, 3200) * np.sin(np.pi * t / 0.7) ** 2; return fade(x)
def blip(f0, f1, d, decay=30):
    t = tt(d); f = f0 * (f1 / f0) ** (t / d); return fade(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * decay), 0.002, 0.01)
def tick(f=2500): t = tt(0.025); return fade(bp(rng.standard_normal(len(t)), f * 0.7, f * 1.4) * np.exp(-t * 260), 0.0005, 0.004)

# ---------------------------------------------------------------- harmony
AM, F, C, G, CADD9 = [57, 60, 64, 71], [53, 57, 60, 67], [52, 55, 60, 62], [50, 55, 59, 69], [48, 55, 62, 64]
ROOT = {id(AM): 33, id(F): 29, id(C): 36, id(G): 31, id(CADD9): 36}
def chord_at(t):
    if t >= 70: return CADD9
    if t >= 64: return [AM, F, G][int((t - 64) // 2)]
    return [AM, F, C, G][int((t - 16) // 2) % 4]

# ---------------------------------------------------------------- 0 to 7: noise
t = tt(7.0); up = (t / 7.0)
cluster = sum(saw(55 * 2 ** (3 * up ** 1.6) * r, t, rng.random()) for r in (1.0, 1.0595, 1.498, 2.003)) / 4
lfo = 0.55 + 0.45 * np.sin(2 * np.pi * np.cumsum(2 + 16 * up ** 2) / SR)
riser = lp(cluster, 3200) * up ** 1.6 * lfo * 1.1 + lp(rng.standard_normal(len(t)), 6000) * up ** 2.4 * 0.8
riser += np.sin(2 * np.pi * 41 * t) * (0.16 + 0.08 * np.sin(2 * np.pi * 0.7 * t)) * np.minimum(1, t / 1.5) * (1 + up)
put(fade(riser, 0.4, 0.004), 0, 0.7, 0, 0.25)
put(boom(3.0), 7.0, 0.95, 0, 0.6)

# 7.5 to 9.4: one soft note per word of the question
for i, m in enumerate([57, 60, 62, 64, 67, 69, 72, 74, 76, 79]): put(bell(m, 2.2, 1.2), 7.5 + i * 0.17, 0.07, (i % 3 - 1) * 0.4, 0.8)
# 10: the logo
put(swell(0.9), 9.1, 0.22, 0, 0.5); put(boom(2.4, 0.8), 10.0, 0.8, 0, 0.5)
for i, m in enumerate([57, 64, 71, 76, 84]): put(bell(m, 4.5), 10.0 + i * 0.012, 0.11, (i - 2) * 0.3, 0.7)
put(pad(AM, 1.9, 2200, 0.05), 10.0, 0.5, 0, 0.4)

# ---------------------------------------------------------------- 12 to 70: the groove
music = np.zeros((N, 2)); arpbus = np.zeros((N, 2)); kicks = []
def drums(t0, t1, k=1.0, hats=0.0, claps=0.0, dark=False, half=False):
    b = t0
    while b < t1 - 1e-6:
        beat = int(round((b - 12) / 0.5)) % 4
        if k and (not half or beat == 0): put(kick(k, dark), b, 0.9, 0, 0, music); kicks.append(b)
        if claps and (beat in (1, 3) if not half else beat == 2): put(clap(), b, claps, 0.05, 0.5 if not half else 1.2, music)
        if hats:
            put(hat(), b + 0.25, hats, 0.25, 0.05, music)
            if not half: put(hat(), b + 0.125, hats * 0.35, -0.3, 0, music); put(hat(), b + 0.375, hats * 0.35, -0.3, 0, music)
            if beat == 3 and claps: put(hat(True), b + 0.25, hats * 0.8, 0.25, 0.1, music)
        b += 0.5
# before: muffled and uneasy
drums(12, 16, 0.8, 0.06, 0, dark=True)
put(pad([45, 46, 52], 3.9, 520, 1.2, 0.3), 12, 0.55, 0, 0.3, music); put(lp(saw(hz(33), tt(4.0)), 160) * 0.5, 12, 0.5, 0, 0, music)
put(swell(0.6), 15.4, 0.3, 0, 0.4)
# switch on
put(boom(1.8, 0.7), 16.0, 0.7, 0, 0.5); put(bell(76, 3, 1.5), 16.0, 0.08, 0.2, 0.8); put(bell(83, 3, 1.5), 16.01, 0.05, -0.2, 0.8)
drums(16, 24, 1.0, 0.16)
drums(24, 32, 0.5, 0.1); drums(32, 39.5, 0.85, 0.14)
for i in range(4): put(clap(), 39.5 + i * 0.125, 0.12 + i * 0.05, 0, 0.4, music)
drums(40, 56, 1.0, 0.18, 0.3)
put(swell(1.9, 300, 8000), 56.1, 0.4, 0, 0.5)
for i in range(4): put(kick(0.5 + i * 0.12), 57.5 + i * 0.125, 0.8, 0, 0, music)
put(boom(3.4, 1.0), 58.0, 0.8, 0, 0.7); drums(58, 64, 1.0, 0.1, 0.34, half=True)

bar = 16.0
while bar < 64:
    ch = chord_at(bar); root = ROOT[id(ch)]; quiet = 24 <= bar < 32; breakdown = 56 <= bar < 58; half = bar >= 58
    put(pad(ch, 1.95, 2600 if half else 1150 if quiet else 1700), bar, 0.62 if not quiet else 0.5, 0, 0.35, music)
    if half: put(lp(saw(hz(root + 12), tt(1.95)), 150) * np.minimum(1, tt(1.95) / 0.05), bar, 0.3, 0, 0, music)
    elif quiet or breakdown: put(lp(saw(hz(root + 12), tt(1.95)), 170) * np.minimum(1, tt(1.95) / 0.05), bar, 0.34, 0, 0, music)
    else:
        for e in range(4): put(bass(root), bar + 0.25 + e * 0.5, 0.75, 0, 0, music); put(bass(root + 12, 0.12), bar + 0.375 + e * 0.5, 0.3, 0, 0, music)
    tones = ch + [ch[0] + 12, ch[3], ch[2], ch[1]]
    for s in range(16):
        if half and s % 2: continue
        if breakdown and s % 4: continue
        m = tones[s % 8] + (12 if bar >= 48 and s % 8 >= 4 else 0)
        put(pluck(m, 1700 if quiet else 2800), bar + s * 0.125, (0.1 if quiet else 0.16) * (0.75 + 0.25 * (s % 4 == 0)), 0.5 * np.sin(s * 1.3), 0.25, arpbus)
    bar += 2
# trust lines: one hit each, then the resolution
for i, b in enumerate((64.0, 66.0, 68.0)):
    ch = chord_at(b); put(boom(1.9, 0.85), b, 0.6, 0, 0.6); put(pad(ch, 1.7, 2400, 0.02, 0.5), b, 0.75, 0, 0.5, music); put(bell(ch[3] + 12, 2.5, 1.6), b, 0.09, 0.2, 0.8)
    put(fade(lp(saw(hz(ROOT[id(ch)] + 12), tt(1.8)), 150), 0.01, 0.2), b, 0.28, 0, 0, music)
put(swell(0.8), 69.2, 0.3, 0, 0.5); put(boom(3.2, 0.9), 70.0, 0.9, 0, 0.7)
put(pad(CADD9, 5.5, 2300, 0.05, 2.4), 70.0, 0.7, 0, 0.5, music); put(fade(lp(saw(hz(48), tt(6.0)), 150) * np.exp(-tt(6.0) * 0.4), 0.01, 0.5), 70.0, 0.3, 0, 0, music)
for i, m in enumerate([60, 67, 74, 76, 84]): put(bell(m, 6.0), 70.0 + i * 0.014, 0.11, (i - 2) * 0.3, 0.8)
tones = CADD9 + [60, 64, 62, 55]
for s in range(32): put(pluck(tones[s % 8] + 12, 2400), 70.0 + s * 0.125, 0.13 * np.exp(-s / 14), 0.5 * np.sin(s * 1.3), 0.4, arpbus)

# ping-pong echo on the arpeggio, then duck everything musical under each kick
d = int(0.375 * SR)
for k in range(1, 5):
    echo = np.zeros_like(arpbus); echo[d * k:] = arpbus[:-d * k] * 0.42 ** k
    if k % 2: echo = echo[:, ::-1]
    music += echo * 0.9
music += arpbus
duck = np.ones(N)
for kt in kicks:
    i = int(kt * SR); n = min(N - i, int(0.34 * SR)); duck[i:i + n] = np.minimum(duck[i:i + n], 1 - 0.5 * np.exp(-np.arange(n) / SR * 11))
dry += music * duck[:, None]; send += music * duck[:, None] * 0.12

# ---------------------------------------------------------------- sounds that belong to the picture
events = json.load(open(sys.argv[1]))["events"] if len(sys.argv) > 1 else []
for e in events:
    t0, kind = e["t"], e["type"]; pan = float(e.get("pan", rng.uniform(-0.25, 0.25)))
    if kind == "tick": put(blip(rng.uniform(900, 2600), rng.uniform(400, 900), 0.06, 60), t0, 0.12 + 0.1 * t0 / 7 if t0 < 8 else 0.08, pan, 0.4)
    elif kind == "key": put(tick(rng.uniform(2200, 3600)), t0, 0.16, pan * 0.6)
    elif kind == "click": put(tick(1500), t0, 0.3, 0); put(tick(2100), t0 + 0.045, 0.18, 0)
    elif kind == "switch": put(tick(1500), t0, 0.3, 0); put(blip(520, 1040, 0.16, 12), t0, 0.2, 0, 0.5)
    elif kind == "toggle": put(blip(880, 1320, 0.07, 25), t0, 0.16, pan, 0.3)
    elif kind == "save": put(blip(660, 660, 0.12, 14), t0, 0.16, 0, 0.5); put(blip(990, 990, 0.2, 10), t0 + 0.09, 0.16, 0, 0.5)
    elif kind == "pop": put(blip(560, 170, 0.11, 22), t0, 0.26, pan * 2, 0.3)
    elif kind == "unpop": put(blip(190, 620, 0.14, 16), t0, 0.26, pan, 0.3)
    elif kind == "spark": put(bell(88, 0.9, 1.0), t0, 0.06, pan * 2, 0.7); put(bell(95, 0.9, 1.0), t0 + 0.05, 0.045, -pan * 2, 0.7)
    elif kind == "dim": put(lp(whoosh(), 1200)[: int(0.35 * SR)], t0, 0.14, pan * 2, 0.2)
    elif kind == "whoosh": put(whoosh(), t0 - 0.12, 0.26, 0, 0.5)
    elif kind == "drop": put(tick(1500), t0, 0.3, 0)

# ---------------------------------------------------------------- room, master
t = tt(2.3); ir = np.stack([lp(hp(rng.standard_normal(len(t)), 250), 5200) * np.exp(-t * 3.0) for _ in range(2)], 1); ir /= np.sqrt((ir ** 2).sum(0))
wet = np.stack([fftconvolve(send[:, c], ir[:, c])[:N] for c in range(2)], 1)
mix = dry + wet * 0.5
mix[: int(7.0 * SR)] *= 1.0; cut = int(7.0 * SR); mix[cut - 200:cut] *= np.linspace(1, 0.15, 200)[:, None]
env = np.ones(N); f0 = int(74.0 * SR); env[f0:] = np.linspace(1, 0, N - f0) ** 1.6; mix *= env[:, None]
mix = np.tanh(mix * 1.25) / np.tanh(1.25)
mix *= 0.89 / np.abs(mix).max()
with wave.open(sys.argv[2] if len(sys.argv) > 2 else "score.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype("<i2").tobytes())
print("score: %.1fs, peak %.2f, rms %.3f" % (DUR, np.abs(mix).max(), np.sqrt((mix ** 2).mean())))
