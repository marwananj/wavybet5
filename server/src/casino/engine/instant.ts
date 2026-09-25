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
 * Single zero, standard payouts (2.70% edge). Multiplier is relative to the TOTAL stake. */
export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export type RouletteBetType = 'straight' | 'red' | 'black' | 'odd' | 'even' | 'low' | 'high' | 'dozen' | 'column';
export interface RouletteBet {
  type: RouletteBetType;
  value?: number;
  amount: number;
}
export function rouletteCovers(b: RouletteBet, n: number) {
  if (b.type === 'straight') return n === b.value;
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
export const ROULETTE_PAYS: Record<RouletteBetType, number> = { straight: 36, red: 2, black: 2, odd: 2, even: 2, low: 2, high: 2, dozen: 3, column: 3 };
export function validateRouletteBets(bets: RouletteBet[]) {
  if (!bets.length || bets.length > 60) throw new GameError('Place between 1 and 60 chips');
  for (const b of bets) {
    if (!(b.type in ROULETTE_PAYS)) throw new GameError('Invalid bet');
    if (b.type === 'straight' && !(Number.isInteger(b.value) && b.value! >= 0 && b.value! <= 36)) throw new GameError('Invalid number');
    if ((b.type === 'dozen' || b.type === 'column') && ![1, 2, 3].includes(b.value!)) throw new GameError('Invalid dozen/column');
    if (!(b.amount > 0)) throw new GameError('Invalid chip amount');
  }
}
export function playRoulette(p: { bets: RouletteBet[] }, rng: Rng): InstantResult {
  validateRouletteBets(p.bets);
  const total = p.bets.reduce((a, b) => a + b.amount, 0);
  const number = Math.floor(rng(0) * 37);
  const returned = p.bets.reduce((a, b) => a + (rouletteCovers(b, number) ? b.amount * ROULETTE_PAYS[b.type] : 0), 0);
  const multiplier = floor4(returned / total);
  return {
    multiplier,
    payout: returned,
    status: returned > total ? 'WON' : returned === total ? 'PUSH' : returned > 0 ? 'WON' : 'LOST',
    result: { number, color: number === 0 ? 'green' : RED.has(number) ? 'red' : 'black', pocket: WHEEL_ORDER.indexOf(number), returned },
  };
}
