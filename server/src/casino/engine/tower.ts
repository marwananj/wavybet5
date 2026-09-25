import type { Rng } from '../fair';
import { floor4, GameError } from './instant';

/**
 * Tower — climb 9 floors; on each floor pick one tile. Some tiles hide a skull.
 * Clearing k floors pays 0.99 / p^k where p is the chance a tile is safe (1% edge).
 * Every floor's layout is fixed from the RNG when the round starts. Cash out any time after one floor.
 */
export const TOWER_FLOORS = 9;
export const TOWER_LEVELS = {
  easy: { tiles: 4, safe: 3 },
  medium: { tiles: 3, safe: 2 },
  hard: { tiles: 2, safe: 1 },
  expert: { tiles: 3, safe: 1 },
} as const;
export type TowerLevel = keyof typeof TOWER_LEVELS;

export const towerMultiplier = (level: TowerLevel, floor: number) => {
  const L = TOWER_LEVELS[level];
  return floor === 0 ? 1 : floor4(0.99 / Math.pow(L.safe / L.tiles, floor));
};
export const towerLadder = (level: TowerLevel) => Array.from({ length: TOWER_FLOORS }, (_, i) => towerMultiplier(level, i + 1));

export interface TowerState {
  level: TowerLevel;
  floor: number; // floors cleared
  safe: number[][]; // safe tile indexes per floor — hidden until the round ends
  picks: number[];
  finished: boolean;
  dead: boolean;
  cashed?: boolean;
}

export function towerStart(level: TowerLevel, rng: Rng): TowerState {
  const L = TOWER_LEVELS[level];
  if (!L) throw new GameError('Invalid difficulty');
  const safe = Array.from({ length: TOWER_FLOORS }, (_, f) => {
    const pool = Array.from({ length: L.tiles }, (_, i) => i);
    const out: number[] = [];
    for (let j = 0; j < L.safe; j++) out.push(pool.splice(Math.floor(rng(f * 4 + j) * pool.length), 1)[0]);
    return out.sort((a, b) => a - b);
  });
  return { level, floor: 0, safe, picks: [], finished: false, dead: false };
}

export function towerPick(s: TowerState, tile: number) {
  if (s.finished) throw new GameError('Round is over');
  const L = TOWER_LEVELS[s.level];
  if (!Number.isInteger(tile) || tile < 0 || tile >= L.tiles) throw new GameError('Invalid tile');
  s.picks.push(tile);
  if (!s.safe[s.floor].includes(tile)) {
    s.finished = true;
    s.dead = true;
    return;
  }
  s.floor++;
  if (s.floor >= TOWER_FLOORS) {
    s.finished = true;
    s.cashed = true;
  }
}

export function towerCashout(s: TowerState) {
  if (s.finished || s.floor < 1) throw new GameError('Clear at least one floor before cashing out');
  s.finished = true;
  s.cashed = true;
}

export function towerView(s: TowerState) {
  const L = TOWER_LEVELS[s.level];
  return {
    level: s.level,
    tiles: L.tiles,
    floors: TOWER_FLOORS,
    floor: s.floor,
    picks: s.picks,
    ladder: towerLadder(s.level),
    multiplier: towerMultiplier(s.level, s.floor),
    finished: s.finished,
    dead: s.dead,
    cashed: !!s.cashed,
    // cleared floors are revealed as you climb; the whole tower is revealed at the end
    safe: s.finished ? s.safe : s.safe.slice(0, s.floor),
    canCashout: !s.finished && s.floor > 0,
  };
}
