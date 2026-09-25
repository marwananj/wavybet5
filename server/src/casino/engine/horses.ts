import crypto from 'crypto';
import { makeRng, type Rng } from '../fair';
import { floor4, GameError, type InstantResult } from './instant';

/**
 * Wavy Horse Racing — virtual 8-runner races.
 *
 * Race card: generated from PUBLIC information only (the player's client seed + the nonce of the
 * round that will be run), so the card and its odds are fixed and visible before the bet.
 * Result: the finishing order is drawn with the usual provably fair RNG (secret server seed) using a
 * Plackett–Luce model: 1st place is drawn by win chance, then 2nd among the rest, and so on.
 * Every price is 0.97 / true probability (rounded down), so each bet returns ≤ 97%.
 */
export const HORSE_RTP = 0.97;
export const RUNNERS = 8;
export const RACE_DISTANCE = 1200; // metres

const NAMES = [
  'Wavy Storm', 'Blue Thunder', 'Night Harbor', 'Crypto King', 'Desert Mirage', 'Silver Tide', 'Midnight Flyer', 'Golden Reef',
  'Neon Comet', 'Iron Duke', 'Lucky Streak', 'Ocean Drive', 'Red Baron', 'Sapphire Dream', 'Wild Current', 'Coral Queen',
  'Stormy Legacy', 'Velvet Rocket', 'Northern Surf', 'Moonlit Ride', 'Diamond Wave', 'Thunder Bay', 'Royal Breeze', 'Phantom Gale',
  'Scarlet Rush', 'Bold Horizon', 'Tidal Force', 'Echo Canyon', 'Shadow Dancer', 'Crimson Crest', 'Rapid Current', 'Starlight Run',
  'Harbor Lights', 'Cobalt Charm', 'Majestic Swell', 'Blazing Spray', 'Salt & Pepper', 'Beirut Nights', 'Cedar Spirit', 'Pearl Diver',
];
const JOCKEYS = [
  'L. Haddad', 'M. Costa', 'J. Rivers', 'A. Karam', 'S. Moreau', 'T. Brennan', 'R. Silva', 'N. Okafor', 'D. Laurent', 'K. Tanaka',
  'P. Novak', 'E. Walsh', 'F. Russo', 'H. Mansour', 'B. Doyle', 'C. Ortega',
];
const SILK_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#9333ea', '#0891b2', '#f8fafc', '#111827', '#ea580c', '#db2777', '#65a30d', '#facc15'];
export const SILK_PATTERNS = ['plain', 'hoops', 'stripes', 'chevron', 'sash', 'stars', 'halves', 'diamonds'] as const;

export interface Runner {
  no: number; // saddle cloth 1‥8
  name: string;
  jockey: string;
  silks: { c1: string; c2: string; pattern: (typeof SILK_PATTERNS)[number] };
  form: string;
  age: number;
  weight: number; // kg
  style: number; // running style −1 (closer) … 1 (front runner) — used for the race animation
  p: number; // true win probability
  win: number; // decimal odds
  place: number; // top 3
}
export interface RaceCard {
  id: string;
  race: number;
  distance: number;
  runners: Runner[];
  forecast: number[][]; // [first][second] decimal odds, 0 on the diagonal
  quinella: number[][]; // symmetric
}

const price = (p: number) => Math.min(5000, Math.max(1.01, Math.floor((HORSE_RTP / p) * 100) / 100));

/** P(i finishes in the first 3) under Plackett–Luce */
function top3(p: number[], i: number) {
  let s = p[i];
  for (let j = 0; j < p.length; j++) {
    if (j === i) continue;
    s += p[j] * (p[i] / (1 - p[j]));
    for (let k = 0; k < p.length; k++) {
      if (k === i || k === j) continue;
      s += p[j] * (p[k] / (1 - p[j])) * (p[i] / (1 - p[j] - p[k]));
    }
  }
  return s;
}
export const forecastP = (p: number[], a: number, b: number) => p[a] * (p[b] / (1 - p[a]));

