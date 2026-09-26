import type { Rng } from '../fair';
import { GameError, type InstantResult } from './instant';

/**
 * Wavy Slots — 5 reels × 3 rows, 20 fixed paylines, left-to-right.
 *  • Symbols 0–6 are regular (low → high), 7 = WILD (substitutes for 0–6, reels 2–4 only),
 *    8 = SCATTER (pays anywhere, 3+ triggers free spins).
 *  • Line bet = total bet ÷ 20. A line pays its best combination; wild-only lines pay the wild table.
 *  • Free spins: every win × FS multiplier, can retrigger (capped at MAX_FREE spins).
 *  • Each reel stops at a uniformly random position on a fixed strip, drawn from the provably
 *    fair RNG (one float per reel, per spin). Free spins continue the same RNG stream.
 * RTPs below were measured by simulating tens of millions of spins (see README).
 */

export const ROWS = 3;
export const REELS = 5;
export const LINES = 20;
export const WILD = 7;
export const SCATTER = 8;
const MAX_FREE = 100;

/** row index (0 top … 2 bottom) on each reel for the 20 paylines */
export const PAYLINES: number[][] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [1, 0, 1, 2, 1],
  [1, 2, 1, 0, 1],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 2, 0, 2, 0],
  [2, 0, 2, 0, 2],
  [0, 2, 2, 2, 0],
];

export interface Machine {
  id: string;
  name: string;
  volatility: 'Low' | 'Medium' | 'High';
  /** line pays (× line bet) for 3/4/5 of a kind, symbols 0–6 then WILD */
  pays: [number, number, number][];
  /** scatter pays (× TOTAL bet) for 3/4/5 anywhere */
  scatterPays: [number, number, number];
  freeSpins: [number, number, number];
  fsMultiplier: number;
  /** symbol weights per reel: [s0..s6, WILD, SCATTER] */
  weights: number[][];
  rtp: number; // measured
}

export const MACHINES: Record<string, Machine> = {
  'slot-fruits': {
    id: 'slot-fruits',
    name: 'Wavy Fruits',
    volatility: 'Low',
    pays: [
      [5, 15, 50],
      [5, 15, 50],
      [8, 25, 80],
      [10, 30, 100],
      [15, 50, 150],
      [25, 80, 300],
      [40, 150, 750],
      [50, 250, 1500],
    ],
    scatterPays: [2, 10, 50],
    freeSpins: [8, 12, 20],
    fsMultiplier: 2,
    weights: [
      [9, 9, 8, 7, 6, 4, 3, 0, 2],
      [9, 9, 8, 7, 6, 4, 3, 2, 2],
      [9, 9, 8, 7, 6, 4, 3, 2, 2],
      [9, 9, 8, 7, 6, 4, 3, 2, 2],
      [9, 9, 8, 7, 6, 4, 3, 0, 2],
    ],
    rtp: 0.96,
  },
  'slot-gems': {
    id: 'slot-gems',
    name: 'Neon Gems',
    volatility: 'Medium',
    pays: [
      [5, 20, 60],
      [5, 20, 60],
      [8, 30, 100],
      [10, 40, 125],
      [15, 60, 200],
      [30, 100, 400],
      [50, 200, 1000],
      [75, 400, 2500],
    ],
    scatterPays: [3, 15, 100],
    freeSpins: [10, 15, 25],
    fsMultiplier: 3,
    weights: [
      [10, 10, 9, 8, 6, 4, 2, 0, 2],
      [10, 10, 9, 8, 6, 4, 2, 2, 2],
      [10, 10, 9, 8, 6, 4, 2, 2, 2],
      [10, 10, 9, 8, 6, 4, 2, 2, 2],
      [10, 10, 9, 8, 6, 4, 2, 0, 2],
    ],
    rtp: 0.96,
  },
  'slot-pharaoh': {
    id: 'slot-pharaoh',
    name: "Pharaoh's Wave",
    volatility: 'High',
    pays: [
      [5, 25, 100],
      [5, 25, 100],
      [10, 40, 150],
      [10, 50, 200],
      [20, 80, 300],
      [40, 150, 750],
      [75, 300, 2000],
      [100, 750, 5000],
    ],
    scatterPays: [5, 20, 200],
    freeSpins: [10, 15, 30],
    fsMultiplier: 3,
    weights: [
      [11, 11, 10, 9, 6, 3, 2, 0, 2],
      [11, 11, 10, 9, 6, 3, 2, 1, 2],
      [11, 11, 10, 9, 6, 3, 2, 2, 2],
      [11, 11, 10, 9, 6, 3, 2, 1, 2],
      [11, 11, 10, 9, 6, 3, 2, 0, 2],
    ],
    rtp: 0.96,
  },
};

/** pay scale applied to line pays so each machine lands on its target RTP (tuned by simulation) */
export const PAY_SCALE: Record<string, number> = { 'slot-fruits': 1.524, 'slot-gems': 1.1293, 'slot-pharaoh': 0.7429 };

