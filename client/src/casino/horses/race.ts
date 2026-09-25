/* Race replay model: turns the server's finishing order + margins into smooth running lines. */

export const LENGTH_M = 2.4; // one horse length in metres
export const T_WINNER = 21; // seconds the winner takes to reach the line (sped-up TV time)

export interface Plan {
  distance: number;
  finish: number[]; // finishing time per runner index
  A: number[];
  B: number[];
  C: number[];
  order: number[];
  margins: number[];
}

/** tiny deterministic PRNG so a replay looks the same every time */
export function prng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makePlan(distance: number, order: number[], margins: number[], styles: number[], seed: string): Plan {
  const r = prng(seed);
  const v = distance / T_WINNER;
  const finish: number[] = new Array(order.length);
  let behind = 0;
  order.forEach((idx, pos) => {
    behind += margins[pos] ?? 0;
    finish[idx] = T_WINNER + (behind * LENGTH_M) / (v * 0.97);
  });
  // running shape: A>0 races prominently early, B/C add mid-race surges; all monotone
  const A = styles.map((s) => 0.011 * s + (r() - 0.5) * 0.008);
  const B = styles.map(() => (r() - 0.5) * 0.009);
  const C = styles.map(() => (r() - 0.5) * 0.006);
  return { distance, finish, A, B, C, order, margins };
}

/** metres covered by runner i at time t (s) */
export function posAt(p: Plan, i: number, t: number) {
  const T = p.finish[i];
  if (t <= 0) return 0;
  if (t >= T) {
    // eased pull-up after the line
    const d = t - T;
    const v = p.distance / T;
    return p.distance + v * (d - (d * d) / 8) * (d < 4 ? 1 : 0) + (d >= 4 ? v * 2 : 0);
  }
  // gentle start: first 8% of the race accelerating from the stalls
  const u = t / T;
  const ease = u < 0.08 ? (u * u) / 0.16 + 0.0 : u - 0.04;
  const base = u < 0.08 ? ease : ease;
  const norm = 1 - 0.04; // base(1) = 0.96
  const shape = base / norm + p.A[i] * Math.sin(Math.PI * u) + p.B[i] * Math.sin(2 * Math.PI * u) + p.C[i] * Math.sin(3 * Math.PI * u);
  return p.distance * Math.max(0, shape);
}

export function lengthsText(l: number) {
  if (l < 0.1) return 'a short head';
  if (l < 0.2) return 'a head';
  if (l < 0.35) return 'a neck';
  const q = Math.round(l * 4) / 4;
  const whole = Math.floor(q);
  const frac = q - whole;
  const f = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : '';
  const n = `${whole || ''}${f}` || '½';
  return `${n} length${q > 1 ? 's' : ''}`;
}

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
