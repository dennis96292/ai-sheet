import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { extractNotes } from '../src/notes.js';
import { root, DEFAULTS, readWav, runModel } from './lib.mjs';

const RAW_MODE = process.argv.includes('--raw');
const DETAIL = process.argv.includes('--detail');
const SERVER = process.argv.includes('--server');

function evaluate(notes, truth) {
  const used = new Set();
  let matched = 0;
  let durErr = 0;
  for (const [s, d, m] of truth) {
    let best = -1;
    notes.forEach((n, i) => {
      if (used.has(i) || n.midi !== m || Math.abs(n.start - s) >= 0.1) return;
      if (best < 0 || Math.abs(n.start - s) < Math.abs(notes[best].start - s)) best = i;
    });
    if (best >= 0) {
      used.add(best);
      matched++;
      durErr += Math.abs(notes[best].dur - d) / d;
    }
  }
  let split = 0;
  let extra = 0;
  notes.forEach((n, i) => {
    if (used.has(i)) return;
    const inside = truth.some(([s, d, m]) => m === n.midi && n.start > s + 0.05 && n.start < s + d + 0.1);
    inside ? split++ : extra++;
  });
  if (DETAIL) {
    const fmt = (n) => `${n.midi}@${n.start.toFixed(2)}+${n.dur.toFixed(2)}`;
    const missed = truth.filter(([s, , m]) => ![...used].some((i) => notes[i].midi === m && Math.abs(notes[i].start - s) < 0.1));
    console.log('    漏掉:', missed.map(([s, d, m]) => `${m}@${s}+${d}`).join(' ') || '-');
    console.log('    未對中:', notes.filter((_, i) => !used.has(i)).map(fmt).join(' ') || '-');
    console.log('    長度差>30%:', [...used].filter((i) => {
      const t = truth.find(([s, , m]) => m === notes[i].midi && Math.abs(notes[i].start - s) < 0.1);
      return Math.abs(notes[i].dur - t[1]) / t[1] > 0.3;
    }).map((i) => fmt(notes[i])).join(' ') || '-');
  }
  return { total: truth.length, matched, missed: truth.length - matched, split, extra, durErr: matched ? durErr / matched : 0 };
}

const casesDir = resolve(root, 'test/cases');
const opts = RAW_MODE ? { ...DEFAULTS, postProcess: false } : DEFAULTS;
const rows = [];
for (const file of readdirSync(casesDir).filter((f) => f.endsWith('.wav')).sort()) {
  const name = basename(file, '.wav');
  const truth = JSON.parse(readFileSync(resolve(casesDir, `${name}.json`), 'utf8'));
  let notes;
  if (SERVER) {
    const cached = resolve(root, 'test/.cache/server', `${name}.json`);
    if (!existsSync(cached)) continue;
    notes = JSON.parse(readFileSync(cached, 'utf8')).notes.map((n) => ({ start: n.start, dur: n.end - n.start, midi: n.pitch }));
  } else {
    const samples = readWav(resolve(casesDir, file));
    notes = extractNotes(await runModel(name, samples), samples, opts);
  }
  if (DETAIL) console.log(name);
  const r = evaluate(notes, truth);
  rows.push({
    測試: name,
    對中: `${r.matched}/${r.total}`,
    漏掉: r.missed,
    長音被切斷: r.split,
    多餘的音: r.extra,
    長度誤差: `${Math.round(r.durErr * 100)}%`,
  });
}
console.log(SERVER ? '\nTranskun（本機服務）' : RAW_MODE ? '\nBasic Pitch 原始結果（無後處理）' : '\nBasic Pitch + 後處理');
console.table(rows);
