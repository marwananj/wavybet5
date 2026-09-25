import type { Rng } from '../fair';
import { KENO_TABLES, type KenoRisk } from './kenoTables';

export class GameError extends Error {}
export const floor4 = (x: number) => Math.floor(x * 10000) / 10000;

/** Result of an instant game, in units of the stake (payout = stake × multiplier). */
export interface InstantResult {
  multiplier: number;
  /** exact payout amount when it isn't simply stake × multiplier (roulette) */
  payout?: number;
  status: 'WON' | 'LOST' | 'PUSH';
  result: Record<string, unknown>;
}

/* ─────────────────────────────── Dice ───────────────────────────────
 * Roll 0.00–99.99 (10,000 equally likely outcomes).
 * Under t wins if roll < t (chance t%), Over t wins if roll ≥ t (chance 100−t%).
 * Multiplier = 99 / chance → 1% house edge, exact. */
export const DICE_EDGE = 0.01;
export function diceChance(target: number, over: boolean) {
  return over ? 100 - target : target;
}
export function diceMultiplier(chance: number) {
  return floor4((100 * (1 - DICE_EDGE)) / chance);
}
export function playDice(p: { target: number; over: boolean }, rng: Rng): InstantResult {
  const t = Math.round(p.target * 100) / 100;
  const chance = diceChance(t, p.over);
  if (!(chance >= 1 && chance <= 98)) throw new GameError('Win chance must be between 1% and 98%');
  const roll = Math.floor(rng(0) * 10000) / 100;
  const win = p.over ? roll >= t : roll < t;
  const m = diceMultiplier(chance);
  return { multiplier: win ? m : 0, status: win ? 'WON' : 'LOST', result: { roll, target: t, over: p.over, chance, payoutMultiplier: m } };
}

/* ─────────────────────────────── Keno ───────────────────────────────
 * 40 numbers, 10 drawn without replacement (Fisher–Yates from the RNG). */
export const KENO_RISKS: KenoRisk[] = ['easy', 'medium', 'hard', 'expert'];
export function kenoDraw(rng: Rng) {
  const pool = Array.from({ length: 40 }, (_, i) => i + 1);
  const drawn: number[] = [];
  for (let i = 0; i < 10; i++) drawn.push(pool.splice(Math.floor(rng(i) * pool.length), 1)[0]);
  return drawn;
}
export function playKeno(p: { picks: number[]; risk: KenoRisk }, rng: Rng): InstantResult {
  const picks = [...new Set(p.picks)];
  if (picks.length < 1 || picks.length > 10) throw new GameError('Pick between 1 and 10 numbers');
  if (picks.some((n) => !Number.isInteger(n) || n < 1 || n > 40)) throw new GameError('Numbers must be 1–40');
  if (!KENO_RISKS.includes(p.risk)) throw new GameError('Invalid risk');
  const drawn = kenoDraw(rng);
  const hits = picks.filter((n) => drawn.includes(n));
  const m = KENO_TABLES[p.risk][picks.length][hits.length] ?? 0;
  return { multiplier: m, status: m > 0 ? 'WON' : 'LOST', result: { drawn, picks, hits, risk: p.risk } };
}

/* ─────────────────────── Rock Paper Scissors ───────────────────────
 * Win 1.96×, draw returns the stake, loss 0 → RTP 98.67%. */
export const RPS = ['rock', 'paper', 'scissors'] as const;
export type RpsPick = (typeof RPS)[number];
export const RPS_WIN = 1.96;
export function playRps(p: { pick: RpsPick }, rng: Rng): InstantResult {
  if (!RPS.includes(p.pick)) throw new GameError('Invalid pick');
  const house = RPS[Math.floor(rng(0) * 3)];
  const beats: Record<RpsPick, RpsPick> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  const outcome = p.pick === house ? 'draw' : beats[p.pick] === house ? 'win' : 'lose';
  return {
    multiplier: outcome === 'win' ? RPS_WIN : outcome === 'draw' ? 1 : 0,
    status: outcome === 'win' ? 'WON' : outcome === 'draw' ? 'PUSH' : 'LOST',
    result: { pick: p.pick, house, outcome },
  };
}

