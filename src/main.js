import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { icons } from './icons.js';
import { decodeForModel, runModel, extractNotes, serverAvailable, analyzeOnServer } from './transcribe.js';
import { estimateTempo, estimatePhase, estimateKey, buildScore, toMusicXML, trackedGrid, fixedGrid } from './score.js';
import { ScorePlayer } from './player.js';

const $ = (id) => document.getElementById(id);

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icons[el.dataset.icon] ?? '';

const ui = {
  file: $('file'),
  drop: $('drop'),
  busy: $('busy'),
  ringFg: $('ring-fg'),
  busyPct: $('busy-pct'),
  app: $('app'),
  transport: $('transport'),
  score: $('score'),
  play: $('btn-play'),
  pos: $('pos'),
  progress: $('progress'),
  progressFill: $('progress-fill'),
  settings: $('settings'),
  btnSettings: $('btn-settings'),
  downloadMenu: $('download-menu'),
  btnDownload: $('btn-download'),
  bpm: $('opt-bpm'),
  keyLabel: $('key-label'),
  ts: $('opt-ts'),
  grid: $('opt-grid'),
  sens: $('opt-sens'),
  split: $('opt-split'),
  splitLabel: $('split-label'),
  speed: $('speed'),
  speedLabel: $('speed-label'),
  volPiano: $('vol-piano'),
  volOrig: $('vol-orig'),
};

const state = {
  name: 'score',
  source: 'browser',
  analysis: null,
  serverNotes: [],
  manualBpm: null,
  anchors: [],
  raw: null,
  samples: null,
  notes: [],
  bpm: 100,
  phase: 0,
  key: null,
  beatsPerMeasure: 4,
  grid: 1,
  split: 60,
  sens: 0.5,
  score: null,
  xml: '',
  zoom: 1,
};

const player = new ScorePlayer(ui.score, {
  onState: (playing) => {
    ui.play.innerHTML = playing ? icons.pause : icons.play;
    ui.play.setAttribute('aria-label', playing ? '暫停' : '播放');
  },
  onPosition: ({ measure, beatInMeasure, progress }) => {
    ui.pos.textContent = `${measure} : ${beatInMeasure}`;
    ui.progressFill.style.width = `${Math.min(100, progress * 100)}%`;
  },
});
player.setPianoVolume(+ui.volPiano.value);
player.setOriginalVolume(+ui.volOrig.value);


function show(view) {
  ui.drop.hidden = view !== 'drop';
  ui.busy.hidden = view !== 'busy';
  ui.app.hidden = view !== 'app';
  ui.transport.hidden = view !== 'app';
}

function setProgress(p) {
  ui.busy.classList.toggle('indeterminate', p == null);
  if (p == null) {
    ui.busyPct.textContent = '';
    return;
  }
  ui.ringFg.style.strokeDashoffset = String(326.7 * (1 - p));
  ui.busyPct.textContent = Math.round(p * 100);
}


function sensitivityParams(s) {
  return {
    onsetThreshold: 0.7 - 0.4 * s,
    frameThreshold: 0.45 - 0.25 * s,
    minNoteMs: 160 - 100 * s,
    attackThreshold: 1.5 + 2 * (1 - s),
  };
}

function filterServerNotes() {
  const minVelocity = (1 - state.sens) * 0.16;
  return state.serverNotes.filter((n) => n.velocity >= minVelocity);
}

