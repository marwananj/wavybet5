import { useEffect, useState } from 'react';

/**
 * Casino sound effects — synthesised live with the Web Audio API (no audio files to download).
 * Browsers only allow audio after a user gesture; every effect is triggered from a click, so
 * the context is created/resumed lazily on first use. Mute state is remembered per browser.
 */

const KEY = 'wb_casino_muted';
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<(m: boolean) => void>();

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function ac(): AudioContext | null {
  if (muted || typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

function noise(c: AudioContext) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

interface ToneOpts {
  freq: number;
  to?: number; // pitch slide target
  type?: OscillatorType;
  dur?: number;
  vol?: number;
  attack?: number;
  delay?: number;
}
function tone({ freq, to, type = 'sine', dur = 0.15, vol = 0.3, attack = 0.005, delay = 0 }: ToneOpts) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

interface NoiseOpts {
  dur?: number;
  vol?: number;
  freq?: number;
  q?: number;
  type?: BiquadFilterType;
  delay?: number;
  attack?: number;
}
function burst({ dur = 0.08, vol = 0.3, freq = 3000, q = 1, type = 'bandpass', delay = 0, attack = 0.002 }: NoiseOpts) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + delay;
  const s = c.createBufferSource();
  s.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f);
  f.connect(g);
  g.connect(master);
  s.start(t, Math.random());
  s.stop(t + dur + 0.05);
}

const arp = (notes: number[], step: number, o: Partial<ToneOpts> = {}) =>
  notes.forEach((f, i) => tone({ dur: 0.22, vol: 0.18, type: 'triangle', ...o, freq: f, delay: (o.delay ?? 0) + i * step }));