/* ──────────────────────────── Coin flip ────────────────────────────
 * 50/50, pays 1.98× → 1% edge. */
export const COIN_WIN = 1.98;
export function playCoinflip(p: { side: 'heads' | 'tails' }, rng: Rng): InstantResult {
  if (p.side !== 'heads' && p.side !== 'tails') throw new GameError('Pick heads or tails');
  const side = rng(0) < 0.5 ? 'heads' : 'tails';
  const win = side === p.side;
  return { multiplier: win ? COIN_WIN : 0, status: win ? 'WON' : 'LOST', result: { pick: p.side, side } };
}

/* ───────────────────────── European roulette ─────────────────────────
 * Single zero, standard payouts (2.70% edge on every bet). Multiplier is relative to the TOTAL stake.
 *
 * Inside bets carry the exact numbers they cover and are validated against the real table layout:
 *   split 17:1 · street / trio 11:1 · corner / first four 8:1 · six line 5:1
 * Racetrack bets (neighbours, Voisins du zéro, Tiers, Orphelins, Jeu zéro) are placed by the client as
 * the standard combination of these chips, exactly like a real croupier would.
 *
 * Thunder mode: after bets close, 1–5 "lucky" numbers are struck with a 50×–500× multiplier.
 * Straight-up bets pay 29:1 normally and the multiplier (to 1) on a lucky number; every other bet pays
 * as usual. Weights below give straight-up bets ≈97.3% RTP (see THUNDER_RTP). */
export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export type RouletteBetType = 'straight' | 'split' | 'street' | 'corner' | 'line' | 'red' | 'black' | 'odd' | 'even' | 'low' | 'high' | 'dozen' | 'column';
export type RouletteMode = 'classic' | 'thunder';
export interface RouletteBet {
  type: RouletteBetType;
  value?: number;
  numbers?: number[];
  amount: number;
}
/** total returned per unit staked (stake included) */
export const ROULETTE_PAYS: Record<RouletteBetType, number> = {
  straight: 36, split: 18, street: 12, corner: 9, line: 6, red: 2, black: 2, odd: 2, even: 2, low: 2, high: 2, dozen: 3, column: 3,
};
export const THUNDER_STRAIGHT = 30; // 29:1

const INSIDE: RouletteBetType[] = ['split', 'street', 'corner', 'line'];
const key = (a: number[]) => [...a].sort((x, y) => x - y).join('-');
/** every legal inside-bet combination on a European layout */
export const INSIDE_BETS: Record<string, Set<string>> = (() => {
  const split = new Set<string>();
  const street = new Set<string>();
  const corner = new Set<string>();
  const line = new Set<string>();
  for (let n = 1; n <= 36; n++) {
    if (n + 3 <= 36) split.add(key([n, n + 3]));
    if (n % 3 !== 0) split.add(key([n, n + 1]));
    if (n % 3 !== 0 && n + 4 <= 36) corner.add(key([n, n + 1, n + 3, n + 4]));
  }
  for (let r = 1; r <= 3; r++) split.add(key([0, r]));
  for (let c = 0; c < 12; c++) street.add(key([3 * c + 1, 3 * c + 2, 3 * c + 3]));
  street.add(key([0, 1, 2]));
  street.add(key([0, 2, 3]));
  corner.add(key([0, 1, 2, 3])); // first four
  for (let c = 0; c < 11; c++) line.add(key([3 * c + 1, 3 * c + 2, 3 * c + 3, 3 * c + 4, 3 * c + 5, 3 * c + 6]));
  return { split, street, corner, line };
})();