async function handleFile(file) {
  if (!file) return;
  player.pause();
  Tone.start();
  state.name = file.name.replace(/\.[^.]+$/, '') || 'score';
  show('busy');
  setProgress(null);
  try {
    const data = await file.arrayBuffer();
    const original = Tone.getContext().decodeAudioData(data.slice(0)).catch(() => null);
    state.anchors = [];
    state.manualBpm = null;
    if (await serverAvailable()) {
      setProgress(0);
      const result = await analyzeOnServer(file, setProgress);
      state.source = 'server';
      state.analysis = result;
      state.serverNotes = result.notes;
      state.notes = filterServerNotes();
      const ts = result.timeSignature?.match(/^([234])\/4$/);
      state.beatsPerMeasure = ts ? +ts[1] : 4;
    } else {
      const { samples } = await decodeForModel(data.slice(0));
      setProgress(0);
      state.raw = await runModel(samples, setProgress);
      state.samples = samples;
      state.source = 'browser';
      state.analysis = null;
      state.notes = extractNotes(state.raw, samples, sensitivityParams(state.sens));
    }
    setProgress(null);
    const tempo = estimateTempo(state.notes);
    state.bpm = tempo.bpm;
    state.phase = tempo.phase;
    state.key = estimateKey(state.notes);
    show('app');
    await rebuild(await original);
  } catch (err) {
    console.error(err);
    show(state.score ? 'app' : 'drop');
    ui.drop.classList.add('error');
    setTimeout(() => ui.drop.classList.remove('error'), 1500);
  }
}

function currentGrid() {
  const opts = { beatsPerMeasure: state.beatsPerMeasure, splitPoint: state.split, anchors: state.anchors };
  if (state.analysis && state.manualBpm == null) {
    const grid = trackedGrid(state.notes, { ...state.analysis, ...opts });
    if (grid) return grid;
  }
  return fixedGrid(state.notes, { bpm: state.manualBpm ?? state.bpm, phase: state.phase, ...opts });
}

async function rebuild(originalBuffer, keepTime) {
  state.score = buildScore(state.notes, {
    beatGrid: currentGrid(),
    beatsPerMeasure: state.beatsPerMeasure,
    step: state.grid,
    splitPoint: state.split,
    key: state.key,
  });
  state.xml = toMusicXML(state.score, state.name);
  syncSettingsUI();
  await player.load(state.xml, state.score, originalBuffer);
  if (keepTime != null) player.seek(state.score.timeToBeat(keepTime) + 1e-3);
}

let rebuildTimer = 0;
function scheduleRebuild(fn) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(async () => {
    fn?.();
    await rebuild();
  }, 300);
}


const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

function syncSettingsUI() {
  ui.bpm.value = state.manualBpm ?? state.score?.bpm ?? state.bpm;
  ui.keyLabel.textContent = state.key?.label ?? '';
  for (const b of ui.ts.children) b.classList.toggle('active', +b.dataset.v === state.beatsPerMeasure);
  for (const b of ui.grid.children) b.classList.toggle('active', +b.dataset.v === state.grid);
  ui.split.value = state.split;
  ui.splitLabel.textContent = NOTE_NAMES[state.split % 12] + (Math.floor(state.split / 12) - 1);
}

ui.bpm.addEventListener('change', () => {
  if (ui.bpm.value.trim() === '') {
    scheduleRebuild(() => {
      state.manualBpm = null;
    });
    return;
  }
  const bpm = Math.round(+ui.bpm.value);
  if (!(bpm >= 30 && bpm <= 260)) return syncSettingsUI();
  scheduleRebuild(() => {
    state.manualBpm = bpm;
    state.phase = estimatePhase(state.notes, bpm);
  });
});

ui.ts.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.beatsPerMeasure = +b.dataset.v;
  scheduleRebuild();
});

ui.grid.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.grid = +b.dataset.v;
  scheduleRebuild();
});

ui.sens.addEventListener('input', () => {
  scheduleRebuild(() => {
    state.sens = +ui.sens.value;
    state.notes =
      state.source === 'server' ? filterServerNotes() : extractNotes(state.raw, state.samples, sensitivityParams(state.sens));
    state.key = estimateKey(state.notes);
    state.phase = estimatePhase(state.notes, state.manualBpm ?? state.bpm);
  });
});

ui.split.addEventListener('input', () => {
  state.split = +ui.split.value;
  ui.splitLabel.textContent = NOTE_NAMES[state.split % 12] + (Math.floor(state.split / 12) - 1);
  scheduleRebuild();
});

