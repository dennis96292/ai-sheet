
export const DIVISIONS = 4;


export function estimateTempo(notes) {
  if (notes.length < 4) return { bpm: 100, phase: notes[0]?.start ?? 0 };

  const res = 0.01;
  const end = notes[notes.length - 1].start + 1;
  const env = new Float32Array(Math.ceil(end / res) + 1);
  for (const n of notes) env[Math.round(n.start / res)] += n.velocity;

  const smooth = new Float32Array(env.length);
  const kernel = [0.06, 0.24, 0.4, 0.24, 0.06];
  for (let i = 0; i < env.length; i++) {
    let s = 0;
    for (let k = -2; k <= 2; k++) s += (env[i + k] ?? 0) * kernel[k + 2];
    smooth[i] = s;
  }

  const acf = (lag) => {
    let s = 0;
    for (let i = 0; i + lag < smooth.length; i++) s += smooth[i] * smooth[i + lag];
    return s;
  };

  let best = { score: -1, bpm: 100 };
  for (let bpm = 50; bpm <= 200; bpm += 0.5) {
    const lag = Math.round(60 / bpm / res);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.7) ** 2);
    const score = (acf(lag) + 0.5 * acf(lag * 2) + 0.25 * acf(Math.round(lag / 2))) * prior;
    if (score > best.score) best = { score, bpm };
  }

  let refined = { err: Infinity, bpm: best.bpm };
  for (let bpm = best.bpm * 0.96; bpm <= best.bpm * 1.04; bpm += 0.25) {
    const { err } = bestPhase(notes, bpm, 24);
    if (err < refined.err) refined = { err, bpm };
  }
  const bpm = Math.round(refined.bpm);
  return { bpm, phase: estimatePhase(notes, bpm) };
}

function gridError(notes, beat, phase) {
  let err = 0;
  for (const n of notes) {
    const b = (n.start - phase) / beat;
    const e8 = Math.abs(b * 2 - Math.round(b * 2));
    const e4 = Math.abs(b - Math.round(b));
    err += (e8 + 0.5 * e4) * n.velocity;
  }
  return err;
}

function bestPhase(notes, bpm, steps) {
  const beat = 60 / bpm;
  let best = { err: Infinity, phase: 0 };
  for (let p = 0; p < steps; p++) {
    const phase = (p / steps) * beat;
    const err = gridError(notes, beat, phase);
    if (err < best.err) best = { err, phase };
  }
  return best;
}

export function estimatePhase(notes, bpm) {
  return bestPhase(notes, bpm, 48).phase;
}


const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  return a.length ? a[a.length >> 1] : 0;
};

export class BeatGrid {
  constructor(times) {
    this.t = times;
  }

  toBeat(time) {
    const t = this.t;
    const n = t.length;
    if (time <= t[0]) return (time - t[0]) / (t[1] - t[0]);
    if (time >= t[n - 1]) return n - 1 + (time - t[n - 1]) / (t[n - 1] - t[n - 2]);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= time) lo = mid;
      else hi = mid;
    }
    return lo + (time - t[lo]) / (t[lo + 1] - t[lo]);
  }

  toTime(beat) {
    const t = this.t;
    const n = t.length;
    if (beat <= 0) return t[0] + beat * (t[1] - t[0]);
    if (beat >= n - 1) return t[n - 1] + (beat - n + 1) * (t[n - 1] - t[n - 2]);
    const i = Math.floor(beat);
    return t[i] + (beat - i) * (t[i + 1] - t[i]);
  }

  get bpm() {
    const d = [];
    for (let i = 1; i < this.t.length; i++) d.push(this.t[i] - this.t[i - 1]);
    return 60 / median(d);
  }
}

