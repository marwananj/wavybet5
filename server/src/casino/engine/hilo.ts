import type { Rng } from '../fair';
import { floor4, GameError } from './instant';
import type { Card } from './blackjack';

/**
 * HiLo — infinite deck. Guess whether the next card is higher or lower.
 *  • 2…Q: "higher or same" (p = (14−r)/13) or "lower or same" (p = r/13)
 *  • A:   "higher" (p = 12/13) or "same" (p = 1/13)
 *  • K:   "lower"  (p = 12/13) or "same" (p = 1/13)
 * Each correct guess multiplies the running multiplier by 0.99 / p (1% edge per guess).
 * Skip replaces the card without changing the multiplier. Cash out any time after a win.
 */
export const HILO_EDGE = 0.01;
export type HiloChoice = 'higher' | 'lower' | 'same';

export interface HiloStep {
  card: Card;
  choice?: HiloChoice | 'skip';
  correct?: boolean;
  multiplier?: number;
}
export interface HiloState {
  cursor: number;
  history: HiloStep[];
  multiplier: number;
  wins: number;
  finished: boolean;
  lost: boolean;
}

const cardAt = (rng: Rng, i: number): Card => {
  const n = Math.floor(rng(i) * 52);
  return { rank: (n % 13) + 1, suit: Math.floor(n / 13) };
};

export function hiloOptions(rank: number) {
  const opts: { choice: HiloChoice; label: string; p: number; multiplier: number }[] = [];
  const add = (choice: HiloChoice, label: string, p: number) => opts.push({ choice, label, p, multiplier: floor4((1 - HILO_EDGE) / p) });
  if (rank === 1) {
    add('higher', 'Higher', 12 / 13);
    add('same', 'Same', 1 / 13);
  } else if (rank === 13) {
    add('lower', 'Lower', 12 / 13);
    add('same', 'Same', 1 / 13);
  } else {
    add('higher', 'Higher or same', (14 - rank) / 13);
    add('lower', 'Lower or same', rank / 13);
  }
  return opts;
}

function wins(choice: HiloChoice, from: number, to: number) {
  if (choice === 'same') return to === from;
  if (from === 1 && choice === 'higher') return to > from;
  if (from === 13 && choice === 'lower') return to < from;
  return choice === 'higher' ? to >= from : to <= from;
}

export function hiloStart(rng: Rng): HiloState {
  return { cursor: 1, history: [{ card: cardAt(rng, 0) }], multiplier: 1, wins: 0, finished: false, lost: false };
}

export function hiloGuess(s: HiloState, choice: HiloChoice, rng: Rng) {
  if (s.finished) throw new GameError('Round is over');
  const cur = s.history[s.history.length - 1].card;
  const opt = hiloOptions(cur.rank).find((o) => o.choice === choice);
  if (!opt) throw new GameError('Invalid guess for this card');
  const next = cardAt(rng, s.cursor++);
  const ok = wins(choice, cur.rank, next.rank);
  s.history[s.history.length - 1].choice = choice;
  if (ok) {
    s.multiplier = floor4(s.multiplier * opt.multiplier);
    s.wins++;
    s.history.push({ card: next, correct: true, multiplier: s.multiplier });
  } else {
    s.history.push({ card: next, correct: false });
    s.finished = true;
    s.lost = true;
  }
}

export function hiloSkip(s: HiloState, rng: Rng) {
  if (s.finished) throw new GameError('Round is over');
  if (s.history.length > 200) throw new GameError('Skip limit reached');
  s.history[s.history.length - 1].choice = 'skip';
  s.history.push({ card: cardAt(rng, s.cursor++), multiplier: s.multiplier });
}

export function hiloView(s: HiloState) {
  const cur = s.history[s.history.length - 1].card;
  return {
    history: s.history,
    current: cur,
    multiplier: s.multiplier,
    wins: s.wins,
    finished: s.finished,
    lost: s.lost,
    options: s.finished ? [] : hiloOptions(cur.rank).map((o) => ({ ...o, next: floor4(s.multiplier * o.multiplier) })),
    canCashout: !s.finished && s.wins > 0,
  };
}