function togglePopup(btn, popup, force) {
  const open = force ?? popup.hidden;
  popup.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}

ui.btnSettings.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePopup(ui.btnDownload, ui.downloadMenu, false);
  togglePopup(ui.btnSettings, ui.settings);
});
ui.btnDownload.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePopup(ui.btnSettings, ui.settings, false);
  togglePopup(ui.btnDownload, ui.downloadMenu);
});
ui.settings.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => {
  togglePopup(ui.btnSettings, ui.settings, false);
  togglePopup(ui.btnDownload, ui.downloadMenu, false);
});


function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('dl-xml').addEventListener('click', () => {
  download(new Blob([state.xml], { type: 'application/vnd.recordare.musicxml+xml' }), `${state.name}.musicxml`);
});

$('dl-midi').addEventListener('click', () => {
  const { bpm, playNotes } = state.score;
  const midi = new Midi();
  midi.header.setTempo(bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [state.beatsPerMeasure, 4] });
  const track = midi.addTrack();
  track.instrument.number = 0;
  const sec = 60 / bpm;
  for (const n of playNotes) {
    track.addNote({ midi: n.midi, time: n.beat * sec, duration: n.beats * sec, velocity: n.velocity });
  }
  download(new Blob([midi.toArray()], { type: 'audio/midi' }), `${state.name}.mid`);
});


ui.play.addEventListener('click', () => player.toggle());
$('btn-prev').addEventListener('click', () => player.step(-1));
$('btn-next').addEventListener('click', () => player.step(1));
$('btn-restart').addEventListener('click', () => player.seek(0));

async function setBarHere() {
  if (!state.score) return;
  const t = player.currentStepTime();
  state.anchors = [...state.anchors.filter((a) => Math.abs(a - t) > 0.05), t].sort((a, b) => a - b);
  await rebuild(undefined, t);
}
$('btn-bar').addEventListener('click', setBarHere);

ui.speed.addEventListener('input', () => {
  const v = +ui.speed.value;
  ui.speedLabel.textContent = `${Math.round(v * 100)}%`;
  player.setSpeed(v);
});
ui.volPiano.addEventListener('input', () => player.setPianoVolume(+ui.volPiano.value));
ui.volOrig.addEventListener('input', () => player.setOriginalVolume(+ui.volOrig.value));

function setZoom(z) {
  state.zoom = Math.min(2, Math.max(0.5, Math.round(z * 10) / 10));
  player.setZoom(state.zoom);
}
$('btn-zoom-in').addEventListener('click', () => setZoom(state.zoom + 0.1));
$('btn-zoom-out').addEventListener('click', () => setZoom(state.zoom - 0.1));

function seekFromProgress(e) {
  if (!state.score) return;
  const r = ui.progress.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  player.seek(p * state.score.totalBeats);
}
ui.progress.addEventListener('pointerdown', (e) => {
  seekFromProgress(e);
  ui.progress.setPointerCapture(e.pointerId);
  const move = (ev) => seekFromProgress(ev);
  ui.progress.addEventListener('pointermove', move);
  ui.progress.addEventListener('pointerup', () => ui.progress.removeEventListener('pointermove', move), { once: true });
});

document.addEventListener('keydown', (e) => {
  if (ui.app.hidden || e.target.matches('input, textarea')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    player.toggle();
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    player.step(1);
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    player.step(-1);
  } else if (e.code === 'KeyB') {
    e.preventDefault();
    setBarHere();
  } else if (e.code === 'Home') {
    e.preventDefault();
    player.seek(0);
  }
});


ui.drop.addEventListener('click', () => ui.file.click());
ui.drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') ui.file.click();
});
$('btn-open').addEventListener('click', () => ui.file.click());
ui.file.addEventListener('change', () => {
  handleFile(ui.file.files[0]);
  ui.file.value = '';
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) document.body.classList.remove('dragging');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('audio') || /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(f.name));
  handleFile(file);
});

show('drop');

if (import.meta.env.DEV) Object.assign(window, { __state: state, __player: player });