/* deterministic strip layout: spread each symbol evenly around the reel */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const STRIPS = new Map<string, number[][]>();
export function strips(m: Machine): number[][] {
  let s = STRIPS.get(m.id);
  if (s) return s;
  s = m.weights.map((w, reel) => {
    const out: number[] = [];
    w.forEach((n, sym) => {
      for (let i = 0; i < n; i++) out.push(sym);
    });
    const r = mulberry(reel * 7919 + m.id.length * 31);
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    // avoid two scatters within sight on one reel
    for (let i = 0; i < out.length; i++) {
      if (out[i] === SCATTER && (out[(i + 1) % out.length] === SCATTER || out[(i + 2) % out.length] === SCATTER)) {
        const k = (i + 3 + Math.floor(out.length / 2)) % out.length;
        [out[(i + 1) % out.length], out[k]] = [out[k], out[(i + 1) % out.length]];
      }
    }
    return out;
  });
  STRIPS.set(m.id, s);
  return s;
}

export interface LineWin {
  line: number;
  symbol: number;
  count: number;
  pay: number; // × line bet (after free-spin multiplier)
  cells: [number, number][]; // [reel, row]
}
export interface SpinResult {
  grid: number[][]; // grid[reel][row]
  stops: number[];
  lines: LineWin[];
  scatter: { count: number; pay: number; cells: [number, number][] }; // pay × total bet
  award: number; // free spins won on this spin
  win: number; // × total bet
}

function spinOnce(m: Machine, rng: Rng, cursor: number, mult: number): SpinResult {
  const st = strips(m);
  const stops = st.map((strip, i) => Math.floor(rng(cursor + i) * strip.length));
  const grid = st.map((strip, i) => [0, 1, 2].map((row) => strip[(stops[i] - 1 + row + strip.length) % strip.length]));
  const scale = PAY_SCALE[m.id] ?? 1;
  const lines: LineWin[] = [];
  PAYLINES.forEach((pl, li) => {
    const syms = pl.map((row, reel) => grid[reel][row]);
    // best of: the line's paying symbol run, or a pure-wild run
    let target = -1;
    for (const s of syms) {
      if (s === SCATTER) break;
      if (s !== WILD) {
        target = s;
        break;
      }
    }
    const run = (sym: number) => {
      let n = 0;
      for (const s of syms) {
        if (s === sym || (s === WILD && sym !== SCATTER)) n++;
        else break;
      }
      return n;
    };
    let wildRun = 0;
    for (const s of syms) {
      if (s === WILD) wildRun++;
      else break;
    }
    const options: { symbol: number; count: number; pay: number }[] = [];
    if (target >= 0) {
      const n = run(target);
      if (n >= 3) options.push({ symbol: target, count: n, pay: m.pays[target][n - 3] });
    }
    if (wildRun >= 3) options.push({ symbol: WILD, count: wildRun, pay: m.pays[WILD][wildRun - 3] });
    if (!options.length) return;
    const best = options.sort((a, b) => b.pay - a.pay)[0];
    lines.push({
      line: li,
      symbol: best.symbol,
      count: best.count,
      pay: Math.round(best.pay * scale * mult * 100) / 100,
      cells: pl.slice(0, best.count).map((row, reel) => [reel, row] as [number, number]),
    });
  });
  const scat: [number, number][] = [];
  grid.forEach((col, reel) => col.forEach((s, row) => s === SCATTER && scat.push([reel, row])));
  const sc = Math.min(5, scat.length);
  const scatterPay = sc >= 3 ? m.scatterPays[sc - 3] * mult : 0;
  const award = sc >= 3 ? m.freeSpins[sc - 3] : 0;
  const lineTotal = lines.reduce((a, l) => a + l.pay, 0) / LINES;
  return { grid, stops, lines, scatter: { count: scat.length, pay: scatterPay, cells: scat }, award, win: lineTotal + scatterPay };
}

export interface SlotRound {
  machine: string;
  base: SpinResult;
  free: SpinResult[];
  freeTotal: number; // × total bet
  total: number; // × total bet
}

export function playSlot(machineId: string, rng: Rng): SlotRound {
  const m = MACHINES[machineId];
  if (!m) throw new GameError('Unknown slot machine');
  let cursor = 0;
  const base = spinOnce(m, rng, cursor, 1);
  cursor += REELS;
  const free: SpinResult[] = [];
  let left = base.award;
  let played = 0;
  while (left > 0 && played < MAX_FREE) {
    const s = spinOnce(m, rng, cursor, m.fsMultiplier);
    cursor += REELS;
    free.push(s);
    played++;
    left--;
    left += s.award;
  }
  const freeTotal = free.reduce((a, s) => a + s.win, 0);
  return { machine: machineId, base, free, freeTotal: Math.round(freeTotal * 10000) / 10000, total: Math.round((base.win + freeTotal) * 10000) / 10000 };
}

export function slotInstant(machineId: string, rng: Rng): InstantResult {
  const r = playSlot(machineId, rng);
  const multiplier = Math.floor(r.total * 10000) / 10000;
  return { multiplier, status: multiplier > 1 ? 'WON' : multiplier === 1 ? 'PUSH' : 'LOST', result: r as unknown as Record<string, unknown> };
}

export const machineInfo = () =>
  Object.values(MACHINES).map((m) => ({
    id: m.id,
    name: m.name,
    volatility: m.volatility,
    pays: m.pays.map((p) => p.map((x) => Math.round(x * (PAY_SCALE[m.id] ?? 1) * 100) / 100)),
    scatterPays: m.scatterPays,
    freeSpins: m.freeSpins,
    fsMultiplier: m.fsMultiplier,
    rtp: m.rtp,
    lines: LINES,
    paylines: PAYLINES,
  }));
