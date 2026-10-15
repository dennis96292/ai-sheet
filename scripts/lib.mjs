import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tf from '@tensorflow/tfjs';
import { BasicPitch } from '@spotify/basic-pitch';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = resolve(root, 'test/.cache');
mkdirSync(cacheDir, { recursive: true });

export const DEFAULTS = { onsetThreshold: 0.5, frameThreshold: 0.325, minNoteMs: 110, attackThreshold: 2.5 };

export function readWav(path) {
  const buf = readFileSync(path);
  const sampleRate = buf.readUInt32LE(24);
  const channels = buf.readUInt16LE(22);
  let off = 12;
  while (buf.toString('ascii', off, off + 4) !== 'data') off += 8 + buf.readUInt32LE(off + 4);
  const len = buf.readUInt32LE(off + 4) / 2 / channels;
  const samples = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += buf.readInt16LE(off + 8 + (i * channels + c) * 2) / 32768;
    samples[i] = s / channels;
  }
  if (sampleRate !== 22050) throw new Error(`${path}: 需要 22050 Hz，實際 ${sampleRate}`);
  return samples;
}

let basicPitch;
function getModel() {
  if (basicPitch) return basicPitch;
  const dir = resolve(root, 'node_modules/@spotify/basic-pitch/model');
  const json = JSON.parse(readFileSync(resolve(dir, 'model.json'), 'utf8'));
  const bin = readFileSync(resolve(dir, json.weightsManifest[0].paths[0]));
  const handler = tf.io.fromMemory({
    modelTopology: json.modelTopology,
    weightSpecs: json.weightsManifest[0].weights,
    weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
    format: json.format,
  });
  basicPitch = new BasicPitch(tf.loadGraphModel(handler));
  return basicPitch;
}

export async function runModel(name, samples) {
  const cache = resolve(cacheDir, `${name}.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  process.stdout.write(`  執行模型：${name} …`);
  const raw = { frames: [], onsets: [], contours: [] };
  await getModel().evaluateModel(samples, (f, o, c) => {
    raw.frames.push(...f);
    raw.onsets.push(...o);
    raw.contours.push(...c);
  }, () => {});
  writeFileSync(cache, JSON.stringify(raw));
  console.log(' 完成');
  return raw;
}