export function rouletteCovers(b: RouletteBet, n: number) {
  if (b.type === 'straight') return n === b.value;
  if (INSIDE.includes(b.type)) return !!b.numbers?.includes(n);
  if (n === 0) return false;
  switch (b.type) {
    case 'red': return RED.has(n);
    case 'black': return !RED.has(n);
    case 'odd': return n % 2 === 1;
    case 'even': return n % 2 === 0;
    case 'low': return n <= 18;
    case 'high': return n >= 19;
    case 'dozen': return Math.ceil(n / 12) === b.value;
    case 'column': return ((n - 1) % 3) + 1 === b.value;
  }
  return false;
}
export function validateRouletteBets(bets: RouletteBet[]) {
  if (!bets.length || bets.length > 200) throw new GameError('Place between 1 and 200 chips');
  for (const b of bets) {
    if (!(b.type in ROULETTE_PAYS)) throw new GameError('Invalid bet');
    if (b.type === 'straight' && !(Number.isInteger(b.value) && b.value! >= 0 && b.value! <= 36)) throw new GameError('Invalid number');
    if ((b.type === 'dozen' || b.type === 'column') && ![1, 2, 3].includes(b.value!)) throw new GameError('Invalid dozen/column');
    if (INSIDE.includes(b.type)) {
      if (!Array.isArray(b.numbers) || !INSIDE_BETS[b.type].has(key(b.numbers))) throw new GameError(`Invalid ${b.type} bet`);
    }
    if (!(b.amount > 0)) throw new GameError('Invalid chip amount');
  }
}

/* Thunder: how many numbers get struck, and the multiplier each one gets (weights out of 1000) */
export const THUNDER_COUNTS: [number, number][] = [[1, 300], [2, 280], [3, 220], [4, 120], [5, 80]];
export const THUNDER_MULTS: [number, number][] = [[50, 398], [100, 280], [150, 130], [200, 90], [300, 60], [400, 27], [500, 15]];
const pick = (table: [number, number][], f: number) => {
  let x = f * table.reduce((a, t) => a + t[1], 0);
  for (const [v, w] of table) if ((x -= w) < 0) return v;
  return table[table.length - 1][0];
};
const mean = (t: [number, number][]) => t.reduce((a, [v, w]) => a + v * w, 0) / t.reduce((a, [, w]) => a + w, 0);
/** exact straight-up return in Thunder mode */
export const THUNDER_RTP = (() => {
  const p = mean(THUNDER_COUNTS) / 37;
  return ((THUNDER_STRAIGHT * (1 - p) + (mean(THUNDER_MULTS) + 1) * p) / 37);
})();
export function thunderStrikes(rng: Rng) {
  const k = pick(THUNDER_COUNTS, rng(1));
  const pool = Array.from({ length: 37 }, (_, i) => i);
  const out: { number: number; multiplier: number }[] = [];
  for (let i = 0; i < k; i++) {
    const number = pool.splice(Math.floor(rng(2 + i) * pool.length), 1)[0];
    out.push({ number, multiplier: pick(THUNDER_MULTS, rng(8 + i)) });
  }
  return out;
}

export function playRoulette(p: { bets: RouletteBet[]; mode?: RouletteMode }, rng: Rng): InstantResult {
  validateRouletteBets(p.bets);
  const mode: RouletteMode = p.mode === 'thunder' ? 'thunder' : 'classic';
  const total = p.bets.reduce((a, b) => a + b.amount, 0);
  const number = Math.floor(rng(0) * 37);
  const lucky = mode === 'thunder' ? thunderStrikes(rng) : [];
  const hit = lucky.find((l) => l.number === number);
  const pays = (b: RouletteBet) => {
    if (b.type !== 'straight' || mode !== 'thunder') return ROULETTE_PAYS[b.type];
    return b.value === number && hit ? hit.multiplier + 1 : THUNDER_STRAIGHT;
  };
  const returned = Math.round(p.bets.reduce((a, b) => a + (rouletteCovers(b, number) ? b.amount * pays(b) : 0), 0) * 100) / 100;
  const multiplier = floor4(returned / total);
  return {
    multiplier,
    payout: returned,
    status: returned > total ? 'WON' : returned === total ? 'PUSH' : returned > 0 ? 'WON' : 'LOST',
    result: { number, color: number === 0 ? 'green' : RED.has(number) ? 'red' : 'black', pocket: WHEEL_ORDER.indexOf(number), returned, mode, lucky },
  };
}
