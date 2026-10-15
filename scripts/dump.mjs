import { basename } from 'node:path';
import { extractNotes } from '../src/notes.js';
import { DEFAULTS, readWav, runModel } from './lib.mjs';

const [file, ...args] = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? +args[args.indexOf(k) + 1] : d);
const samples = readWav(file);
const raw = await runModel(basename(file, '.wav'), samples);
const notes = extractNotes(raw, samples, { ...DEFAULTS, postProcess: !args.includes('--raw') });
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
for (const n of notes.filter((n) => n.start >= arg('--from', 0) && n.start < arg('--to', 1e9))) {
  const name = NAMES[n.midi % 12] + (Math.floor(n.midi / 12) - 1);
  console.log(`${n.start.toFixed(2)}\t${n.dur.toFixed(2)}\t${name.padEnd(4)}\t${n.midi}\tv${n.velocity.toFixed(2)}\ta${Number.isFinite(n.attack) ? n.attack.toFixed(1) : '-'}`);
}
