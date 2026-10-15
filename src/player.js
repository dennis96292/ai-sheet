import * as Tone from 'tone';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

const SALAMANDER = `${import.meta.env.BASE_URL}samples/piano/`;

function salamanderUrls() {
  const urls = { A0: 'A0.mp3', C8: 'C8.mp3' };
  for (let o = 1; o <= 7; o++) {
    urls[`C${o}`] = `C${o}.mp3`;
    urls[`D#${o}`] = `Ds${o}.mp3`;
    urls[`F#${o}`] = `Fs${o}.mp3`;
    urls[`A${o}`] = `A${o}.mp3`;
  }
  return urls;
}

const LOOKAHEAD = 1.5;

export class ScorePlayer {
  constructor(container, { onState, onPosition } = {}) {
    this.container = container;
    this.onState = onState ?? (() => {});
    this.onPosition = onPosition ?? (() => {});

    this.osmd = new OpenSheetMusicDisplay(container, {
      backend: 'svg',
      autoResize: false,
      autoBeam: true,
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      drawPartNames: false,
      drawPartAbbreviations: false,
      drawMetronomeMarks: false,
      followCursor: false,
      cursorsOptions: [{ type: 0, color: '#2563eb', alpha: 0.28, follow: false }],
    });

    this.piano = new Tone.Volume(0).toDestination();
    this.original = new Tone.Volume(-6).toDestination();
    this.pianoSamples = new Tone.ToneAudioBuffers({
      urls: salamanderUrls(),
      baseUrl: SALAMANDER,
      onerror: () => this.useSynthFallback(),
    });
    this.voice = null;

    this.score = null;
    this.steps = [];
    this.stepIdx = -1;
    this.pos = 0;
    this.playing = false;
    this.speed = 1;
    this.originalPlayer = null;
    this.originalMuted = false;

    this.raf = 0;
    this.timer = 0;
    this.frameInterval = 1000 / 60;

    container.addEventListener('click', (e) => this.handleClick(e));
    let resizeTimer = 0;
    this.resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.rerender(), 250);
    });
    this.lastWidth = container.clientWidth;
  }

  useSynthFallback() {
    this.synthFallback = true;
  }

  startVoice() {
    this.stopVoice();
    const gain = new Tone.Gain(1).connect(this.piano);
    let inst;
    if (!this.synthFallback && this.pianoSamples.loaded) {
      const urls = Object.fromEntries(Object.keys(salamanderUrls()).map((k) => [k, this.pianoSamples.get(k).get()]));
      inst = new Tone.Sampler({ urls, release: 1.2 });
    } else {
      inst = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.005, decay: 0.4, sustain: 0.2, release: 0.8 },
      });
    }
    this.voice = { inst: inst.connect(gain), gain };
  }

  stopVoice() {
    if (!this.voice) return;
    const { inst, gain } = this.voice;
    this.voice = null;
    gain.gain.rampTo(0, 0.03, this.ctx.currentTime);
    setTimeout(() => {
      inst.dispose();
      gain.dispose();
    }, 300);
  }

  get ctx() {
    return Tone.getContext();
  }

  async load(xml, score, originalAudioBuffer) {
    this.pause();
    this.score = score;
    this.pos = this.startTime;
    if (originalAudioBuffer !== undefined) {
      this.originalPlayer?.dispose();
      this.originalPlayer = originalAudioBuffer
        ? new Tone.Player(originalAudioBuffer).connect(this.original)
        : null;
    }
    await this.osmd.load(xml);
    this.osmd.render();
    this.buildSteps();
    this.setStep(0, false);
    this.resizeObserver.observe(this.container);
    this.emitPosition();
  }

  rerender() {
    if (!this.score) return;
    const width = this.container.clientWidth;
    if (this.pendingZoom == null && width === this.lastWidth) return;
    this.lastWidth = width;
    if (this.pendingZoom != null) {
      this.osmd.zoom = this.pendingZoom;
      this.pendingZoom = null;
    }
    const idx = this.stepIdx;
    this.osmd.render();
    this.buildSteps();
    this.setStep(Math.max(0, idx), false);
  }

  setZoom(z) {
    this.pendingZoom = z;
    this.rerender();
  }

  buildSteps() {
    const c = this.osmd.cursor;
    c.show();
    c.reset();
    const base = this.container.getBoundingClientRect();
    const steps = [];
    while (!c.iterator.EndReached) {
      const r = c.cursorElement.getBoundingClientRect();
      const els = c
        .GNotesUnderCursor()
        .filter((g) => !g.sourceNote.isRest())
        .map((g) => g.getSVGGElement?.())
        .filter(Boolean);
      steps.push({
        beat: c.iterator.currentTimeStamp.RealValue * 4,
        iter: c.iterator.clone(),
        els,
        x: r.left - base.left,
        y: r.top - base.top,
        h: r.height,
        w: r.width,
      });
      c.next();
    }
    c.reset();

    const firstNote = new Map();
    for (const n of this.score.playNotes) firstNote.set(n.beat, Math.min(firstNote.get(n.beat) ?? Infinity, n.time));
    let prev = -Infinity;
    for (const st of steps) {
      st.time = Math.max(prev, firstNote.get(st.beat) ?? this.score.beatToTime(st.beat));
      prev = st.time;
    }

    const groups = [];
    steps.forEach((st, i) => {
      const g = groups[groups.length - 1];
      if (g && st.time - steps[g.first].time < 0.06) g.last = i;
      else groups.push({ first: i, last: i });
      st.group = groups.length - 1;
    });
    this.steps = steps;
    this.groups = groups;
    this.groupIdx = -1;
    this.buildCursorAnimation();
  }

  buildCursorAnimation() {
    this.cursorAnim?.cancel();
    if (!this.playCursor) {
      this.playCursor = document.createElement('div');
      this.playCursor.className = 'play-cursor';
    }
    if (!this.playCursor.isConnected) this.container.appendChild(this.playCursor);
    if (!this.groups.length) return;
    const t0 = this.steps[this.groups[0].first].time - 2;
    const t1 = Math.max(this.score.totalTime, this.steps[this.groups[this.groups.length - 1].first].time) + 0.001;
    const frame = (st, offset) => ({
      offset,
      transform: `translate(${st.x}px, ${st.y}px) scale(${Math.max(1, st.w)}, ${st.h})`,
      easing: 'steps(1, end)',
    });
    const keyframes = this.groups.map((g) => {
      const st = this.steps[g.first];
      return frame(st, (st.time - t0) / (t1 - t0));
    });
    keyframes.unshift({ ...keyframes[0], offset: 0 });
    keyframes.push({ ...keyframes[keyframes.length - 1], offset: 1 });
    this.cursorAnim = this.playCursor.animate(keyframes, { duration: (t1 - t0) * 1000, fill: 'both' });
    this.cursorAnim.pause();
    this.cursorAnimT0 = t0;
  }

  syncCursorAnimation(heard, frameTs) {
    const anim = this.cursorAnim;
    if (!anim) return;
    const target = (heard - this.cursorAnimT0) * 1000;
    const start = frameTs - target / this.speed;
    if (anim.playState !== 'running' || anim.playbackRate !== this.speed) {
      anim.playbackRate = this.speed;
      anim.startTime = start;
      return;
    }
    if (Math.abs(anim.startTime - start) * this.speed > 4) anim.startTime = start;
  }


  groupSteps(g) {
    return this.steps.slice(this.groups[g].first, this.groups[g].last + 1);
  }

  stepAtTime(time) {
    let lo = 0, hi = this.steps.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.steps[mid].time <= time + 1e-4) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  get nativeContext() {
    const raw = this.ctx.rawContext;
    return raw._nativeContext ?? raw;
  }

  get outputLatency() {
    const native = this.nativeContext;
    return native.outputLatency || native.baseLatency || 0;
  }

  heardContextTime(frameTs) {
    const native = this.nativeContext;
    const fallback = native.currentTime - this.outputLatency;
    const o = native.getOutputTimestamp?.();
    if (!o || !(o.contextTime > 0) || !(o.performanceTime > 0)) return fallback;
    const heard = o.contextTime + (frameTs + this.frameInterval - o.performanceTime) / 1000;
    return Math.abs(heard - fallback) < 0.5 ? heard : fallback;
  }



  setStep(i, scroll = true) {
    if (!this.steps.length) return;
    i = Math.max(0, Math.min(this.steps.length - 1, i));
    const g = this.steps[i].group;
    if (g === this.groupIdx) return;
    if (this.groupIdx >= 0) this.groupSteps(this.groupIdx).forEach((st) => st.els.forEach((el) => el.classList.remove('playing')));
    this.groupIdx = g;
    this.stepIdx = this.groups[g].first;
    this.groupSteps(g).forEach((st) => st.els.forEach((el) => el.classList.add('playing')));
    const c = this.osmd.cursor;
    c.iterator = this.steps[this.stepIdx].iter.clone();
    if (!this.playing) c.update();
    if (scroll) this.scrollToCursor();
  }

  scrollToCursor() {
    const st = this.steps[this.stepIdx];
    if (!st) return;
    const top = this.container.getBoundingClientRect().top + st.y;
    const margin = 120;
    const viewH = window.innerHeight - 96;
    if (top < margin || top + st.h > viewH - 20) {
      window.scrollBy({ top: top - margin, behavior: 'smooth' });
    }
  }

  currentTime() {
    if (!this.playing) return this.pos;
    return this.startPos + (this.ctx.currentTime - this.startCtx) * this.speed;
  }

  currentBeat() {
    return this.score.timeToBeat(this.currentTime());
  }

  get startTime() {
    return Math.min(this.score.beatToTime(0), this.score.playNotes[0]?.time ?? 0);
  }


  async play() {
    if (!this.score || this.playing) return;
    await Tone.start();
    if (!this.synthFallback && !this.pianoSamples.loaded) {
      await Promise.race([Tone.loaded(), new Promise((r) => setTimeout(r, 5000))]);
    }
    if (this.playing) return;
    if (this.pos >= this.score.totalTime - 0.05) this.pos = this.startTime;
    this.playing = true;
    this.startVoice();
    this.startPos = this.pos;
    this.startCtx = this.ctx.currentTime + 0.06;
    const notes = this.score.playNotes;
    this.noteIdx = notes.findIndex((n) => n.time >= this.pos - 1e-3);
    if (this.noteIdx < 0) this.noteIdx = notes.length;
    this.startOriginal();
    this.container.classList.add('anim-cursor');
    this.timer = setInterval(() => this.schedule(), 100);
    this.schedule();
    let lastTs = 0;
    const intervals = [];
    const loop = (ts) => {
      if (lastTs) {
        intervals.push(ts - lastTs);
        if (intervals.length > 30) intervals.shift();
        this.frameInterval = Math.min(50, [...intervals].sort((a, b) => a - b)[intervals.length >> 1]);
      }
      lastTs = ts;
      this.tick(ts);
      if (this.playing) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.onState(true);
  }

  pause() {
    if (!this.playing) return;
    this.pos = Math.min(this.currentTime(), this.score.totalTime);
    this.playing = false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    this.stopVoice();
    if (this.originalPlayer?.state === 'started') this.originalPlayer.stop();
    this.cursorAnim?.pause();
    this.container.classList.remove('anim-cursor');
    this.osmd.cursor.update();
    this.onState(false);
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  startOriginal() {
    const p = this.originalPlayer;
    if (!p || this.originalMuted) return;
    p.playbackRate = this.speed;
    let offset = this.startPos;
    let when = this.startCtx;
    if (offset < 0) {
      when += -offset / this.speed;
      offset = 0;
    }
    if (offset < p.buffer.duration) p.start(when, offset);
  }

  schedule() {
    const notes = this.score.playNotes;
    const horizon = this.currentTime() + LOOKAHEAD * this.speed;
    while (this.noteIdx < notes.length && notes[this.noteIdx].time < horizon) {
      const n = notes[this.noteIdx++];
      const t = this.startCtx + (n.time - this.startPos) / this.speed;
      this.trigger(n, n.dur / this.speed, Math.max(t, this.ctx.currentTime));
    }
  }

  trigger(n, dur, time) {
    const name = Tone.Frequency(n.midi, 'midi').toNote();
    if (!this.voice) this.startVoice();
    this.voice.inst.triggerAttackRelease(name, Math.max(0.06, dur), time, 0.35 + n.velocity * 0.65);
  }

  tick(frameTs = performance.now()) {
    const t = this.currentTime();
    if (t >= this.score.totalTime) {
      this.pause();
      this.pos = this.startTime;
      this.setStep(0);
      this.emitPosition();
      return;
    }
    const heard = this.startPos + (this.heardContextTime(frameTs) - this.startCtx) * this.speed;
    this.syncCursorAnimation(heard, frameTs);
    this.setStep(this.stepAtTime(heard));
    this.emitPosition(heard);
  }

  emitPosition(t = this.currentTime()) {
    if (!this.score) return;
    const beat = Math.max(0, this.score.timeToBeat(t));
    const perMeasure = this.score.beatsPerMeasure;
    this.onPosition({
      beat,
      measure: Math.floor(beat / perMeasure) + 1,
      beatInMeasure: Math.floor(beat % perMeasure) + 1,
      progress: beat / this.score.totalBeats,
    });
  }

  seek(beat) {
    if (!this.score) return;
    const wasPlaying = this.playing;
    this.pause();
    beat = Math.max(0, Math.min(beat, this.score.totalBeats));
    this.pos = beat === 0 ? this.startTime : this.score.beatToTime(beat);
    this.setStep(beat === 0 ? 0 : this.stepAtTime(this.pos));
    this.emitPosition();
    if (wasPlaying) this.play();
  }

  currentStepTime() {
    return this.steps[this.stepIdx]?.time ?? this.currentTime();
  }

  seekStep(i) {
    if (!this.steps[i]) return;
    const wasPlaying = this.playing;
    this.pause();
    this.setStep(i);
    this.pos = this.steps[i].time;
    this.emitPosition();
    if (wasPlaying) this.play();
  }

  async step(dir) {
    if (!this.steps.length) return;
    await Tone.start();
    this.pause();
    this.startVoice();
    const hasNotes = (g) => this.groupSteps(g).some((st) => st.els.length);
    let g = this.groupIdx + dir;
    while (g > 0 && g < this.groups.length - 1 && !hasNotes(g)) g += dir;
    g = Math.max(0, Math.min(this.groups.length - 1, g));
    this.setStep(this.groups[g].first);
    this.pos = this.currentStepTime();
    this.emitPosition();
    const beats = new Set(this.groupSteps(g).map((st) => st.beat));
    const now = this.ctx.currentTime + 0.01;
    for (const n of this.score.playNotes) {
      if (beats.has(n.beat)) this.trigger(n, Math.min(n.dur, 1.5), now);
    }
  }

  setSpeed(speed) {
    if (this.playing) {
      const t = this.currentTime();
      this.pause();
      this.speed = speed;
      this.pos = t;
      this.play();
    } else {
      this.speed = speed;
    }
  }

  setPianoVolume(v) {
    this.piano.volume.value = v <= 0 ? -Infinity : 20 * Math.log10(v);
  }

  setOriginalVolume(v) {
    this.original.volume.value = v <= 0 ? -Infinity : 20 * Math.log10(v);
    const muted = v <= 0;
    if (muted !== this.originalMuted) {
      this.originalMuted = muted;
      if (this.playing) this.setSpeed(this.speed);
    }
  }

  handleClick(e) {
    if (!this.steps.length) return;
    const base = this.container.getBoundingClientRect();
    const x = e.clientX - base.left;
    const y = e.clientY - base.top;
    const inRow = this.steps
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => y >= s.y - 10 && y <= s.y + s.h + 10);
    if (!inRow.length) return;
    let best = inRow[0];
    for (const c of inRow) if (Math.abs(c.s.x - x) < Math.abs(best.s.x - x)) best = c;
    this.seekStep(best.i);
  }
}
