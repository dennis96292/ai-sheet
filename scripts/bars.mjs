import { readFileSync } from 'node:fs';
import { trackedGrid } from '../src/score.js';

const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const notes = r.notes.map((n) => ({ start: n.start, dur: n.end - n.start, midi: n.pitch, velocity: n.velocity / 127 }));
const B = Number(r.timeSignature?.split('/')[0]) || 4;
const g = trackedGrid(notes, { ...r, beatsPerMeasure: B, splitPoint: 60 });
const bars = [];
for (let i = 0; i < g.t.length; i += B) bars.push(g.t[i].toFixed(2));
console.log('小節起點:', bars.join('  '));
console.log('中位數 BPM:', g.bpm.toFixed(1));
