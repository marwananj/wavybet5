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
  bounce: (v = 1) => (burst({ freq: 3800, q: 5, dur: 0.03, vol: 0.35 * v }), tone({ freq: 1900, type: 'sine', dur: 0.03, vol: 0.06 * v })),
  clack: () => {
    burst({ freq: 2600, q: 3, dur: 0.05, vol: 0.5 });
    burst({ freq: 1200, q: 2, dur: 0.08, vol: 0.3, delay: 0.02 });
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
  const s = c.createBufferSource();
  s.buffer = noise(c);
  s.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.4;
  const g = c.createGain();
  g.gain.value = 0.0001;
  const hum = c.createOscillator();
  hum.type = 'triangle';
  const hg = c.createGain();
  hg.gain.value = 0.0001;
  s.connect(f);
  f.connect(g);
  g.connect(master);
  hum.connect(hg);
  hg.connect(master);
  s.start();
  hum.start();
  let stopped = false;
  return {
    set(speed: number) {
      if (stopped) return;
      const t = c.currentTime;
      const x = Math.max(0, Math.min(1, speed));
      f.frequency.setTargetAtTime(500 + x * 2600, t, 0.05);
      g.gain.setTargetAtTime(0.02 + x * 0.16, t, 0.05);
      hum.frequency.setTargetAtTime(60 + x * 90, t, 0.05);
      hg.gain.setTargetAtTime(0.01 + x * 0.03, t, 0.05);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const t = c.currentTime;
      g.gain.setTargetAtTime(0.0001, t, 0.08);
      hg.gain.setTargetAtTime(0.0001, t, 0.08);
      s.stop(t + 0.5);
      hum.stop(t + 0.5);
    },
  };
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? '1' : '0');
  } catch {
    /* private mode */
  }
  if (m && ctx) ctx.suspend().catch(() => {});
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
