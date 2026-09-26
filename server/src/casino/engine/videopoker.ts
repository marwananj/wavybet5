import type { Rng } from '../fair';
import type { Card } from './blackjack';
import { bestHand, HC, shuffledDeck } from './holdem';
import { GameError } from './instant';

/**
 * Video Poker — Jacks or Better, full-pay 9/6 table (99.54% RTP with optimal holds).
 * Deal five cards, hold any, draw once. The deck is shuffled once from the provably fair RNG:
 * cards 0–4 are dealt, replacements are taken in order from card 5 onward.
 */
export const VP_PAYS: { id: string; name: string; pays: number }[] = [
  { id: 'royal', name: 'Royal Flush', pays: 800 },
  { id: 'sflush', name: 'Straight Flush', pays: 50 },
  { id: 'quads', name: 'Four of a Kind', pays: 25 },
  { id: 'full', name: 'Full House', pays: 9 },
  { id: 'flush', name: 'Flush', pays: 6 },
  { id: 'straight', name: 'Straight', pays: 4 },
  { id: 'trips', name: 'Three of a Kind', pays: 3 },
  { id: 'twopair', name: 'Two Pair', pays: 2 },
  { id: 'jacks', name: 'Jacks or Better', pays: 1 },
];

export function vpEvaluate(hand: Card[]): { id: string | null; name: string; pays: number } {
  const h = bestHand(hand);
  const pick = (id: string) => VP_PAYS.find((p) => p.id === id)!;
  switch (h.cat) {
    case HC.ROYAL:
      return pick('royal');
    case HC.STRAIGHT_FLUSH:
      return pick('sflush');
    case HC.QUADS:
      return pick('quads');
    case HC.FULL_HOUSE:
      return pick('full');
    case HC.FLUSH:
      return pick('flush');
    case HC.STRAIGHT:
      return pick('straight');
    case HC.TRIPS:
      return pick('trips');
    case HC.TWO_PAIR:
      return pick('twopair');
    case HC.PAIR: {
      const counts = new Map<number, number>();
      for (const c of hand) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
      const pr = [...counts.entries()].find((e) => e[1] === 2)![0];
      if (pr === 1 || pr >= 11) return pick('jacks');
      return { id: null, name: 'Low pair', pays: 0 };
    }
    default:
      return { id: null, name: 'No win', pays: 0 };
  }
}

export interface VpState {
  deck: Card[];
  hand: Card[];
  held: boolean[];
  finished: boolean;
  result: { id: string | null; name: string; pays: number } | null;
}

export function vpStart(rng: Rng): VpState {
  const deck = shuffledDeck(rng);
  return { deck, hand: deck.slice(0, 5), held: [false, false, false, false, false], finished: false, result: null };
}

export function vpDraw(s: VpState, held: unknown) {
  if (s.finished) throw new GameError('Hand is over');
  if (!Array.isArray(held) || held.length !== 5 || !held.every((h) => typeof h === 'boolean')) throw new GameError('Invalid holds');
  let next = 5;
  s.held = held as boolean[];
  s.hand = s.hand.map((c, i) => (s.held[i] ? c : s.deck[next++]));
  s.finished = true;
  s.result = vpEvaluate(s.hand);
}

export function vpView(s: VpState) {
  return {
    hand: s.hand,
    held: s.held,
    finished: s.finished,
    result: s.result,
    // current hand strength before the draw (helps the player)
    now: s.finished ? null : vpEvaluate(s.hand),
    paytable: VP_PAYS,
  };
}
