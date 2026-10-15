import json
import wave
from pathlib import Path

import numpy as np

SR = 22050
OUT = Path(__file__).parent / "cases"
OUT.mkdir(exist_ok=True)


def piano_tone(midi, dur, rng, decay=0.6, detune=0.25, in_phase=True, partials=6, prompt=0.6):
    f = 440 * 2 ** ((midi - 69) / 12)
    t = np.arange(int(SR * dur)) / SR
    w = np.zeros_like(t)
    for k in range(1, partials + 1):
        if f * k * 1.01 > SR / 2:
            break
        ph = rng.uniform(0, 2 * np.pi)
        for det, amp in ((-detune, 1.0), (detune, 0.8)):
            p = ph if in_phase else rng.uniform(0, 2 * np.pi)
            w += amp * np.sin(2 * np.pi * (f * k + det * k) * t + p) / k**1.6
    env = (prompt * np.exp(-8 * t) + (1 - prompt) * np.exp(-decay * t)) * np.minimum(1, t / 0.004)
    env[-200:] *= np.linspace(1, 0, 200)
    return w * env


def render(name, events, beat, rng, reverb=True, **tone_kw):
    lead = 0.5
    end = max(b + d for b, d, _, _ in events)
    out = np.zeros(int(SR * (lead + end * beat + 1)))
    truth = []
    for b, d, m, g in events:
        s = int(SR * (lead + b * beat))
        x = piano_tone(m, d * beat * 0.98, rng, **tone_kw)
        out[s : s + len(x)] += x * g
        truth.append([round(lead + b * beat, 4), round(d * beat, 4), m])
    if reverb:
        ir = np.exp(-np.arange(int(SR * 0.8)) / SR * 6) * rng.normal(0, 1, int(SR * 0.8)) * 0.02
        out = out + np.convolve(out, ir)[: len(out)]
    out /= np.abs(out).max() * 1.1
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((out * 32767).astype(np.int16).tobytes())
    (OUT / f"{name}.json").write_text(json.dumps(sorted(truth)))
    print(f"{name}: {len(truth)} notes")

mel = [72, 74, 76, 77, 79, 79, 79, 77, 76, 74, 72, 74, 76, 72, 74, 76, 77, 76, 74, 72, 71, 72, 74, 72]
durs = [1, 1, 1, 1, 2] + [1] * 19
ev, b = [], 0
for m, d in zip(mel, durs):
    ev.append((b, d, m, 0.5))
    b += d
for i, ch in enumerate([[48, 52, 55], [53, 57, 60], [55, 59, 62], [48, 52, 55]] * 3):
    if i * 2 >= b:
        break
    ev += [(i * 2, 2, m, 0.25) for m in ch]
render("melody_chords", ev, 0.5, np.random.default_rng(1), decay=3, detune=0, reverb=False, prompt=0)

long_rh = [(0, 4, 72), (4, 6, 76), (10, 1, 79), (11, 1, 79), (12, 1, 79), (13, 1, 79), (14, 8, 81), (22, 2, 77), (24, 8, 72)]
long_lh = [(0, 8, 48), (8, 8, 53), (16, 8, 55), (24, 8, 48)]
long_ev = [(b, d, m, 0.5) for b, d, m in long_rh] + [(b, d, m, 0.35) for b, d, m in long_lh]
render("long_notes", long_ev, 0.5, np.random.default_rng(2))

render("long_notes_hard", long_ev, 0.5, np.random.default_rng(3), detune=0.7, in_phase=False, prompt=0)

rep = [(i * 0.5, 0.5, 76, 0.5) for i in range(8)] + [(4 + i * 0.25, 0.25, 79, 0.5) for i in range(8)]
rep += [(6, 2, 72, 0.5), (0, 4, 48, 0.35), (4, 4, 43, 0.35)]
render("fast_repeats", rep, 0.5, np.random.default_rng(4))
