import type { Rng } from '../fair';
import { GameError, type InstantResult } from './instant';

/**
 * Plinko — a ball drops through R rows of pegs; at every row it goes left or right (50/50, from the
 * provably fair RNG) and lands in bucket k = number of right bounces. Bucket odds are binomial.
 * Multiplier tables for 8–16 rows × low/medium/high risk are tuned to 99% RTP (computed exactly).
 */
export const PLINKO_ROWS = [8, 10, 12, 14, 16] as const;
export const PLINKO_RISKS = ['low', 'medium', 'high'] as const;
export type PlinkoRisk = (typeof PLINKO_RISKS)[number];

export const PLINKO_TABLES: Record<PlinkoRisk, Record<number, number[]>> = {
  low: {
    8: [5.64, 2.71, 1.38, 0.76, 0.52, 0.76, 1.38, 2.71, 5.64],
    10: [8.97, 4.32, 2.19, 1.19, 0.71, 0.51, 0.71, 1.19, 2.19, 4.32, 8.97],
    12: [10.0, 5.54, 3.17, 1.83, 1.1, 0.7, 0.52, 0.7, 1.1, 1.83, 3.17, 5.54, 10.0],
    14: [15.1, 8.31, 4.7, 2.72, 1.63, 1.02, 0.67, 0.51, 0.67, 1.02, 1.63, 2.72, 4.7, 8.31, 15.1],
    16: [16.0, 9.68, 5.94, 3.66, 2.31, 1.49, 0.98, 0.67, 0.51, 0.67, 0.98, 1.49, 2.31, 3.66, 5.94, 9.68, 16.0],
  },
  medium: {
    8: [13.0, 3.7, 1.31, 0.59, 0.41, 0.59, 1.31, 3.7, 13.0],
    10: [22.0, 7.0, 2.55, 1.08, 0.56, 0.42, 0.56, 1.08, 2.55, 7.0, 22.0],
    12: [33.6, 11.8, 4.62, 2.01, 0.97, 0.55, 0.41, 0.55, 0.97, 2.01, 4.62, 11.8, 33.6],
    14: [58.6, 21.1, 8.3, 3.55, 1.67, 0.87, 0.53, 0.41, 0.53, 0.87, 1.67, 3.55, 8.3, 21.1, 58.6],
    16: [110, 39.4, 15.2, 6.33, 2.88, 1.44, 0.79, 0.51, 0.41, 0.51, 0.79, 1.44, 2.88, 6.33, 15.2, 39.4, 110],
  },
  high: {
    8: [29.0, 4.9, 1.12, 0.36, 0.2, 0.36, 1.12, 4.9, 29.0],
    10: [76.4, 12.5, 2.7, 0.77, 0.31, 0.21, 0.31, 0.77, 2.7, 12.5, 76.4],
    12: [170, 30.7, 6.75, 1.84, 0.63, 0.29, 0.21, 0.29, 0.63, 1.84, 6.75, 30.7, 170],
    14: [420, 76.2, 16.4, 4.25, 1.35, 0.53, 0.27, 0.21, 0.27, 0.53, 1.35, 4.25, 16.4, 76.2, 420],
    16: [1000, 184, 39.5, 9.97, 2.97, 1.07, 0.47, 0.26, 0.21, 0.26, 0.47, 1.07, 2.97, 9.97, 39.5, 184, 1000],
  },
};

export function playPlinko(p: { rows: number; risk: PlinkoRisk }, rng: Rng): InstantResult {
  const table = PLINKO_TABLES[p.risk]?.[p.rows];
  if (!table) throw new GameError('Invalid rows or risk');
  const path: number[] = [];
  let k = 0;
  for (let i = 0; i < p.rows; i++) {
    const right = rng(i) < 0.5 ? 0 : 1;
    path.push(right);
    k += right;
  }
  const multiplier = table[k];
  return { multiplier, status: multiplier >= 1 ? 'WON' : 'LOST', result: { path, bucket: k, multiplier, rows: p.rows, risk: p.risk } };
}
