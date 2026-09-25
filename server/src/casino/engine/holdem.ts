import type { Rng } from '../fair';
import type { Card } from './blackjack';
import { GameError } from './instant';

/**
 * Casino Hold'em — Texas Hold'em heads-up against the dealer, with the AA Bonus side bet.
 *
 *  1. Player places the Ante (1 unit) and optionally the AA Bonus.
 *  2. Player and dealer get two cards each, then the flop is dealt face up.
 *  3. Player FOLDS (loses the Ante) or CALLS (adds 2× the Ante).
 *  4. Turn + river are dealt, the dealer reveals. Best five of seven cards plays.
 *     • Dealer needs a pair of 4s or better to qualify.
 *     • Dealer doesn't qualify → Ante pays by the paytable, Call pushes.
 *     • Dealer qualifies, player wins → Ante pays by the paytable, Call pays 1:1.
 *     • Tie → Ante and Call push.  Dealer wins → Ante and Call lose.
 *  AA Bonus: player's two cards + the flop, pays for a pair of Aces or better — paid even if the player folds.
 *
 * A single 52-card deck is shuffled with Fisher–Yates from the provably fair RNG.
 * Deal order: player 0–1, dealer 2–3, board 4–8.
 */

export const HAND_NAMES = [
  'High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush', 'Royal flush',
] as const;
export const HC = { HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4, FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8, ROYAL: 9 } as const;

/** Ante pays (to 1), indexed by hand category */
export const ANTE_PAYS = [1, 1, 1, 1, 1, 2, 3, 10, 20, 100];
/** AA Bonus pays (to 1), indexed by hand category; pairs only qualify when they are Aces */
export const AA_PAYS = [0, 7, 7, 7, 7, 20, 30, 40, 50, 100];

export interface HandRank {
  cat: number;
  score: number; // comparable: higher is better
  name: string;
  best: number[]; // indexes (into the evaluated array) of the five cards that play
}

const hi = (c: Card) => (c.rank === 1 ? 14 : c.rank);

function eval5(cards: Card[]): { cat: number; score: number } {
  const r = cards.map(hi).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const uniq = [...new Set(r)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (r[0] - r[4] === 4) straightHigh = r[0];
    else if (r[0] === 14 && r[1] === 5) straightHigh = 5; // A-2-3-4-5 wheel
  }
  const counts = new Map<number, number>();
  for (const x of r) counts.set(x, (counts.get(x) ?? 0) + 1);
  // ranks ordered by (count desc, rank desc) → tiebreak kickers
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join('');
  let cat: number;
  let kick: number[];
  if (straightHigh && flush) {
    cat = straightHigh === 14 ? HC.ROYAL : HC.STRAIGHT_FLUSH;
    kick = [straightHigh];
  } else if (shape === '41') {
    cat = HC.QUADS;
    kick = groups.map((g) => g[0]);
  } else if (shape === '32') {
    cat = HC.FULL_HOUSE;
    kick = groups.map((g) => g[0]);
  } else if (flush) {
    cat = HC.FLUSH;
    kick = r;
  } else if (straightHigh) {
    cat = HC.STRAIGHT;
    kick = [straightHigh];
  } else if (shape === '311') {
    cat = HC.TRIPS;
    kick = groups.map((g) => g[0]);
  } else if (shape === '221') {
    cat = HC.TWO_PAIR;
    kick = groups.map((g) => g[0]);
  } else if (shape === '2111') {
    cat = HC.PAIR;
    kick = groups.map((g) => g[0]);
  } else {
    cat = HC.HIGH;
    kick = r;
  }
  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (kick[i] ?? 0);
  return { cat, score };
}

const COMBOS = new Map<number, number[][]>();
function combos(n: number): number[][] {
  let c = COMBOS.get(n);
  if (c) return c;
  c = [];
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let d = b + 1; d < n; d++)
        for (let e = d + 1; e < n; e++) for (let f = e + 1; f < n; f++) c.push([a, b, d, e, f]);
  COMBOS.set(n, c);
  return c;
}

/** Best five-card hand out of 5–7 cards. */
export function bestHand(cards: Card[]): HandRank {
  let best = { cat: -1, score: -1 };
  let idx: number[] = [];
  for (const cmb of combos(cards.length)) {
    const e = eval5(cmb.map((i) => cards[i]));
    if (e.score > best.score) {
      best = e;
      idx = cmb;
    }
  }
  return { ...best, name: HAND_NAMES[best.cat], best: idx };
}