export function fixedGrid(notes, { bpm, phase, beatsPerMeasure, splitPoint, anchors = [] }) {
  const beat = 60 / bpm;
  if (anchors.length) {
    const anchor = anchors[anchors.length - 1];
    const first = Math.floor(((notes[0]?.start ?? anchor) - anchor) / beat);
    const origin = beatsPerMeasure * Math.floor(first / beatsPerMeasure);
    return new BeatGrid([anchor + origin * beat, anchor + (origin + 1) * beat]);
  }
  const pos = notes.map((n) => ({ b: (n.start - phase) / beat, n }));
  const first = Math.floor(pos[0]?.b ?? 0);
  const onBeat = pos.filter(({ b }) => Math.abs(b - Math.round(b)) < 0.15).map(({ b, n }) => ({ i: Math.round(b), n }));
  const down = pickDownbeatPhase(onBeat, beatsPerMeasure, splitPoint, first);
  const origin = down + beatsPerMeasure * Math.floor((first - down) / beatsPerMeasure);
  return new BeatGrid([phase + origin * beat, phase + (origin + 1) * beat]);
}

function pickDownbeatPhase(onBeat, beatsPerMeasure, splitPoint, firstBeat) {
  const mod = (a) => ((a % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
  const scores = new Array(beatsPerMeasure).fill(0);
  let total = 0;
  for (const { i, n } of onBeat) {
    const w = n.velocity * (1 + Math.min(4, n.dur * 2)) * (n.midi < splitPoint ? 1.5 : 1);
    scores[mod(i)] += w;
    total += w;
  }
  scores[mod(firstBeat)] += total * 0.05 + 1e-9;
  return scores.indexOf(Math.max(...scores));
}

export function trackedGrid(notes, { beats, beatProb, downbeatProb, downbeats = [], beatsPerMeasure: B, splitPoint, anchors = [] }) {
  if (!beats || beats.length < 4) return null;
  const med = median(beats.slice(1).map((b, i) => b - beats[i]));

  const off100 = (f) => Math.abs(Math.log2(60 / (med / f) / 100));
  let factor = [0.5, 1, 2].reduce((best, f) => (off100(f) < off100(best) ? f : best));
  let lv = beats;
  let bp = beatProb ?? beats.map(() => 1);
  let dp = downbeatProb ?? beats.map((t) => (downbeats.some((d) => Math.abs(d - t) < med * 0.3) ? 0.8 : 0.1));
  if (!Number.isInteger(B / factor)) {
    const mid = (arr, f) => arr.flatMap((v, i) => (i < arr.length - 1 ? [v, f(v, arr[i + 1])] : [v]));
    lv = mid(beats, (a, b) => (a + b) / 2);
    bp = mid(bp, () => 0.5);
    dp = mid(dp, () => 0);
    factor = 1;
  }
  const Bt = B / factor;
  const qBeat = med / factor;

  const forcedTimes = new Set(anchors);
  if (anchors.length) {
    const near = (t) => anchors.some((a) => Math.abs(t - a) < med * 0.3);
    const merged = [
      ...lv.map((t, i) => ({ t, bp: bp[i], dp: dp[i] })).filter(({ t }) => !near(t)),
      ...anchors.map((t) => ({ t, bp: 1, dp: 1 })),
    ].sort((a, b) => a.t - b.t);
    lv = merged.map((x) => x.t);
    bp = merged.map((x) => x.bp);
    dp = merged.map((x) => x.dp);
  }
  const n = lv.length;

  const sal = lv.map((time) =>
    notes.reduce(
      (s, nt) => (Math.abs(nt.start - time) < Math.min(0.12, qBeat * 0.3) ? s + nt.velocity * (nt.midi < splitPoint ? 1.5 : 1) : s),
      0,
    ),
  );
  const salRef = median(sal.filter((s) => s > 0)) || 1;

  const W = 4;
  const JUMP = 1.5;
  const forced = new Set(lv.flatMap((t, i) => (forcedTimes.has(t) ? [i] : [])));
  const emit = (i, s) => {
    if (forced.has(i)) return s === 0 ? 100 : -100;
    return s === 0 ? W * (dp[i] - 0.3) + 0.3 * Math.min(3, sal[i] / salRef) : 0;
  };
  const states = new Array(n).fill(0);
  const inserted = new Array(n).fill(false);
  if (Bt > 1) {
    let score = Array.from({ length: Bt }, (_, s) => emit(0, s));
    const back = [];
    for (let i = 1; i < n; i++) {
      const locked = [...forced].some((f) => i > f && i <= f + Bt * 4);
      const jump = locked ? 100 : JUMP;
      const insert = jump * (0.6 + 0.4 * bp[i]);
      const ptr = new Array(Bt);
      const next = new Array(Bt);
      for (let s = 0; s < Bt; s++) {
        const prev = (s - 1 + Bt) % Bt;
        const skip = (s - 2 + 2 * Bt) % Bt;
        const options = [
          [score[prev], prev, false],
          [score[skip] - jump, skip, false],
        ];
        if (!forced.has(i)) options.push([score[s] - insert, s, true]);
        const [best, from, extra] = options.reduce((a, b) => (b[0] > a[0] ? b : a));
        next[s] = best + emit(i, s);
        ptr[s] = [from, extra];
      }
      score = next;
      back.push(ptr);
    }
    states[n - 1] = score.indexOf(Math.max(...score));
    for (let i = n - 1; i > 0; i--) {
      [states[i - 1], inserted[i]] = back[i - 1][states[i]];
    }
  }
  const dIdx = states.flatMap((s, i) => (s === 0 && !inserted[i] ? [i] : []));

  const typical = median(dIdx.slice(1).map((j, k) => lv[j] - lv[dIdx[k]]));
  for (let k = 0; k < dIdx.length - 1; ) {
    if (lv[dIdx[k + 1]] - lv[dIdx[k]] >= typical * 0.5) {
      k++;
      continue;
    }
    const [a, b] = [dIdx[k], dIdx[k + 1]];
    const drop = forced.has(a) ? k + 1 : forced.has(b) ? k : dp[a] < dp[b] ? k : k + 1;
    dIdx.splice(drop, 1);
    k = Math.max(0, k - 1);
  }

  const toQuarters = (times) => {
    const out = [];
    if (factor < 1) {
      for (let k = 0; k < times.length - 1; k += 1 / factor) out.push(times[k]);
    } else {
      for (let k = 0; k < times.length - 1; k++) {
        for (let f = 0; f < factor; f++) out.push(times[k] + ((times[k + 1] - times[k]) * f) / factor);
      }
    }
    return out;
  };
  const even = (a, b, count) => Array.from({ length: count }, (_, k) => a + ((b - a) * k) / count);

  if (!dIdx.length) return new BeatGrid([...toQuarters(lv), lv[n - 1]]);

  const out = [];
  for (let k = 0; k < dIdx.length - 1; k++) {
    const i = dIdx[k];
    const j = dIdx[k + 1];
    out.push(...(j - i === Bt ? toQuarters(lv.slice(i, j + 1)) : even(lv[i], lv[j], B)));
  }
  const last = dIdx[dIdx.length - 1];
  out.push(...toQuarters(lv.slice(last)), lv[n - 1]);

  const head = toQuarters(lv.slice(0, dIdx[0] + 1));
  const step0 = (out[1] ?? out[0] + qBeat) - out[0];
  const pad = (B - (head.length % B)) % B;
  const start = head[0] ?? out[0];
  const before = Array.from({ length: pad }, (_, k) => start - step0 * (pad - k));
  const times = [...before, ...head, ...out];
  if (times.length < 2) times.push(times[0] + qBeat);
  return new BeatGrid(times);
}


const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const FIFTHS_OF_MAJOR = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };
const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

function correlate(a, b) {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1);
}

