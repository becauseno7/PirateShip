// Fully procedural audio: synthesized SFX, ocean/wind ambience and a small
// step-sequenced music engine with several looping tracks.
import * as THREE from 'three';

type TrackName = 'title' | 'sail' | 'explore' | 'battle' | 'boss' | 'awaken' | 'ending' | 'none';
type Inst = 'accordion' | 'square' | 'brass' | 'flute' | 'bright' | 'pluck';

interface Track {
  bpm: number;
  stepsPerBeat: number;
  length: number; // steps
  lead: [number, number, number][]; // step, midi, dur
  lead2?: [number, number, number][];
  bass: [number, number, number][];
  chords?: [number, number[], number][];
  drums: { kick?: number[]; snare?: number[]; hat?: number[]; tom?: number[]; shaker?: number[] };
  inst: Inst;
  inst2?: Inst;
  leadVol?: number;
}

const NOTE: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
function midi(n: string) {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(n);
  if (!m) return 0;
  return NOTE[m[1]] + (parseInt(m[2]) + 1) * 12;
}
/** Parse "D4:2 F4:1 -:1" into [step, midi, dur][] */
function seq(s: string, transpose = 0): [number, number, number][] {
  const out: [number, number, number][] = [];
  let step = 0;
  for (const tok of s.trim().split(/\s+/)) {
    if (tok === '|') continue;
    const [n, d] = tok.split(':');
    const dur = parseFloat(d || '1');
    if (n !== '-') out.push([step, midi(n) + transpose, dur]);
    step += dur;
  }
  return out;
}
function bassLine(roots: string[], stepsPerBar: number, pattern: number[], durs: number[], octaveJumps: number[] = []): [number, number, number][] {
  const out: [number, number, number][] = [];
  roots.forEach((r, bar) => {
    const m = midi(r);
    pattern.forEach((p, i) => out.push([bar * stepsPerBar + p, m + (octaveJumps[i] || 0), durs[i] ?? 1]));
  });
  return out;
}
function chordSeq(chords: string[], stepsPerBar: number): [number, number[], number][] {
  const Q: Record<string, number[]> = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], sus: [0, 5, 7] };
  return chords.map((c, i) => {
    const m = /^([A-G][#b]?)(m7|m|7|sus)?$/.exec(c)!;
    const root = NOTE[m[1]] + 48;
    return [i * stepsPerBar, Q[m[2] || ''].map((x) => root + x), stepsPerBar] as [number, number[], number];
  });
}
function every(n: number, len: number, offset = 0) {
  const a: number[] = [];
  for (let i = offset; i < len; i += n) a.push(i);
  return a;
}
function perBar(steps: number[], stepsPerBar: number, bars: number) {
  const a: number[] = [];
  for (let b = 0; b < bars; b++) for (const s of steps) a.push(b * stepsPerBar + s);
  return a;
}

const TRACKS: Record<Exclude<TrackName, 'none'>, Track> = {
  title: {
    bpm: 78, stepsPerBeat: 2, length: 64, inst: 'flute', inst2: 'brass', leadVol: 0.9,
    lead: seq('A4:4 D5:4 F#5:6 E5:2 D5:4 B4:4 A4:8 G4:4 B4:4 D5:4 E5:2 F#5:2 E5:4 C#5:4 D5:8'),
    lead2: seq('-:32 D4:8 G4:8 D4:8 A3:8'),
    bass: bassLine(['D2', 'D2', 'G2', 'D2', 'G2', 'B1', 'A1', 'D2'], 8, [0, 4], [4, 4]),
    chords: chordSeq(['D', 'D', 'G', 'D', 'G', 'Bm', 'A', 'D'], 8),
    drums: { tom: perBar([0], 8, 8), shaker: every(2, 64, 1) },
  },
  sail: {
    bpm: 132, stepsPerBeat: 3, length: 96, inst: 'accordion', inst2: 'pluck', leadVol: 0.75,
    lead: seq(
      'D5:2 F5:1 A5:2 A5:1 G5:2 F5:1 E5:2 C5:1 D5:2 F5:1 A5:2 D6:1 C6:3 A5:3 ' +
      'Bb5:2 A5:1 G5:2 E5:1 F5:2 E5:1 D5:2 C5:1 D5:2 E5:1 F5:2 E5:1 D5:6 ' +
      'A5:2 A5:1 D6:2 D6:1 C6:2 Bb5:1 A5:3 G5:2 G5:1 C6:2 C6:1 Bb5:2 A5:1 G5:3 ' +
      'F5:2 A5:1 D6:2 F6:1 E6:2 D6:1 C6:2 A5:1 Bb5:2 G5:1 E5:2 C#6:1 D6:6'),
    bass: bassLine(['D2', 'C2', 'D2', 'F2', 'G2', 'C2', 'D2', 'D2', 'D2', 'F2', 'C2', 'G2', 'D2', 'A1', 'A1', 'D2'], 6, [0, 3], [2, 2], [0, 7]),
    chords: chordSeq(['Dm', 'C', 'Dm', 'F', 'Gm', 'C', 'Dm', 'Dm', 'Dm', 'F', 'C', 'Gm', 'Dm', 'Am', 'A', 'Dm'], 6),
    drums: { kick: perBar([0], 6, 16), snare: perBar([3], 6, 16), hat: every(1, 96), shaker: [] },
  },
  explore: {
    bpm: 92, stepsPerBeat: 2, length: 64, inst: 'flute', leadVol: 0.7,
    lead: seq('G4:2 A4:2 B4:4 D5:2 B4:2 A4:4 G4:2 E4:2 D4:4 E4:2 G4:2 A4:4 B4:2 D5:2 E5:4 D5:2 B4:2 A4:2 G4:2 A4:2 B4:2 A4:2 E4:2 G4:8'),
    bass: bassLine(['G2', 'D2', 'E2', 'C2', 'G2', 'B1', 'A1', 'G2'], 8, [0, 3, 6], [3, 3, 2]),
    chords: chordSeq(['G', 'D', 'Em', 'C', 'G', 'Bm', 'Am', 'G'], 8),
    drums: { shaker: every(2, 64, 1), kick: perBar([0], 8, 8) },
  },
  battle: {
    bpm: 152, stepsPerBeat: 2, length: 64, inst: 'square', inst2: 'brass', leadVol: 0.6,
    lead: seq('E5:3 B4:1 E5:2 F#5:2 G5:3 F#5:1 E5:2 D5:2 E5:3 B4:1 E5:2 G5:2 A5:4 G5:2 F#5:2 G5:2 F#5:2 E5:2 C5:2 D5:2 E5:2 F#5:4 E5:2 D5:2 B4:4 D#5:4 F#5:4'),
    lead2: seq('E4:8 C4:8 D4:8 E4:8 C4:8 D4:8 B3:8 B3:8'),
    bass: bassLine(['E2', 'E2', 'C2', 'D2', 'E2', 'E2', 'B1', 'B1'], 8, [0, 1, 2, 3, 4, 5, 6, 7], [1, 1, 1, 1, 1, 1, 1, 1], [0, 0, 12, 0, 0, 12, 0, 12]),
    drums: { kick: perBar([0, 3, 4], 8, 8), snare: perBar([2, 6], 8, 8), hat: every(1, 64) },
  },
  boss: {
    bpm: 166, stepsPerBeat: 2, length: 64, inst: 'brass', inst2: 'square', leadVol: 0.75,
    lead: seq('D4:4 Eb4:2 D4:2 C4:4 D4:4 F4:4 Eb4:2 D4:2 C4:2 Bb3:2 A3:4 D5:2 D5:2 C5:2 D5:2 Eb5:4 D5:4 F5:2 Eb5:2 D5:2 C5:2 A4:8'),
    lead2: seq('-:32 D6:1 -:1 D6:1 -:1 A5:2 Bb5:2 -:24'),
    bass: bassLine(['D2', 'D2', 'D2', 'A1', 'D2', 'Eb2', 'D2', 'A1'], 8, [0, 1, 2, 3, 4, 5, 6, 7], [1, 1, 1, 1, 1, 1, 1, 1], [0, 0, 1, 0, 0, 0, 1, 12]),
    drums: { kick: perBar([0, 2, 3, 4, 6], 8, 8), snare: perBar([2, 6], 8, 8), hat: every(1, 64), tom: [60, 61, 62, 63] },
  },
  awaken: {
    bpm: 132, stepsPerBeat: 2, length: 64, inst: 'bright', inst2: 'brass', leadVol: 0.85,
    lead: seq('D5:2 F#5:2 A5:4 G5:2 F#5:2 E5:4 D5:2 E5:2 F#5:2 A5:2 B5:8 A5:2 F#5:2 D5:4 E5:2 F#5:2 G5:4 F#5:2 E5:2 D5:2 E5:2 D5:8'),
    lead2: seq('D4:8 A3:8 B3:8 G3:8 D4:8 A3:8 G3:8 D4:8'),
    bass: bassLine(['D2', 'A1', 'B1', 'G1', 'D2', 'A1', 'G1', 'D2'], 8, [0, 2, 4, 6], [2, 2, 2, 2], [0, 12, 0, 12]),
    chords: chordSeq(['D', 'A', 'Bm', 'G', 'D', 'A', 'G', 'D'], 8),
    drums: { tom: perBar([0, 2, 4, 7], 8, 8), kick: perBar([0, 4], 8, 8), snare: perBar([6], 8, 8), hat: every(2, 64, 1) },
  },
  ending: {
    bpm: 66, stepsPerBeat: 2, length: 64, inst: 'flute', inst2: 'brass', leadVol: 0.85,
    lead: seq('A4:4 D5:4 F#5:6 E5:2 D5:4 B4:4 A4:8 G4:4 B4:4 D5:4 E5:2 F#5:2 E5:4 C#5:4 D5:8'),
    lead2: seq('F#4:16 D4:16 G4:8 A4:8 F#4:16'),
    bass: bassLine(['D2', 'D2', 'G2', 'D2', 'G2', 'B1', 'A1', 'D2'], 8, [0], [8]),
    chords: chordSeq(['D', 'D', 'G', 'D', 'G', 'Bm', 'A', 'D'], 8),
    drums: { shaker: every(4, 64, 2) },
  },
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicGain!: GainNode;
  sfxGain!: GainNode;
  ambGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private oceanGain!: GainNode;
  private windGain!: GainNode;
  private rainGain!: GainNode;
  private musicBus!: GainNode;
  private trackGains = new Map<TrackName, GainNode>();
  private current: TrackName = 'none';
  private nextStepTime = 0;
  private step = 0;
  private trackStart = 0;
  listener = new THREE.Vector3();
  listenerRight = new THREE.Vector3(1, 0, 0);
  volumes = { master: 0.8, music: 0.55, sfx: 0.9 };
  private lastPlayed = new Map<string, number>();
  private comp!: DynamicsCompressorNode;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.connect(this.comp).connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.ambGain = ctx.createGain();
    this.musicGain.connect(this.master);
    this.sfxGain.connect(this.master);
    this.ambGain.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.musicGain);
    this.applyVolumes();

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Ambience: ocean (brown-ish noise, slow swell), wind (band noise), rain.
    this.oceanGain = this.loopNoise(380, 'lowpass', 0.0);
    this.windGain = this.loopNoise(900, 'bandpass', 0.0, 0.6);
    this.rainGain = this.loopNoise(5000, 'highpass', 0.0);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.12;
    lfo.connect(lfoGain).connect(this.oceanGain.gain);
    lfo.start();
    this.scheduler();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.musicGain.gain.value = this.volumes.music * 0.5;
    this.sfxGain.gain.value = this.volumes.sfx;
    this.ambGain.gain.value = this.volumes.sfx * 0.8;
  }

  private loopNoise(freq: number, type: BiquadFilterType, vol: number, q = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.ambGain);
    src.start();
    return g;
  }

  setAmbience(ocean: number, wind: number, rain: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.oceanGain.gain.setTargetAtTime(ocean * 0.5, t, 0.8);
    this.windGain.gain.setTargetAtTime(wind * 0.18, t, 0.8);
    this.rainGain.gain.setTargetAtTime(rain * 0.12, t, 0.8);
  }

  // ---------------------------------------------------------------- music
  playMusic(name: TrackName, fade = 1.5) {
    if (!this.ctx || name === this.current) return;
    const t = this.ctx.currentTime;
    const old = this.trackGains.get(this.current);
    if (old) {
      old.gain.cancelScheduledValues(t);
      old.gain.setValueAtTime(old.gain.value, t);
      old.gain.linearRampToValueAtTime(0, t + fade);
      setTimeout(() => old.disconnect(), (fade + 0.2) * 1000);
    }
    this.current = name;
    if (name === 'none') return;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + fade * 0.7);
    g.connect(this.musicBus);
    this.trackGains.set(name, g);
    this.step = 0;
    this.nextStepTime = t + 0.08;
    this.trackStart = this.nextStepTime;
  }
  get currentTrack() { return this.current; }

  private scheduler() {
    const tick = () => {
      if (this.ctx && this.current !== 'none') {
        const tr = TRACKS[this.current as Exclude<TrackName, 'none'>];
        const stepDur = 60 / tr.bpm / tr.stepsPerBeat;
        const out = this.trackGains.get(this.current)!;
        while (this.nextStepTime < this.ctx.currentTime + 0.15) {
          this.playStep(tr, this.step, this.nextStepTime, stepDur, out);
          this.step = (this.step + 1) % tr.length;
          this.nextStepTime += stepDur;
        }
      }
      setTimeout(tick, 40);
    };
    tick();
  }

  private playStep(tr: Track, step: number, time: number, sd: number, out: GainNode) {
    for (const [s, m, d] of tr.lead) if (s === step) this.note(tr.inst, mtof(m), time, d * sd, 0.16 * (tr.leadVol ?? 1), out);
    if (tr.lead2) for (const [s, m, d] of tr.lead2) if (s === step) this.note(tr.inst2 || 'brass', mtof(m), time, d * sd, 0.09, out);
    for (const [s, m, d] of tr.bass) if (s === step) this.bass(mtof(m), time, d * sd * 0.95, out);
    if (tr.chords) for (const [s, ns, d] of tr.chords) if (s === step) for (const n of ns) this.pad(mtof(n), time, d * sd, out);
    const dr = tr.drums;
    if (dr.kick?.includes(step)) this.kick(time, out);
    if (dr.snare?.includes(step)) this.snare(time, out);
    if (dr.hat?.includes(step)) this.hat(time, out, step % 2 === 0 ? 0.05 : 0.03);
    if (dr.tom?.includes(step)) this.tom(time, out);
    if (dr.shaker?.includes(step)) this.hat(time, out, 0.025, 0.06);
  }

  private note(inst: Inst, f: number, t: number, dur: number, vol: number, out: AudioNode) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    const oscs: OscillatorNode[] = [];
    const mk = (type: OscillatorType, freq: number, det = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(filt);
      oscs.push(o);
      return o;
    };
    let atk = 0.01, rel = 0.08, sus = 1;
    switch (inst) {
      case 'accordion': {
        mk('square', f, -8); mk('square', f, 8); mk('sawtooth', f / 2, 0);
        filt.frequency.value = 2200;
        atk = 0.02; vol *= 0.55;
        // tremolo
        const lfo = ctx.createOscillator(); lfo.frequency.value = 6; const lg = ctx.createGain(); lg.gain.value = vol * 0.25;
        lfo.connect(lg).connect(g.gain); lfo.start(t); lfo.stop(t + dur + 0.2);
        break;
      }
      case 'square': mk('square', f); mk('square', f * 2, 5); filt.frequency.value = 3000; vol *= 0.45; break;
      case 'brass': mk('sawtooth', f, -6); mk('sawtooth', f, 6); filt.frequency.value = 1400; atk = 0.04; vol *= 0.6; break;
      case 'bright': mk('sawtooth', f, -10); mk('sawtooth', f, 10); mk('square', f * 2); filt.frequency.value = 4200; atk = 0.02; vol *= 0.45; break;
      case 'flute': {
        const o = mk('triangle', f); mk('sine', f * 2).detune.value = 3;
        filt.frequency.value = 5000; atk = 0.06; rel = 0.2; vol *= 1.1;
        const vib = ctx.createOscillator(); vib.frequency.value = 5.2; const vg = ctx.createGain(); vg.gain.value = f * 0.008;
        vib.connect(vg).connect(o.frequency); vib.start(t); vib.stop(t + dur + 0.4);
        break;
      }
      case 'pluck': mk('triangle', f); filt.frequency.value = 2500; sus = 0.2; rel = 0.05; break;
    }
    filt.connect(g).connect(out);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + atk);
    g.gain.setTargetAtTime(vol * sus, t + atk, Math.max(0.03, dur * 0.3));
    g.gain.setValueAtTime(vol * sus, t + Math.max(atk, dur - 0.02));
    g.gain.linearRampToValueAtTime(0, t + dur + rel);
    for (const o of oscs) { o.start(t); o.stop(t + dur + rel + 0.05); }
  }

  private bass(f: number, t: number, dur: number, out: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 500;
    const g = ctx.createGain();
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(filt); o2.connect(g2).connect(filt); filt.connect(g).connect(out);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.01);
    g.gain.setTargetAtTime(0.12, t + 0.02, 0.1);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }

  private pad(f: number, t: number, dur: number, out: AudioNode) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 900;
    const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = f; a.detune.value = -7;
    const b = ctx.createOscillator(); b.type = 'sawtooth'; b.frequency.value = f; b.detune.value = 7;
    a.connect(filt); b.connect(filt); filt.connect(g).connect(out);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.022, t + Math.min(0.4, dur * 0.3));
    g.gain.setValueAtTime(0.022, t + dur * 0.85);
    g.gain.linearRampToValueAtTime(0, t + dur);
    a.start(t); b.start(t); a.stop(t + dur + 0.05); b.stop(t + dur + 0.05);
  }

  private kick(t: number, out: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.3);
  }
  private tom(t: number, out: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.35);
    g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.65);
    this.noiseHit(t, 0.12, 800, 'lowpass', 0.15, out);
  }
  private snare(t: number, out: AudioNode) {
    this.noiseHit(t, 0.16, 1800, 'bandpass', 0.22, out);
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = 190;
    g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.12);
  }
  private hat(t: number, out: AudioNode, vol = 0.05, dur = 0.04) {
    this.noiseHit(t, dur, 7500, 'highpass', vol, out);
  }
  private noiseHit(t: number, dur: number, freq: number, type: BiquadFilterType, vol: number, out: AudioNode, q = 1, freqEnd?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, out: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------ sfx
  /** Returns a destination node attenuated/panned for a world position. */
  private spatial(pos?: THREE.Vector3, range = 90): AudioNode | null {
    if (!this.ctx) return null;
    if (!pos) return this.sfxGain;
    const d = pos.distanceTo(this.listener);
    const vol = 1 / (1 + Math.pow(d / range, 2));
    if (vol < 0.02) return null;
    const g = this.ctx.createGain(); g.gain.value = vol;
    const p = this.ctx.createStereoPanner();
    const dx = pos.clone().sub(this.listener).normalize().dot(this.listenerRight);
    p.pan.value = Math.max(-0.8, Math.min(0.8, dx));
    g.connect(p).connect(this.sfxGain);
    setTimeout(() => { g.disconnect(); p.disconnect(); }, 4000);
    return g;
  }
  private throttle(key: string, ms: number) {
    const now = performance.now();
    if ((this.lastPlayed.get(key) || 0) + ms > now) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  sfx(name: string, pos?: THREE.Vector3, intensity = 1) {
    if (!this.ctx || !this.throttle(name + (pos ? Math.round(pos.x / 5) : ''), 30)) return;
    const out = this.spatial(pos, name === 'cannon' || name === 'explosion' || name === 'roar' || name === 'thunder' ? 260 : 90);
    if (!out) return;
    const t = this.ctx.currentTime;
    const I = intensity;
    switch (name) {
      case 'cannon':
        this.tone(t, 'sine', 120, 35, 0.5, 0.9 * I, out);
        this.noiseHit(t, 0.6, 1200, 'lowpass', 0.8 * I, out, 1, 200);
        break;
      case 'explosion':
        this.tone(t, 'sine', 90, 25, 0.8, 0.9 * I, out);
        this.noiseHit(t, 1.1, 2400, 'lowpass', 0.9 * I, out, 0.7, 120);
        break;
      case 'splash':
        this.noiseHit(t, 0.5, 2500, 'bandpass', 0.35 * I, out, 0.6, 600);
        this.noiseHit(t + 0.05, 0.7, 600, 'lowpass', 0.25 * I, out);
        break;
      case 'punch':
        this.tone(t, 'sine', 180, 60, 0.12, 0.5 * I, out);
        this.noiseHit(t, 0.08, 1500, 'lowpass', 0.4 * I, out);
        break;
      case 'hit':
        this.tone(t, 'square', 220, 90, 0.09, 0.2 * I, out);
        this.noiseHit(t, 0.12, 3000, 'bandpass', 0.35 * I, out);
        break;
      case 'whoosh':
        this.noiseHit(t, 0.22, 600, 'bandpass', 0.3 * I, out, 2, 3000);
        break;
      case 'slash':
        this.noiseHit(t, 0.18, 5000, 'bandpass', 0.35 * I, out, 3, 1500);
        this.tone(t, 'sawtooth', 1800, 900, 0.12, 0.06 * I, out);
        break;
      case 'clang':
        this.tone(t, 'square', 900, 850, 0.25, 0.12 * I, out);
        this.tone(t, 'sine', 1430, 1400, 0.4, 0.12 * I, out);
        this.noiseHit(t, 0.05, 6000, 'highpass', 0.3 * I, out);
        break;
      case 'fire':
        this.noiseHit(t, 0.6, 900, 'lowpass', 0.6 * I, out, 0.5, 300);
        this.noiseHit(t, 0.4, 3000, 'bandpass', 0.2 * I, out, 1, 1200);
        this.tone(t, 'sawtooth', 160, 60, 0.4, 0.12 * I, out);
        break;
      case 'stretch':
        this.tone(t, 'sine', 300, 900, 0.18, 0.35 * I, out);
        this.tone(t + 0.12, 'sine', 900, 200, 0.2, 0.3 * I, out);
        break;
      case 'boing':
        this.tone(t, 'sine', 200, 600, 0.12, 0.3 * I, out);
        this.tone(t + 0.1, 'triangle', 600, 180, 0.25, 0.25 * I, out);
        break;
      case 'thunder':
        this.noiseHit(t, 0.12, 6000, 'highpass', 0.9 * I, out);
        this.noiseHit(t + 0.05, 1.4, 900, 'lowpass', 0.8 * I, out, 0.5, 80);
        this.tone(t, 'sawtooth', 2000, 100, 0.15, 0.15 * I, out);
        break;
      case 'zap':
        this.tone(t, 'sawtooth', 1600, 200, 0.18, 0.15 * I, out);
        this.noiseHit(t, 0.15, 4000, 'highpass', 0.4 * I, out);
        break;
      case 'ice':
        this.tone(t, 'sine', 2400, 1800, 0.35, 0.15 * I, out);
        this.tone(t, 'sine', 3200, 2900, 0.4, 0.1 * I, out);
        this.noiseHit(t, 0.25, 6000, 'highpass', 0.3 * I, out);
        break;
      case 'shatter':
        for (let i = 0; i < 5; i++) this.tone(t + i * 0.03, 'sine', 2000 + Math.random() * 3000, 1500, 0.2, 0.08 * I, out);
        this.noiseHit(t, 0.4, 5000, 'highpass', 0.5 * I, out);
        break;
      case 'quake':
        this.tone(t, 'sine', 55, 30, 1.0, 0.9 * I, out);
        this.noiseHit(t, 1.2, 300, 'lowpass', 0.9 * I, out, 0.5, 60);
        this.noiseHit(t + 0.05, 0.3, 4000, 'bandpass', 0.25 * I, out);
        break;
      case 'glass':
        this.tone(t, 'sine', 1200, 1200, 0.6, 0.1 * I, out);
        this.noiseHit(t, 0.5, 6000, 'highpass', 0.6 * I, out);
        break;
      case 'coin':
        this.tone(t, 'square', 988, 988, 0.08, 0.08, out);
        this.tone(t + 0.07, 'square', 1319, 1319, 0.2, 0.08, out);
        break;
      case 'chest':
        this.tone(t, 'sawtooth', 120, 80, 0.3, 0.12, out);
        [523, 659, 784, 1047].forEach((f, i) => this.tone(t + 0.25 + i * 0.07, 'triangle', f, f, 0.35, 0.12, out));
        break;
      case 'levelup':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(t + i * 0.08, 'square', f, f, 0.3, 0.07, out));
        break;
      case 'ui':
        this.tone(t, 'triangle', 660, 660, 0.06, 0.12, out);
        break;
      case 'uiback':
        this.tone(t, 'triangle', 440, 330, 0.08, 0.12, out);
        break;
      case 'hurt':
        this.tone(t, 'sawtooth', 300, 120, 0.2, 0.15, out);
        this.noiseHit(t, 0.12, 1200, 'lowpass', 0.4, out);
        break;
      case 'roar':
        this.tone(t, 'sawtooth', 160, 60, 1.4, 0.4 * I, out);
        this.tone(t, 'square', 110, 50, 1.4, 0.2 * I, out);
        this.noiseHit(t, 1.4, 700, 'bandpass', 0.6 * I, out, 0.8, 200);
        break;
      case 'gong':
        this.tone(t, 'sine', 110, 104, 3, 0.5, out);
        this.tone(t, 'sine', 247, 240, 2.5, 0.2, out);
        this.tone(t, 'sine', 410, 400, 2, 0.12, out);
        this.noiseHit(t, 0.2, 2000, 'bandpass', 0.3, out);
        break;
      case 'heartbeat':
        this.tone(t, 'sine', 70, 40, 0.18, 0.9, out);
        this.tone(t + 0.22, 'sine', 65, 38, 0.22, 0.7, out);
        break;
      case 'drum':
        this.tone(t, 'sine', 120, 50, 0.5, 0.9, out);
        this.noiseHit(t, 0.12, 600, 'lowpass', 0.3, out);
        break;
      case 'power':
        this.tone(t, 'sawtooth', 100, 800, 1.2, 0.25 * I, out);
        this.tone(t, 'square', 50, 400, 1.2, 0.15 * I, out);
        this.noiseHit(t, 1.2, 400, 'bandpass', 0.4 * I, out, 1, 4000);
        break;
      case 'eat':
        this.noiseHit(t, 0.1, 2000, 'bandpass', 0.4, out);
        this.noiseHit(t + 0.25, 0.1, 1800, 'bandpass', 0.4, out);
        this.noiseHit(t + 0.5, 0.1, 2200, 'bandpass', 0.4, out);
        this.tone(t + 0.8, 'sawtooth', 200, 50, 0.6, 0.15, out);
        break;
      case 'creak':
        this.tone(t, 'sawtooth', 90 + Math.random() * 30, 70, 0.5, 0.04, out);
        break;
      case 'bell':
        this.tone(t, 'sine', 880, 880, 1.6, 0.18, out);
        this.tone(t, 'sine', 1760, 1760, 1.0, 0.06, out);
        break;
      case 'musket':
        this.noiseHit(t, 0.2, 3000, 'lowpass', 0.6 * I, out, 1, 400);
        this.tone(t, 'square', 400, 80, 0.1, 0.15 * I, out);
        break;
      case 'heal':
        [440, 554, 659, 880].forEach((f, i) => this.tone(t + i * 0.06, 'sine', f, f * 1.01, 0.4, 0.1, out));
        break;
      case 'dash':
        this.noiseHit(t, 0.25, 800, 'bandpass', 0.35, out, 1.5, 4000);
        break;
      case 'jump':
        this.tone(t, 'sine', 220, 330, 0.1, 0.08, out);
        break;
      case 'land':
        this.noiseHit(t, 0.1, 400, 'lowpass', 0.25, out);
        break;
      case 'step':
        this.noiseHit(t, 0.05, 900, 'lowpass', 0.06, out);
        break;
    }
  }
}