export const sfx = {
  click: () => tone({ freq: 900, type: 'square', dur: 0.03, vol: 0.06 }),
  bet: () => (burst({ freq: 2400, q: 3, dur: 0.05, vol: 0.25 }), tone({ freq: 520, to: 780, type: 'triangle', dur: 0.09, vol: 0.12 })),
  chip: () => {
    burst({ freq: 5200, q: 6, dur: 0.035, vol: 0.35 });
    burst({ freq: 4200, q: 8, dur: 0.03, vol: 0.25, delay: 0.045 });
  },
  tick: (pitch = 1) => (burst({ freq: 3500 * pitch, q: 4, dur: 0.025, vol: 0.28 }), tone({ freq: 1400 * pitch, type: 'square', dur: 0.015, vol: 0.04 })),
  deal: (delay = 0) => burst({ freq: 1800, q: 0.7, dur: 0.12, vol: 0.22, type: 'bandpass', delay, attack: 0.02 }),
  flip: (delay = 0) => (burst({ freq: 2600, q: 1.2, dur: 0.06, vol: 0.25, delay }), tone({ freq: 300, type: 'triangle', dur: 0.05, vol: 0.08, delay })),
  dice: () => {
    for (let i = 0; i < 7; i++) burst({ freq: 1800 + Math.random() * 2400, q: 5, dur: 0.035, vol: 0.28 - i * 0.03, delay: i * 0.06 + Math.random() * 0.03 });
  },
  coin: () => {
    tone({ freq: 2093, type: 'sine', dur: 0.5, vol: 0.12 });
    tone({ freq: 3136, type: 'sine', dur: 0.35, vol: 0.06, delay: 0.01 });
  },
  whoosh: (dur = 0.5) => burst({ freq: 900, q: 0.6, dur, vol: 0.2, type: 'bandpass', attack: dur * 0.4 }),
  hop: () => tone({ freq: 380, to: 760, type: 'triangle', dur: 0.12, vol: 0.16 }),
  gem: () => arp([1318, 1760, 2637], 0.05, { dur: 0.25, vol: 0.12, type: 'sine' }),
  step: (level = 0) => arp([523 * 2 ** (level / 12), 659 * 2 ** (level / 12)], 0.06, { vol: 0.14 }),
  bomb: () => {
    burst({ freq: 180, q: 0.5, dur: 0.7, vol: 0.9, type: 'lowpass', attack: 0.005 });
    tone({ freq: 120, to: 35, type: 'sine', dur: 0.6, vol: 0.5 });
  },
  crash: () => {
    burst({ freq: 900, q: 0.4, dur: 0.45, vol: 0.6, type: 'lowpass' });
    tone({ freq: 90, to: 40, type: 'square', dur: 0.3, vol: 0.2 });
    for (let i = 0; i < 5; i++) burst({ freq: 3000 + i * 800, q: 6, dur: 0.05, vol: 0.2, delay: 0.05 + i * 0.05 });
  },
  lose: () => (tone({ freq: 330, to: 196, type: 'triangle', dur: 0.35, vol: 0.16 }), tone({ freq: 247, to: 147, type: 'triangle', dur: 0.4, vol: 0.12, delay: 0.12 })),
  win: () => arp([523, 659, 784, 1047], 0.075),
  bigWin: () => {
    arp([523, 659, 784, 1047, 1319, 1568], 0.07, { vol: 0.2 });
    arp([1047, 1319, 1568, 2093], 0.09, { vol: 0.1, type: 'sine', delay: 0.45 });
    for (let i = 0; i < 10; i++) tone({ freq: 2000 + Math.random() * 2500, dur: 0.3, vol: 0.05, delay: 0.3 + i * 0.07 });
  },
  cashout: () => {
    for (let i = 0; i < 6; i++) burst({ freq: 4500 + Math.random() * 1500, q: 7, dur: 0.04, vol: 0.2, delay: i * 0.05 });
    arp([784, 1047, 1319], 0.08, { delay: 0.25 });
  },
  /** ball dropping into a pocket / hitting a fret */
  /** ball clipping a metal fret between pockets */
  fret: (v = 1) => {
    burst({ freq: 4600, q: 9, dur: 0.022, vol: 0.28 * v });
    tone({ freq: 2900 + Math.random() * 500, type: 'sine', dur: 0.025, vol: 0.05 * v });
  },
  /** ball striking a diamond deflector on the bowl */
  diamond: () => {
    burst({ freq: 1500, q: 2.5, dur: 0.06, vol: 0.55 });
    tone({ freq: 680, to: 430, type: 'sine', dur: 0.09, vol: 0.18 });
  },
  /** ball dropping into its pocket for good */
  settle: () => {
    burst({ freq: 2200, q: 3, dur: 0.05, vol: 0.45 });
    tone({ freq: 900, to: 600, type: 'sine', dur: 0.08, vol: 0.12 });
    burst({ freq: 2800, q: 5, dur: 0.03, vol: 0.2, delay: 0.16 });
    burst({ freq: 3000, q: 6, dur: 0.02, vol: 0.1, delay: 0.27 });
  },
  /** slot reel landing */
  reelStop: (i = 0) => {
    burst({ freq: 260, q: 0.7, dur: 0.09, vol: 0.45, type: 'lowpass' });
    tone({ freq: 180 - i * 8, to: 110, type: 'triangle', dur: 0.08, vol: 0.18 });
    burst({ freq: 3200, q: 4, dur: 0.02, vol: 0.12, delay: 0.01 });
  },
  /** scatter symbol lands */
  scatter: (n = 1) => arp([880 * 2 ** ((n - 1) / 6), 1320 * 2 ** ((n - 1) / 6), 1760 * 2 ** ((n - 1) / 6)], 0.05, { dur: 0.25, vol: 0.14, type: 'sine' }),
  /** anticipation build-up before the last reels */
  anticipate: () => tone({ freq: 300, to: 900, type: 'sawtooth', dur: 1.1, vol: 0.05 }),
  /** reels start */
  reelStart: () => {
    for (let i = 0; i < 5; i++) burst({ freq: 1800 + i * 150, q: 3, dur: 0.03, vol: 0.1, delay: i * 0.04 });
  },
  /** a line win counting up */
  lineWin: () => arp([1047, 1319], 0.06, { dur: 0.12, vol: 0.1, type: 'square' }),
  /** free spins trigger fanfare */
  fanfare: () => {
    arp([523, 659, 784, 1047, 784, 1047, 1319], 0.09, { vol: 0.2 });
    arp([262, 330, 392, 523], 0.18, { vol: 0.12, type: 'triangle', delay: 0.1 });
  },
  /** riffle shuffle of a deck */
  riffle: (delay = 0) => {
    for (let i = 0; i < 26; i++) burst({ freq: 2600 + Math.random() * 1800, q: 4, dur: 0.018, vol: 0.12 + Math.random() * 0.08, delay: delay + i * 0.022 });
    burst({ freq: 900, q: 1, dur: 0.12, vol: 0.2, delay: delay + 0.62 });
  },
  bounce: (v = 1) => (burst({ freq: 3800, q: 5, dur: 0.03, vol: 0.35 * v }), tone({ freq: 1900, type: 'sine', dur: 0.03, vol: 0.06 * v })),
  clack: () => {
    burst({ freq: 2600, q: 3, dur: 0.05, vol: 0.5 });
    burst({ freq: 1200, q: 2, dur: 0.08, vol: 0.3, delay: 0.02 });
  },
  /** lightning strike: sharp crack + rolling rumble */
  thunder: () => {
    burst({ freq: 5200, q: 0.8, dur: 0.09, vol: 0.55, type: 'highpass' });
    for (let i = 0; i < 6; i++) burst({ freq: 2500 + Math.random() * 3000, q: 3, dur: 0.03, vol: 0.3, delay: 0.02 + i * 0.03 + Math.random() * 0.02 });
    burst({ freq: 140, q: 0.4, dur: 1.4, vol: 0.8, type: 'lowpass', delay: 0.05, attack: 0.08 });
    tone({ freq: 70, to: 38, type: 'sine', dur: 1.1, vol: 0.35, delay: 0.05 });
  },
  /** stadium goal: crowd roar swelling, air horn and the announcer */
  goal: () => {
    // roar
    burst({ freq: 900, q: 0.5, dur: 3.2, vol: 0.55, type: 'bandpass', attack: 0.35 });
    burst({ freq: 2200, q: 0.7, dur: 2.6, vol: 0.25, type: 'bandpass', attack: 0.3, delay: 0.1 });
    // horn chord
    [233, 293, 349].forEach((f, i) => tone({ freq: f, type: 'sawtooth', dur: 1.2, vol: 0.07, attack: 0.03, delay: 0.05 + i * 0.01 }));
    [233, 293, 349].forEach((f) => tone({ freq: f, type: 'sawtooth', dur: 0.9, vol: 0.06, attack: 0.03, delay: 1.35 }));
    // claps
    for (let i = 0; i < 14; i++) burst({ freq: 2500 + Math.random() * 1500, q: 2, dur: 0.03, vol: 0.12, delay: 0.6 + i * 0.13 + Math.random() * 0.05 });
    speak('Gooooooaaal!', { rate: 0.62, pitch: 1.25 });
  },
  whistle: () => {
    tone({ freq: 2800, to: 2700, type: 'sine', dur: 0.35, vol: 0.12 });
    tone({ freq: 2800, to: 2650, type: 'sine', dur: 0.7, vol: 0.12, delay: 0.45 });
  },
  /** starting bell */
  bell: () => {
    for (let i = 0; i < 6; i++) {
      tone({ freq: 1568, type: 'square', dur: 0.08, vol: 0.07, delay: i * 0.1 });
      tone({ freq: 2093, type: 'sine', dur: 0.12, vol: 0.08, delay: i * 0.1 + 0.01 });
    }
  },
  gates: () => {
    burst({ freq: 1600, q: 2, dur: 0.12, vol: 0.5 });
    burst({ freq: 400, q: 1, dur: 0.25, vol: 0.4, type: 'lowpass', delay: 0.02 });
  },
  pointer: () => burst({ freq: 5000, q: 8, dur: 0.02, vol: 0.18 }),
};