export function estimateKey(notes) {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[n.midi % 12] += n.dur * n.velocity;
  let best = { r: -Infinity, tonic: 0, mode: 'major' };
  for (let t = 0; t < 12; t++) {
    const rotated = hist.map((_, i) => hist[(i + t) % 12]);
    const rMaj = correlate(rotated, MAJOR_PROFILE);
    const rMin = correlate(rotated, MINOR_PROFILE);
    if (rMaj > best.r) best = { r: rMaj, tonic: t, mode: 'major' };
    if (rMin > best.r) best = { r: rMin, tonic: t, mode: 'minor' };
  }
  const majorTonic = best.mode === 'major' ? best.tonic : (best.tonic + 3) % 12;
  const fifths = FIFTHS_OF_MAJOR[majorTonic];
  const names = fifths < 0 ? FLAT_NAMES : SHARP_NAMES;
  const label = best.mode === 'major' ? `${names[best.tonic]} 大調` : `${names[best.tonic].toLowerCase()} 小調`;
  return { fifths, mode: best.mode, label };
}


export function buildScore(notes, { beatGrid, beatsPerMeasure = 4, step = 1, splitPoint = 60, key }) {
  const measureLen = beatsPerMeasure * DIVISIONS;
  const quantize = (beat, unit) => Math.round((beat * DIVISIONS) / unit) * unit;

  const onsets = [...new Set(notes.map((n) => beatGrid.toBeat(n.start)))].sort((a, b) => a - b);
  const isDense = (beat) => {
    const i = onsets.indexOf(beat);
    const gaps = [onsets[i] - onsets[i - 1], onsets[i + 1] - onsets[i]].filter((g) => g > 0.06);
    return gaps.some((g) => g < 0.375);
  };

  let q = notes.map((n) => {
    const b = beatGrid.toBeat(n.start);
    const unit = step === 1 && !isDense(b) ? 2 : step;
    const s = quantize(b, unit);
    let e = quantize(beatGrid.toBeat(n.start + n.dur), unit);
    if (e <= s) e = s + unit;
    return { s, e, midi: n.midi, velocity: n.velocity, time: n.start, dur: n.dur };
  });

  const seen = new Map();
  for (const n of q) {
    const k = `${n.s}:${n.midi}`;
    const prev = seen.get(k);
    if (!prev || n.e > prev.e) seen.set(k, n);
  }
  q = [...seen.values()].sort((a, b) => a.s - b.s || a.midi - b.midi);

  const origin = q.length ? Math.min(0, Math.floor(q[0].s / measureLen) * measureLen) : 0;
  for (const n of q) {
    n.s -= origin;
    n.e -= origin;
  }
  const beatOffset = origin / DIVISIONS;
  const lastEnd = q.reduce((m, n) => Math.max(m, n.e), 0);
  const measureCount = Math.max(1, Math.ceil(lastEnd / measureLen));
  const totalLen = measureCount * measureLen;

  const staves = [
    q.filter((n) => n.midi >= splitPoint),
    q.filter((n) => n.midi < splitPoint),
  ].map((staffNotes) => toSegments(staffNotes, totalLen));

  const playNotes = q
    .map((n) => ({
      time: n.time,
      dur: n.dur,
      beat: n.s / DIVISIONS,
      beats: (n.e - n.s) / DIVISIONS,
      midi: n.midi,
      velocity: n.velocity,
    }))
    .sort((a, b) => a.time - b.time);

  const beatToTime = (b) => beatGrid.toTime(b + beatOffset);
  const totalBeats = totalLen / DIVISIONS;
  return {
    bpm: Math.round(beatGrid.bpm),
    beatsPerMeasure,
    measureLen,
    measureCount,
    totalBeats,
    totalTime: Math.max(beatToTime(totalBeats), ...playNotes.map((n) => n.time + n.dur)),
    beatToTime,
    timeToBeat: (t) => beatGrid.toBeat(t) - beatOffset,
    key,
    staves,
    playNotes,
  };
}

