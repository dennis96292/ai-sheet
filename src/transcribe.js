import * as tf from '@tensorflow/tfjs';
import { BasicPitch } from '@spotify/basic-pitch';
export { extractNotes } from './notes.js';

const MODEL_SAMPLE_RATE = 22050;
const MODEL_URL = `${import.meta.env.BASE_URL}model/model.json`;

let basicPitch = null;

function getModel() {
  if (!basicPitch) basicPitch = new BasicPitch(tf.loadGraphModel(MODEL_URL));
  return basicPitch;
}

export async function decodeForModel(arrayBuffer) {
  const ctx = new OfflineAudioContext(1, 1, MODEL_SAMPLE_RATE);
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return { samples: mono, duration: buffer.duration };
}

export async function runModel(samples, onProgress) {
  const frames = [];
  const onsets = [];
  const contours = [];
  await getModel().evaluateModel(
    samples,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => onProgress?.(p),
  );
  return { frames, onsets, contours };
}

export async function serverAvailable() {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function analyzeOnServer(file, onProgress) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/analyze', { method: 'POST', body: form });
  if (!res.ok) throw new Error(`analyze failed: ${res.status}`);
  const { id } = await res.json();
  for (;;) {
    await new Promise((r) => setTimeout(r, 700));
    const job = await (await fetch(`/api/jobs/${id}`)).json();
    if (job.stage === 'done') {
      const { notes, ...rest } = job.result;
      return {
        ...rest,
        notes: notes.map((n) => ({ start: n.start, dur: n.end - n.start, midi: n.pitch, velocity: n.velocity / 127 })),
      };
    }
    if (job.stage === 'error') throw new Error(job.error);
    onProgress?.(job.progress);
  }
}