/**
 * Continuous rolling sound (roulette ball in the track): filtered noise whose pitch/volume follow `speed` 0‥1.
 * Returns a controller; call `set(speed)` every frame and `stop()` at the end.
 */
export function rollLoop() {
  const c = ac();
  if (!c || !master) return { set: (_s: number) => {}, stop: () => {} };
  const out = master;
  // A: the ball's whirr on the polished track (band-passed noise)
  const nA = c.createBufferSource();
  nA.buffer = noise(c);
  nA.loop = true;
  const fA = c.createBiquadFilter();
  fA.type = 'bandpass';
  fA.Q.value = 2.2;
  const gA = c.createGain();
  gA.gain.value = 0.0001;
  nA.connect(fA);
  fA.connect(gA);
  gA.connect(out);
  // B: low wooden rumble with a once-per-lap swell (tremolo)
  const nB = c.createBufferSource();
  nB.buffer = noise(c);
  nB.loop = true;
  const fB = c.createBiquadFilter();
  fB.type = 'lowpass';
  fB.frequency.value = 260;
  const gB = c.createGain();
  gB.gain.value = 0.0001;
  const trem = c.createGain();
  trem.gain.value = 0.6;
  const lfo = c.createOscillator();
  lfo.frequency.value = 2;
  const lfoDepth = c.createGain();
  lfoDepth.gain.value = 0.4;
  lfo.connect(lfoDepth);
  lfoDepth.connect(trem.gain);
  nB.connect(fB);
  fB.connect(trem);
  trem.connect(gB);
  gB.connect(out);
  // C: faint ceramic ring of the ball
  const ring = c.createOscillator();
  ring.type = 'sine';
  const gC = c.createGain();
  gC.gain.value = 0.0001;
  ring.connect(gC);
  gC.connect(out);
  nA.start(0, Math.random());
  nB.start(0, Math.random());
  lfo.start();
  ring.start();
  let stopped = false;
  return {
    set(speed: number) {
      if (stopped) return;
      const t = c.currentTime;
      const x = Math.max(0, Math.min(1, speed));
      fA.frequency.setTargetAtTime(700 + x * 2600, t, 0.08);
      gA.gain.setTargetAtTime(0.015 + x * 0.12, t, 0.08);
      gB.gain.setTargetAtTime(0.05 + x * 0.22, t, 0.08);
      lfo.frequency.setTargetAtTime(0.6 + x * 3.4, t, 0.1); // laps per second
      ring.frequency.setTargetAtTime(1500 + x * 900, t, 0.1);
      gC.gain.setTargetAtTime(0.002 + x * 0.008, t, 0.1);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const t = c.currentTime;
      for (const g of [gA, gB, gC]) g.gain.setTargetAtTime(0.0001, t, 0.06);
      for (const n of [nA, nB, lfo, ring]) n.stop(t + 0.4);
    },
  };
}

