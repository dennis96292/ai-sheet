import { readFileSync } from 'node:fs';
import { trackedGrid, buildScore, estimateKey } from '../src/score.js';

const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const r = JSON.parse(readFileSync(args[0], 'utf8'));
const notes = r.notes.map((n) => ({ start: n.start, dur: n.end - n.start, midi: n.pitch, velocity: n.velocity / 127 }));
const anchors = arg('--anchors')?.split(',').map(Number) ?? [];
const [from, to] = (arg('--measures') ?? '1-99').split('-').map(Number);
const B = 4;
const beatGrid = trackedGrid(notes, { ...r, beatsPerMeasure: B, splitPoint: 60, anchors });
const key = estimateKey(notes);
const step = Number(arg("--step") ?? 1);
const score = buildScore(notes, { beatGrid, beatsPerMeasure: B, step, splitPoint: 60, key });

const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const name = (m) => FLAT[m % 12] + (Math.floor(m / 12) - 1);
const fmt = (b) => {
  const inBar = b % B;
  return `${Math.floor(inBar) + 1}${['', '+¼', '+½', '+¾'][Math.round((inBar % 1) * 4)]}`;
};
console.log(`BPM ${score.bpm}，${key.label}，${score.measureCount} 小節`);
for (let m = from - 1; m < Math.min(to, score.measureCount); m++) {
  const lines = [0, 1].map((staff) => {
    const evs = new Map();
    for (const n of score.playNotes) {
      if (Math.floor(n.beat / B) !== m || (staff === 0) !== n.midi >= 60) continue;
      const k = n.beat;
      evs.set(k, [...(evs.get(k) ?? []), n.midi]);
    }
    return [...evs.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([b, ms]) => `${fmt(b)}:${ms.sort((x, y) => x - y).map(name).join('/')}`)
      .join('  ');
  });
  console.log(`m${m + 1}  右: ${lines[0] || '-'}`);
  console.log(`     左: ${lines[1] || '-'}`);
}
