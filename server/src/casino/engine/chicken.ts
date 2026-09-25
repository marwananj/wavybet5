import type { Rng } from '../fair';
import { floor4, GameError } from './instant';

/**
 * Chicken Road — cross lane after lane; each lane hides a car with a fixed probability.
 * Survive k lanes → multiplier 0.99 / (1 − p)^k (1% edge). Cash out any time after one lane.
 * The whole road is decided when the round starts (from the RNG) and revealed as you cross.
 */
export const CHICKEN_LEVELS = {
  easy: { lanes: 24, death: 1 / 25 },
  medium: { lanes: 22, death: 3 / 25 },
  hard: { lanes: 20, death: 5 / 25 },
  expert: { lanes: 15, death: 10 / 25 },
} as const;
export type ChickenLevel = keyof typeof CHICKEN_LEVELS;

export const chickenMultiplier = (level: ChickenLevel, lane: number) =>
  lane === 0 ? 1 : floor4(0.99 / Math.pow(1 - CHICKEN_LEVELS[level].death, lane));
export const chickenLadder = (level: ChickenLevel) =>
  Array.from({ length: CHICKEN_LEVELS[level].lanes }, (_, i) => chickenMultiplier(level, i + 1));

export interface ChickenState {
  level: ChickenLevel;
  lane: number; // lanes crossed
  cars: boolean[]; // hidden until the round ends
  finished: boolean;
  dead: boolean;
}

export function chickenStart(level: ChickenLevel, rng: Rng): ChickenState {
  const L = CHICKEN_LEVELS[level];
  if (!L) throw new GameError('Invalid difficulty');
  return { level, lane: 0, cars: Array.from({ length: L.lanes }, (_, i) => rng(i) < L.death), finished: false, dead: false };
}

export function chickenStep(s: ChickenState) {
  if (s.finished) throw new GameError('Round is over');
  const hit = s.cars[s.lane];
  if (hit) {
    s.finished = true;
    s.dead = true;
    return;
  }
  s.lane++;
  if (s.lane >= s.cars.length) s.finished = true; // made it across → auto cash-out
}

export function chickenView(s: ChickenState) {
  return {
    level: s.level,
    lane: s.lane,
    lanes: s.cars.length,
    ladder: chickenLadder(s.level),
    multiplier: chickenMultiplier(s.level, s.lane),
    finished: s.finished,
    dead: s.dead,
    cars: s.finished ? s.cars : undefined,
    canCashout: !s.finished && s.lane > 0,
  };
}