/** Dealer qualifies with a pair of 4s or better. */
export function dealerQualifies(h: HandRank, cards: Card[]) {
  if (h.cat >= HC.TWO_PAIR) return true;
  if (h.cat < HC.PAIR) return false;
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(hi(c), (counts.get(hi(c)) ?? 0) + 1);
  const pairRank = Math.max(...[...counts.entries()].filter((e) => e[1] >= 2).map((e) => e[0]));
  return pairRank >= 4;
}

/** AA Bonus multiplier (to 1) for the player's two cards + flop; 0 = lose. */
export function aaBonusPays(five: Card[]) {
  const h = bestHand(five);
  if (h.cat === HC.PAIR) {
    const aces = five.filter((c) => c.rank === 1).length;
    return aces >= 2 ? AA_PAYS[HC.PAIR] : 0;
  }
  return AA_PAYS[h.cat];
}

export function shuffledDeck(rng: Rng): Card[] {
  const deck: Card[] = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push({ rank: r, suit: s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng(51 - i) * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export interface HoldemState {
  cards: Card[]; // 9 cards: player 0–1, dealer 2–3, board 4–8 — hidden until they are revealed
  aa: number; // AA Bonus stake, in ante units (0 = not played)
  finished: boolean;
  folded: boolean;
  called: boolean;
}

export interface HoldemOutcome {
  player: HandRank;
  dealer: HandRank;
  qualifies: boolean;
  winner: 'player' | 'dealer' | 'tie';
  ante: number; // returned units for the ante (incl. stake)
  call: number; // returned units for the call (incl. stake)
  aaPays: number; // AA pays (to 1)
  aaReturn: number; // returned units for the AA Bonus (incl. stake)
  stakeUnits: number;
  payoutUnits: number;
}

export function holdemStart(aa: number, rng: Rng): HoldemState {
  if (!(aa >= 0)) throw new GameError('Invalid AA Bonus');
  const deck = shuffledDeck(rng);
  return { cards: deck.slice(0, 9), aa, finished: false, folded: false, called: false };
}

export function holdemAct(s: HoldemState, action: string): { extraStake?: number } {
  if (s.finished) throw new GameError('Hand is over');
  if (action === 'fold') {
    s.folded = true;
    s.finished = true;
    return {};
  }
  if (action === 'call') {
    s.called = true;
    s.finished = true;
    return { extraStake: 2 };
  }
  throw new GameError('Unknown action');
}

export function holdemOutcome(s: HoldemState): HoldemOutcome {
  const P = [s.cards[0], s.cards[1], ...s.cards.slice(4, 9)];
  const Dl = [s.cards[2], s.cards[3], ...s.cards.slice(4, 9)];
  const player = bestHand(P);
  const dealer = bestHand(Dl);
  const qualifies = dealerQualifies(dealer, Dl);
  const winner = player.score > dealer.score ? 'player' : player.score < dealer.score ? 'dealer' : 'tie';
  const aaPays = s.aa > 0 ? aaBonusPays([s.cards[0], s.cards[1], ...s.cards.slice(4, 7)]) : 0;
  const aaReturn = aaPays > 0 ? s.aa * (1 + aaPays) : 0;
  let ante = 0;
  let call = 0;
  if (s.called) {
    if (!qualifies) {
      ante = 1 + ANTE_PAYS[player.cat];
      call = 2;
    } else if (winner === 'player') {
      ante = 1 + ANTE_PAYS[player.cat];
      call = 4;
    } else if (winner === 'tie') {
      ante = 1;
      call = 2;
    }
  }
  const stakeUnits = 1 + (s.called ? 2 : 0) + s.aa;
  return { player, dealer, qualifies, winner, ante, call, aaPays, aaReturn, stakeUnits, payoutUnits: ante + call + aaReturn };
}

export function holdemView(s: HoldemState) {
  const c = s.cards;
  const flop = c.slice(4, 7);
  const base = {
    player: [c[0], c[1]],
    aa: s.aa,
    finished: s.finished,
    folded: s.folded,
    called: s.called,
    playerNow: bestHand([c[0], c[1], ...flop]).name,
    aaPays: s.aa > 0 ? aaBonusPays([c[0], c[1], ...flop]) : 0,
  };
  if (!s.finished) return { ...base, board: flop, dealer: null };
  const o = holdemOutcome(s);
  return {
    ...base,
    board: c.slice(4, 9),
    dealer: [c[2], c[3]],
    outcome: {
      playerHand: o.player.name,
      dealerHand: o.dealer.name,
      // best five as indexes into [hole0, hole1, board0..4]
      playerBest: o.player.best,
      dealerBest: o.dealer.best,
      qualifies: o.qualifies,
      winner: o.winner,
      ante: o.ante,
      call: o.call,
      aaReturn: o.aaReturn,
      stakeUnits: o.stakeUnits,
      payoutUnits: o.payoutUnits,
    },
  };
}
