import type { Rng } from '../fair';
import { GameError } from './instant';

/**
 * Wavy Bomb — the fuse is lit and the multiplier climbs: m(t) = e^(RATE·t).
 * Cash out before the bomb explodes. The explosion point is fixed by the provably fair RNG when the
 * round starts: C = max(1, floor(0.99 / (1 − U) × 100) / 100)  →  P(C ≥ x) = 0.99 / x  →  99% RTP.
 * About 1 round in 100 explodes instantly at 1.00×.
 * The server clock is authoritative: a cash-out is valued at the moment it reaches the server.
 * Optional auto cash-out: if the target is reached before the explosion it is paid exactly.
 */
export const BOMB_RATE = 0.12; // per second → 2× ≈ 5.8 s, 10× ≈ 19 s, 100× ≈ 38 s
export const BOMB_MAX = 1000;
export const BOMB_EDGE = 0.01;

export const bombAt = (ms: number) => Math.floor(Math.exp((BOMB_RATE * Math.max(0, ms)) / 1000) * 100) / 100;
/** ms after the start when the multiplier reaches m */
export const bombTimeFor = (m: number) => (Math.log(m) / BOMB_RATE) * 1000;

export interface BombState {
  crash: number; // secret until the round ends
  startedAt: number; // server epoch ms
  auto: number | null;
  finished: boolean;
  cashedAt: number | null; // multiplier paid
  exploded: boolean;
}

export function bombStart(auto: number | null, rng: Rng): BombState {
  if (auto != null && !(auto >= 1.01 && auto <= BOMB_MAX)) throw new GameError(`Auto cash-out must be between 1.01× and ${BOMB_MAX}×`);
  const u = rng(0);
  const crash = Math.min(BOMB_MAX, Math.max(1, Math.floor(((1 - BOMB_EDGE) / (1 - u)) * 100) / 100));
  const s: BombState = { crash, startedAt: Date.now(), auto: auto != null ? Math.round(auto * 100) / 100 : null, finished: false, cashedAt: null, exploded: false };
  if (crash <= 1) {
    s.finished = true;
    s.exploded = true;
  }
  return s;
}

/** settle anything that has already happened on the server clock */
export function bombUpdate(s: BombState, now = Date.now()) {
  if (s.finished) return;
  const m = bombAt(now - s.startedAt);
  if (s.auto != null && s.auto <= s.crash && m >= s.auto) {
    s.finished = true;
    s.cashedAt = s.auto;
    return;
  }
  if (m >= s.crash) {
    s.finished = true;
    s.exploded = true;
  }
}

export function bombCashout(s: BombState, now = Date.now()) {
  bombUpdate(s, now);
  if (s.finished) return; // too late (exploded) or auto already paid
  const m = bombAt(now - s.startedAt);
  s.finished = true;
  s.cashedAt = Math.max(1, Math.min(m, s.crash));
}

export function bombView(s: BombState, now = Date.now()) {
  const elapsed = now - s.startedAt;
  return {
    elapsed,
    rate: BOMB_RATE,
    auto: s.auto,
    finished: s.finished,
    exploded: s.exploded,
    cashedAt: s.cashedAt,
    multiplier: s.finished ? (s.exploded ? s.crash : s.cashedAt ?? 1) : bombAt(elapsed),
    // revealed only when the round is over
    crash: s.finished ? s.crash : null,
  };
}
