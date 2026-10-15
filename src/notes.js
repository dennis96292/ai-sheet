import { outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } from '@spotify/basic-pitch';

const MODEL_SAMPLE_RATE = 22050;

export function extractNotes(
  raw,
  samples,
  { onsetThreshold = 0.5, frameThreshold = 0.3, minNoteMs = 120, attackThreshold = 2.5, postProcess = true } = {},
) {
  const minFrames = Math.max(1, Math.round((minNoteMs / 1000) * (MODEL_SAMPLE_RATE / 256)));
  const events = outputToNotesPoly(raw.frames, raw.onsets, onsetThreshold, frameThreshold, minFrames);
  const timed = noteFramesToTime(addPitchBendsToNoteEvents(raw.contours, events));
  const notes = timed
    .filter((n) => n.pitchMidi >= 21 && n.pitchMidi <= 108)
    .map((n) => ({
      start: n.startTimeSeconds,
      dur: n.durationSeconds,
      midi: n.pitchMidi,
      velocity: Math.min(1, Math.max(0.15, n.amplitude)),
      attack: attackRatio(samples, n.startTimeSeconds, n.pitchMidi),
    }))
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
  if (!postProcess) return notes;
  return removeHarmonics(mergeSplitNotes(notes, attackThreshold));
}


function toneEnergy(samples, from, to, freq) {
  const n = to - from;
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / MODEL_SAMPLE_RATE);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const s = samples[from + i] * w + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

function attackRatio(samples, t, midi) {
  const sr = MODEL_SAMPLE_RATE;
  const f = 440 * 2 ** ((midi - 69) / 12);
  const win = Math.round(0.04 * sr);
  const energy = (a) =>
    toneEnergy(samples, a, a + win, f) + (2 * f < sr / 2 ? 0.5 * toneEnergy(samples, a, a + win, 2 * f) : 0);
  let best = 0;
  for (let dt = -0.08; dt <= 0.04 + 1e-9; dt += 0.01) {
    const at = Math.round((t + dt) * sr);
    const before = at - Math.round(0.01 * sr) - win;
    const after = at + Math.round(0.005 * sr);
    if (before < 0 || after + win > samples.length) continue;
    best = Math.max(best, energy(after) / (energy(before) + 1e-9));
  }
  return best || Infinity;
}


function mergeSplitNotes(notes, attackThreshold) {
  const lastByPitch = new Map();
  const out = [];
  for (const n of notes) {
    const prev = lastByPitch.get(n.midi);
    if (prev && n.start <= prev.start + prev.dur + 0.08 && n.attack < attackThreshold) {
      prev.dur = Math.max(prev.start + prev.dur, n.start + n.dur) - prev.start;
      prev.velocity = Math.max(prev.velocity, n.velocity);
      continue;
    }
    out.push(n);
    lastByPitch.set(n.midi, n);
  }
  return out;
}

const HARMONIC_INTERVALS = [12, 19, 24, 28, 31, 34, 36];
const HARMONIC_RATIO = 0.7;

function removeHarmonics(notes) {
  const isHarmonicOf = (n, m) =>
    HARMONIC_INTERVALS.includes(n.midi - m.midi) &&
    n.start > m.start - 0.06 &&
    n.start < m.start + m.dur - 0.05 &&
    n.velocity < m.velocity * HARMONIC_RATIO;
  return notes.filter((n, i) => {
    for (let j = i - 1; j >= 0 && n.start - notes[j].start < 8; j--) if (isHarmonicOf(n, notes[j])) return false;
    for (let j = i + 1; j < notes.length && notes[j].start - n.start < 0.06; j++) if (isHarmonicOf(n, notes[j])) return false;
    return true;
  });
}