export function makeCard(clientSeed: string, nonce: number): RaceCard {
  const r: Rng = makeRng({ serverSeed: 'wavy-horse-card', clientSeed, nonce });
  let c = 0;
  const next = () => r(c++);
  // pick 8 distinct names
  const pool = [...NAMES];
  const names = Array.from({ length: RUNNERS }, () => pool.splice(Math.floor(next() * pool.length), 1)[0]);
  // ability ratings → win chances (a clear favourite or two, some long shots)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, next()))) * Math.cos(2 * Math.PI * next());
  let raw = names.map(() => Math.exp(gauss() * 0.62));
  const sum0 = raw.reduce((a, b) => a + b, 0);
  let p = raw.map((x) => x / sum0);
  // keep every runner between 2.5% and 42%
  for (let it = 0; it < 6; it++) {
    p = p.map((x) => Math.min(0.42, Math.max(0.025, x)));
    const s = p.reduce((a, b) => a + b, 0);
    p = p.map((x) => x / s);
  }
  raw = p;
  const runners: Runner[] = names.map((name, i) => {
    const c1 = SILK_COLORS[Math.floor(next() * SILK_COLORS.length)];
    let c2 = SILK_COLORS[Math.floor(next() * SILK_COLORS.length)];
    if (c2 === c1) c2 = c1 === '#f8fafc' ? '#111827' : '#f8fafc';
    const form = Array.from({ length: 5 }, () => {
      const f = next();
      const good = raw[i] * RUNNERS; // >1 = better than average
      const pos = Math.min(9, Math.max(1, Math.round(1 + f * 8 / Math.max(0.5, good))));
      return pos === 9 ? '0' : String(pos);
    }).join('');
    return {
      no: i + 1,
      name,
      jockey: JOCKEYS[Math.floor(next() * JOCKEYS.length)],
      silks: { c1, c2, pattern: SILK_PATTERNS[Math.floor(next() * SILK_PATTERNS.length)] },
      form,
      age: 3 + Math.floor(next() * 5),
      weight: 54 + Math.floor(next() * 8),
      style: Math.round((next() * 2 - 1) * 100) / 100,
      p: raw[i],
      win: price(raw[i]),
      place: price(top3(raw, i)),
    };
  });
  const forecast = raw.map((_, a) => raw.map((__, b) => (a === b ? 0 : price(forecastP(raw, a, b)))));
  const quinella = raw.map((_, a) => raw.map((__, b) => (a === b ? 0 : price(forecastP(raw, a, b) + forecastP(raw, b, a)))));
  const id = crypto.createHash('sha256').update(`${clientSeed}:${nonce}`).digest('hex').slice(0, 16);
  return { id, race: nonce + 1, distance: RACE_DISTANCE, runners, forecast, quinella };
}

export type HorseBetType = 'win' | 'place' | 'forecast' | 'quinella';
export interface HorseBet {
  type: HorseBetType;
  horses: number[]; // runner indexes (0‥7)
  amount: number;
}

export function oddsFor(card: RaceCard, b: HorseBet) {
  const [a, c] = b.horses;
  switch (b.type) {
    case 'win':
      return card.runners[a].win;
    case 'place':
      return card.runners[a].place;
    case 'forecast':
      return card.forecast[a][c];
    case 'quinella':
      return card.quinella[a][c];
  }
}

export function validateHorseBets(bets: HorseBet[]) {
  if (!bets.length || bets.length > 30) throw new GameError('Place between 1 and 30 bets');
  const seen = new Set<string>();
  for (const b of bets) {
    const need = b.type === 'win' || b.type === 'place' ? 1 : 2;
    if (!Array.isArray(b.horses) || b.horses.length !== need) throw new GameError('Invalid selection');
    if (b.horses.some((h) => !Number.isInteger(h) || h < 0 || h >= RUNNERS)) throw new GameError('Invalid runner');
    if (need === 2 && b.horses[0] === b.horses[1]) throw new GameError('Pick two different runners');
    if (!(b.amount > 0)) throw new GameError('Invalid stake');
    const key = `${b.type}:${b.type === 'quinella' ? [...b.horses].sort().join('-') : b.horses.join('-')}`;
    if (seen.has(key)) throw new GameError('Duplicate selection');
    seen.add(key);
  }
}

/** Plackett–Luce finishing order + winning margins (in lengths) for the replay */
export function runRace(card: RaceCard, rng: Rng) {
  const left = card.runners.map((_, i) => i);
  const order: number[] = [];
  for (let pos = 0; pos < RUNNERS; pos++) {
    const tot = left.reduce((a, i) => a + card.runners[i].p, 0);
    let x = rng(pos) * tot;
    let pick = left[left.length - 1];
    for (const i of left) {
      if ((x -= card.runners[i].p) < 0) {
        pick = i;
        break;
      }
    }
    order.push(pick);
    left.splice(left.indexOf(pick), 1);
  }
  // margins behind the horse in front: short heads to a few lengths
  const margins = order.map((_, i) => (i === 0 ? 0 : Math.round((0.05 + Math.pow(rng(8 + i), 2) * 3.2) * 100) / 100));
  return { order, margins, time: Math.round((69 + rng(20) * 3) * 100) / 100 };
}

export function playHorses(p: { bets: HorseBet[]; cardId: string }, card: RaceCard, rng: Rng): InstantResult {
  if (p.cardId !== card.id) throw new GameError('The race card changed — odds were refreshed, please check your bets');
  validateHorseBets(p.bets);
  const total = p.bets.reduce((a, b) => a + b.amount, 0);
  const race = runRace(card, rng);
  const [first, second, third] = race.order;
  const results = p.bets.map((b) => {
    const odds = oddsFor(card, b);
    const [a, c] = b.horses;
    const won =
      b.type === 'win' ? first === a :
      b.type === 'place' ? [first, second, third].includes(a) :
      b.type === 'forecast' ? first === a && second === c :
      (first === a && second === c) || (first === c && second === a);
    return { ...b, odds, won, returned: won ? Math.round(b.amount * odds * 100) / 100 : 0 };
  });
  const returned = Math.round(results.reduce((a, r) => a + r.returned, 0) * 100) / 100;
  return {
    multiplier: floor4(returned / total),
    payout: returned,
    status: returned > 0 ? 'WON' : 'LOST',
    result: { race: card.race, cardId: card.id, ...race, bets: results, returned },
  };
}