function toSegments(notes, totalLen) {
  const groups = [];
  for (const n of notes) {
    const g = groups[groups.length - 1];
    if (g && g.s === n.s) g.notes.push(n);
    else groups.push({ s: n.s, notes: [n] });
  }
  const segs = [];
  let cursor = 0;
  groups.forEach((g, i) => {
    const next = groups[i + 1]?.s ?? totalLen;
    let end = Math.min(next, Math.max(...g.notes.map((n) => n.e)));
    if (next < totalLen && next - end <= Math.max(2, (end - g.s) / 2)) end = next;
    if (g.s > cursor) segs.push({ s: cursor, e: g.s, pitches: null });
    segs.push({ s: g.s, e: end, pitches: g.notes.map((n) => n.midi) });
    cursor = end;
  });
  if (cursor < totalLen) segs.push({ s: cursor, e: totalLen, pitches: null });
  return segs;
}


const NOTE_VALUES = [
  { len: 16, type: 'whole', dot: false, align: 16 },
  { len: 12, type: 'half', dot: true, align: 4 },
  { len: 8, type: 'half', dot: false, align: 4 },
  { len: 6, type: 'quarter', dot: true, align: 2 },
  { len: 4, type: 'quarter', dot: false, align: 2 },
  { len: 3, type: 'eighth', dot: true, align: 1 },
  { len: 2, type: 'eighth', dot: false, align: 1 },
  { len: 1, type: '16th', dot: false, align: 1 },
];

