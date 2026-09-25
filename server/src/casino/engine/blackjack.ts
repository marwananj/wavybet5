import type { Rng } from '../fair';
import { GameError } from './instant';

/**
 * Blackjack — infinite deck (each card drawn independently from the RNG, 52 equally likely).
 * Rules: dealer stands on all 17s, dealer peeks for blackjack with an Ace or ten showing,
 * blackjack pays 3:2, double on any first two cards, one split (split aces receive one card each),
 * no insurance, no surrender. House edge ≈ 0.5% with basic strategy.
 *
 * Amounts are in "units" of the base stake: a doubled hand has stake 2, a split creates a second
 * hand of stake 1. Payout units are converted to money by the service.
 */
export interface Card {
  rank: number; // 1 = A … 13 = K
  suit: number; // 0 ♠ 1 ♥ 2 ♦ 3 ♣
}
export interface BjHand {
  cards: Card[];
  stake: number;
  done: boolean;
  doubled?: boolean;
  fromSplit?: boolean;
  result?: 'win' | 'lose' | 'push' | 'blackjack' | 'bust';
  payout?: number;
}
export interface BjState {
  cursor: number;
  dealer: Card[];
  hands: BjHand[];
  active: number;
  split: boolean;
  finished: boolean;
}

const cardAt = (rng: Rng, i: number): Card => {
  const n = Math.floor(rng(i) * 52);
  return { rank: (n % 13) + 1, suit: Math.floor(n / 13) };
};
const draw = (s: BjState, rng: Rng) => cardAt(rng, s.cursor++);
const cardValue = (c: Card) => (c.rank === 1 ? 11 : Math.min(10, c.rank));

export function handValue(cards: Card[]) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === 1) aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 && total <= 21 };
}
const isBlackjack = (cards: Card[]) => cards.length === 2 && handValue(cards).total === 21;

export function bjStart(rng: Rng): BjState {
  const s: BjState = { cursor: 0, dealer: [], hands: [], active: 0, split: false, finished: false };
  const p1 = draw(s, rng);
  const d1 = draw(s, rng);
  const p2 = draw(s, rng);
  const d2 = draw(s, rng);
  s.hands.push({ cards: [p1, p2], stake: 1, done: false });
  s.dealer = [d1, d2];

  const dealerBj = isBlackjack(s.dealer);
  const playerBj = isBlackjack(s.hands[0].cards);
  const peek = cardValue(d1) >= 10; // Ace or ten-value showing → dealer checks for blackjack
  if ((peek && dealerBj) || playerBj) {
    const h = s.hands[0];
    h.done = true;
    if (playerBj && dealerBj) Object.assign(h, { result: 'push', payout: 1 });
    else if (playerBj) Object.assign(h, { result: 'blackjack', payout: 2.5 });
    else Object.assign(h, { result: 'lose', payout: 0 });
    s.finished = true;
  }
  return s;
}

export type BjAction = 'hit' | 'stand' | 'double' | 'split';

export function bjAvailable(s: BjState): BjAction[] {
  if (s.finished) return [];
  const h = s.hands[s.active];
  const acts: BjAction[] = ['hit', 'stand'];
  if (h.cards.length === 2 && !h.doubled) acts.push('double');
  if (!s.split && s.hands.length === 1 && h.cards.length === 2 && h.cards[0].rank === h.cards[1].rank) acts.push('split');
  return acts;
}

/** Returns the extra stake units the action costs (double/split = 1). */
export function bjAct(s: BjState, action: BjAction, rng: Rng): { extraStake: number } {
  if (s.finished) throw new GameError('Round is over');
  if (!bjAvailable(s).includes(action)) throw new GameError(`You can't ${action} now`);
  const h = s.hands[s.active];
  let extraStake = 0;

  if (action === 'hit') {
    h.cards.push(draw(s, rng));
    if (handValue(h.cards).total >= 21) h.done = true;
  } else if (action === 'stand') {
    h.done = true;
  } else if (action === 'double') {
    h.stake += 1;
    h.doubled = true;
    extraStake = 1;
    h.cards.push(draw(s, rng));
    h.done = true;
  } else if (action === 'split') {
    s.split = true;
    extraStake = 1;
    const [a, b] = h.cards;
    const aces = a.rank === 1;
    s.hands = [
      { cards: [a, draw(s, rng)], stake: 1, done: false, fromSplit: true },
      { cards: [b, draw(s, rng)], stake: 1, done: false, fromSplit: true },
    ];
    if (aces) s.hands.forEach((x) => (x.done = true)); // split aces: one card each
    else s.hands.forEach((x) => handValue(x.cards).total === 21 && (x.done = true));
  }

  // move to next open hand, or finish with the dealer
  while (s.active < s.hands.length && s.hands[s.active].done) s.active++;
  if (s.active >= s.hands.length) {
    s.active = s.hands.length - 1;
    dealerPlay(s, rng);
  }
  return { extraStake };
}

function dealerPlay(s: BjState, rng: Rng) {
  const live = s.hands.some((h) => handValue(h.cards).total <= 21);
  if (live) while (handValue(s.dealer).total < 17) s.dealer.push(draw(s, rng)); // stands on all 17s
  const d = handValue(s.dealer).total;
  const dealerBj = isBlackjack(s.dealer);
  for (const h of s.hands) {
    const p = handValue(h.cards).total;
    if (p > 21) Object.assign(h, { result: 'bust', payout: 0 });
    else if (dealerBj) Object.assign(h, { result: 'lose', payout: 0 });
    else if (d > 21 || p > d) Object.assign(h, { result: 'win', payout: h.stake * 2 });
    else if (p === d) Object.assign(h, { result: 'push', payout: h.stake });
    else Object.assign(h, { result: 'lose', payout: 0 });
  }
  s.finished = true;
}

export const bjTotals = (s: BjState) => ({
  stake: s.hands.reduce((a, h) => a + h.stake, 0),
  payout: s.hands.reduce((a, h) => a + (h.payout ?? 0), 0),
});

/** What the player may see (dealer hole card hidden while in play). */
export function bjView(s: BjState) {
  return {
    dealer: s.finished ? s.dealer : [s.dealer[0]],
    dealerHidden: !s.finished,
    dealerTotal: handValue(s.finished ? s.dealer : [s.dealer[0]]),
    hands: s.hands.map((h) => ({ ...h, total: handValue(h.cards) })),
    active: s.active,
    finished: s.finished,
    actions: bjAvailable(s),
  };
}