/**
 * Race-day atmosphere: galloping hooves (scheduled thumps) + crowd (filtered noise).
 * `set(gallop 0‥1, crowd 0‥1)` every frame; `stop()` at the end.
 */
export function raceAmbience() {
  const c = ac();
  if (!c || !master) return { set: (_g: number, _c: number) => {}, stop: () => {} };
  const out = master;
  // crowd
  const src = c.createBufferSource();
  src.buffer = noise(c);
  src.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  bp.Q.value = 0.5;
  const cg = c.createGain();
  cg.gain.value = 0.0001;
  src.connect(bp);
  bp.connect(cg);
  cg.connect(out);
  src.start();
  // hooves
  let gallop = 0;
  let stopped = false;
  let nextBeat = c.currentTime + 0.05;
  const thump = (t: number, v: number) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(95 + Math.random() * 30, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.12);
    const n = c.createBufferSource();
    n.buffer = noise(c);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(v * 0.6, t + 0.003);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(f);
    f.connect(ng);
    ng.connect(out);
    n.start(t, Math.random());
    n.stop(t + 0.07);
  };
  const timer = window.setInterval(() => {
    if (stopped || gallop < 0.05) return;
    const now = c.currentTime;
    // 4-beat gallop pattern, many horses → slightly smeared
    while (nextBeat < now + 0.25) {
      const stride = 0.46 - gallop * 0.12;
      [0, 0.07, 0.19, 0.26].forEach((o, i) => thump(nextBeat + o + Math.random() * 0.015, (0.07 + gallop * 0.1) * (i % 2 ? 0.8 : 1)));
      nextBeat += stride;
    }
  }, 90);
  return {
    set(g: number, crowd: number) {
      if (stopped) return;
      gallop = Math.max(0, Math.min(1, g));
      if (gallop > 0.05 && nextBeat < c.currentTime) nextBeat = c.currentTime + 0.02;
      const t = c.currentTime;
      cg.gain.setTargetAtTime(0.012 + Math.max(0, Math.min(1, crowd)) * 0.2, t, 0.3);
      bp.frequency.setTargetAtTime(700 + crowd * 900, t, 0.3);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      cg.gain.setTargetAtTime(0.0001, c.currentTime, 0.6);
      src.stop(c.currentTime + 2.5);
    },
  };
}

