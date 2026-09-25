import type { Rng } from '../fair';
import { GameError, type InstantResult } from './instant';

/**
 * Wheel — one spin lands on one of N equally likely segments (10/20/30/40/50).
 * Every table sums to 0.99 × N, so each risk level returns exactly 99% (1% edge).
 *  • easy   — mostly 1.2×, one 1.5× and two blanks per 10 segments
 *  • medium — every other segment is blank, the rest 1.5× / 2× plus one big segment
 *  • hard   — a single segment pays 0.99 × N (9.9× … 49.5×), everything else blank
 */
export const WHEEL_SEGMENTS = [10, 20, 30, 40, 50] as const;
export const WHEEL_RISKS = ['easy', 'medium', 'hard'] as const;
export type WheelRisk = (typeof WHEEL_RISKS)[number];

const r2 = (x: number) => Math.round(x * 100) / 100;

function build(risk: WheelRisk, n: number): number[] {
  if (risk === 'easy') {
    const block = [1.5, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0];
    return Array.from({ length: n }, (_, i) => block[i % 10]);
  }
  if (risk === 'hard') {
    return Array.from({ length: n }, (_, i) => (i === n - 1 ? r2(0.99 * n) : 0));
  }
  // medium: blanks on even slots, alternating 1.5/2 on odd slots, the last odd slot is the big one
  const out = new Array<number>(n).fill(0);
  let sum = 0;
  let k = 0;
  for (let i = 1; i < n - 1; i += 2) {
    out[i] = k++ % 2 === 0 ? 1.5 : 2;
    sum += out[i];
  }
  out[n - 1] = r2(0.99 * n - sum);
  return out;
}

export const WHEEL_TABLES: Record<WheelRisk, Record<number, number[]>> = Object.fromEntries(
  WHEEL_RISKS.map((risk) => [risk, Object.fromEntries(WHEEL_SEGMENTS.map((n) => [n, build(risk, n)]))])
) as Record<WheelRisk, Record<number, number[]>>;

export function playWheel(p: { risk: WheelRisk; segments: number }, rng: Rng): InstantResult {
  const table = WHEEL_TABLES[p.risk]?.[p.segments];
  if (!table) throw new GameError('Invalid wheel');
  const index = Math.floor(rng(0) * table.length);
  const m = table[index];
  return { multiplier: m, status: m > 0 ? 'WON' : 'LOST', result: { index, multiplier: m, risk: p.risk, segments: p.segments } };
}