function splitDuration(pos, len) {
  const pieces = [];
  while (len > 0) {
    const v = NOTE_VALUES.find((v) => v.len <= len && pos % v.align === 0);
    pieces.push(v);
    pos += v.len;
    len -= v.len;
  }
  return pieces;
}

const STEPS_SHARP = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const STEPS_FLAT = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

function pitchXml(midi, useFlats) {
  const [step, alter] = (useFlats ? STEPS_FLAT : STEPS_SHARP)[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`;
}

function noteXml({ midi, chord, value, staff, voice, tieStart, tieStop, useFlats }) {
  const ties = [];
  if (tieStop) ties.push('stop');
  if (tieStart) ties.push('start');
  return (
    '<note>' +
    (chord ? '<chord/>' : '') +
    (midi == null ? '<rest/>' : pitchXml(midi, useFlats)) +
    `<duration>${value.len}</duration>` +
    ties.map((t) => `<tie type="${t}"/>`).join('') +
    `<voice>${voice}</voice><type>${value.type}</type>${value.dot ? '<dot/>' : ''}` +
    `<staff>${staff}</staff>` +
    (ties.length ? `<notations>${ties.map((t) => `<tied type="${t}"/>`).join('')}</notations>` : '') +
    '</note>'
  );
}

function staffMeasureXml(segs, staffIdx, mStart, measureLen, useFlats) {
  const staff = staffIdx + 1;
  const voice = staffIdx === 0 ? 1 : 5;
  const mEnd = mStart + measureLen;
  const parts = segs.filter((g) => g.e > mStart && g.s < mEnd);

  if (parts.length === 1 && !parts[0].pitches) {
    return `<note><rest measure="yes"/><duration>${measureLen}</duration><voice>${voice}</voice><staff>${staff}</staff></note>`;
  }

  let xml = '';
  for (const g of parts) {
    const s = Math.max(g.s, mStart);
    const e = Math.min(g.e, mEnd);
    const pieces = splitDuration(s - mStart, e - s);
    pieces.forEach((value, i) => {
      if (!g.pitches) {
        xml += noteXml({ midi: null, value, staff, voice });
        return;
      }
      const tieStop = i > 0 || s > g.s;
      const tieStart = i < pieces.length - 1 || e < g.e;
      g.pitches.forEach((midi, j) => {
        xml += noteXml({ midi, chord: j > 0, value, staff, voice, tieStart, tieStop, useFlats });
      });
    });
  }
  return xml;
}

export function toMusicXML(score, title = '鋼琴譜') {
  const { measureLen, measureCount, beatsPerMeasure, key, bpm, staves } = score;
  const useFlats = key.fifths < 0;
  const esc = (s) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

  let measures = '';
  for (let m = 0; m < measureCount; m++) {
    const mStart = m * measureLen;
    let xml = `<measure number="${m + 1}">`;
    if (m === 0) {
      xml +=
        `<attributes><divisions>${DIVISIONS}</divisions>` +
        `<key><fifths>${key.fifths}</fifths><mode>${key.mode}</mode></key>` +
        `<time><beats>${beatsPerMeasure}</beats><beat-type>4</beat-type></time>` +
        '<staves>2</staves>' +
        '<clef number="1"><sign>G</sign><line>2</line></clef>' +
        '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>' +
        '<direction placement="above"><direction-type><metronome>' +
        `<beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute>` +
        `</metronome></direction-type><staff>1</staff><sound tempo="${bpm}"/></direction>`;
    }
    xml += staffMeasureXml(staves[0], 0, mStart, measureLen, useFlats);
    xml += `<backup><duration>${measureLen}</duration></backup>`;
    xml += staffMeasureXml(staves[1], 1, mStart, measureLen, useFlats);
    xml += '</measure>';
    measures += xml;
  }

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<score-partwise version="3.1">' +
    `<work><work-title>${esc(title)}</work-title></work>` +
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
    `<part id="P1">${measures}</part></score-partwise>`
  );
}