export const isMuted = () => muted;

/** Browser speech (commentary, goal call). Silent when muted or unsupported. */
export function speak(text: string, o: { rate?: number; pitch?: number; interrupt?: boolean } = {}) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth || muted) return;
  try {
    if (o.interrupt !== false) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const v = voices.find((x) => /en-GB/i.test(x.lang)) ?? voices.find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v;
    u.rate = o.rate ?? 1;
    u.pitch = o.pitch ?? 1;
    synth.speak(u);
  } catch {
    /* ignore */
  }
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? '1' : '0');
  } catch {
    /* private mode */
  }
  if (m && ctx) ctx.suspend().catch(() => {});
  if (m && typeof window !== 'undefined') window.speechSynthesis?.cancel();
  listeners.forEach((l) => l(m));
}

export function useMuted(): [boolean, (m: boolean) => void] {
  const [m, setM] = useState(muted);
  useEffect(() => {
    listeners.add(setM);
    return () => void listeners.delete(setM);
  }, []);
  return [m, setMuted];
}

/** win/lose jingle based on the result multiplier */
export function resultSound(multiplier: number) {
  if (multiplier >= 10) sfx.bigWin();
  else if (multiplier > 1) sfx.win();
  else if (multiplier === 1) sfx.coin();
  else sfx.lose();
}

/**
 * Burning fuse: hissing sparks (high band-passed noise with random crackle) + a heartbeat
 * tick that speeds up with the tension. `set(tension 0‥1)` every frame, `stop()` at the end.
 */
export function fuseLoop() {
  const c = ac();
  if (!c || !master) return { set: (_t: number) => {}, stop: () => {} };
  const out = master;
  const n = c.createBufferSource();
  n.buffer = noise(c);
  n.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 5200;
  f.Q.value = 1.4;
  const g = c.createGain();
  g.gain.value = 0.0001;
  n.connect(f);
  f.connect(g);
  g.connect(out);
  n.start(0, Math.random());
  let stopped = false;
  let tension = 0;
  let nextTick = c.currentTime + 0.3;
  const timer = window.setInterval(() => {
    if (stopped) return;
    const t = c.currentTime;
    // crackle
    if (Math.random() < 0.55) burst({ freq: 3500 + Math.random() * 4000, q: 5, dur: 0.012 + Math.random() * 0.02, vol: 0.05 + tension * 0.12 });
    // heartbeat tick, faster as the multiplier climbs
    if (t >= nextTick) {
      tone({ freq: 880 + tension * 500, type: 'square', dur: 0.03, vol: 0.035 + tension * 0.05 });
      nextTick = t + Math.max(0.16, 0.8 - tension * 0.64);
    }
  }, 45);
  return {
    set(x: number) {
      if (stopped) return;
      tension = Math.max(0, Math.min(1, x));
      const t = c.currentTime;
      g.gain.setTargetAtTime(0.03 + tension * 0.09, t, 0.1);
      f.frequency.setTargetAtTime(4200 + tension * 2800, t, 0.2);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      window.clearInterval(timer);
      const t = c.currentTime;
      g.gain.setTargetAtTime(0.0001, t, 0.04);
      n.stop(t + 0.3);
    },
  };
}

/** big cinematic explosion */
export function explosion() {
  burst({ freq: 5200, q: 0.7, dur: 0.12, vol: 0.7, type: 'highpass' });
  burst({ freq: 320, q: 0.4, dur: 1.6, vol: 1, type: 'lowpass', attack: 0.004 });
  tone({ freq: 95, to: 28, type: 'sine', dur: 1.2, vol: 0.7 });
  tone({ freq: 60, to: 22, type: 'triangle', dur: 1.4, vol: 0.35, delay: 0.05 });
  for (let i = 0; i < 14; i++) burst({ freq: 1500 + Math.random() * 5000, q: 3, dur: 0.03 + Math.random() * 0.05, vol: 0.12, delay: 0.1 + Math.random() * 0.9 });
}
