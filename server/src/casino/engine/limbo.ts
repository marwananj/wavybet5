import type { Rng } from '../fair';
import { floor4, GameError, type InstantResult } from './instant';

/**
 * Limbo — pick a target multiplier; the game draws a result multiplier R = 0.99 / (1 − U).
 * You win the target when R ≥ target. P(win) = 0.99 / target → 99% RTP at every target.
 */
export const LIMBO_EDGE = 0.01;
export const LIMBO_MIN = 1.01;
export const LIMBO_MAX = 1_000_000;

export const limboResult = (u: number) => Math.max(1, Math.floor(((1 - LIMBO_EDGE) / (1 - u)) * 100) / 100);

export function playLimbo(p: { target: number }, rng: Rng): InstantResult {
  const target = Math.round(p.target * 100) / 100;
  if (!(target >= LIMBO_MIN && target <= LIMBO_MAX)) throw new GameError(`Target must be between ${LIMBO_MIN}× and ${LIMBO_MAX.toLocaleString()}×`);
  const result = Math.min(limboResult(rng(0)), LIMBO_MAX);
  const won = result >= target;
  return {
    multiplier: won ? floor4(target) : 0,
    status: won ? 'WON' : 'LOST',
    result: { target, result, won, chance: Math.round(((1 - LIMBO_EDGE) / target) * 1e6) / 1e4 },
  };
}
