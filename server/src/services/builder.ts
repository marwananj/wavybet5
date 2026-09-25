import { config } from '../config';

/**
 * Bet Builder pricing — several selections from ONE match combined into one bet.
 *
 * Legs from the same match are correlated (Over 2.5 and Both Teams To Score tend to happen together),
 * so multiplying their prices would overpay. Instead we fit a goals model to the match's own prices:
 *   • home and away goals ~ Poisson(λh), Poisson(λa), fitted to the 1X2 and main goal-line prices
 *   • each team scores 45% of its goals in the 1st half, 55% in the 2nd (independent halves)
 *   • total corners ~ Poisson(λc) fitted to the corners line, independent of goals
 * The joint probability of all legs is summed exactly over every scoreline, and the price is
 * (1 − BUILDER_MARGIN) / P(all legs win).
 */

export interface BookOutcome {
  code: string;
  price: number;
  point: number | null;
}
export interface Book {
  [marketKey: string]: BookOutcome[];
}
export interface Leg {
  marketKey: string;
  code: string;
  point: number | null;
}

export const BUILDER_KEYS = ['h2h', 'double_chance', 'btts', 'totals', 'ht_h2h', 'ht_totals', 'correct_score', 'corners_totals'];
const H1 = 0.45;
const MAXG = 10;

const pmf = (l: number, n: number) => {
  const out: number[] = [];
  let p = Math.exp(-l);
  for (let k = 0; k <= n; k++) {
    out.push(p);
    p = (p * l) / (k + 1);
  }
  return out;
};

/** fair (margin-free) probabilities of a set of mutually exclusive outcomes */
const fair = (prices: number[]) => {
  const inv = prices.map((p) => 1 / p);
  const s = inv.reduce((a, b) => a + b, 0);
  return inv.map((x) => x / s);
};

function fullTime(lh: number, la: number) {
  const ph = pmf(lh, MAXG), pa = pmf(la, MAXG);
  let home = 0, draw = 0, away = 0;
  const tot = new Array(2 * MAXG + 1).fill(0);
  for (let i = 0; i <= MAXG; i++)
    for (let j = 0; j <= MAXG; j++) {
      const p = ph[i] * pa[j];
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
      tot[i + j] += p;
    }
  return { home, draw, away, tot };
}

export function fitGoals(book: Book) {
  const h2h = book.h2h;
  const byCode = (list: BookOutcome[] | undefined, c: string) => list?.find((o) => o.code === c)?.price;
  const hp = byCode(h2h, 'home'), dp = byCode(h2h, 'draw'), ap = byCode(h2h, 'away');
  if (!hp || !dp || !ap) return null;
  const [fh, fd, fa] = fair([hp, dp, ap]);
  // main goal line: the most balanced over/under pair
  let target: { line: number; pOver: number } | null = null;
  const tl = book.totals ?? [];
  const lines = [...new Set(tl.map((o) => o.point).filter((x): x is number => x != null))];
  let best = Infinity;
  for (const line of lines) {
    const o = tl.find((x) => x.point === line && x.code.startsWith('over'))?.price;
    const u = tl.find((x) => x.point === line && x.code.startsWith('under'))?.price;
    if (!o || !u || !Number.isInteger(line - 0.5)) continue;
    const d = Math.abs(o - u);
    if (d < best) {
      best = d;
      target = { line, pOver: fair([o, u])[0] };
    }
  }
  const err = (lh: number, la: number) => {
    const r = fullTime(lh, la);
    let e = (r.home - fh) ** 2 + (r.away - fa) ** 2 + (r.draw - fd) ** 2;
    if (target) {
      const over = r.tot.reduce((a, p, k) => (k > target!.line ? a + p : a), 0);
      e += 2 * (over - target.pOver) ** 2;
    }
    return e;
  };
  // coarse grid, then refine
  let bh = 1.3, ba = 1.1, be = Infinity;
  for (let lh = 0.15; lh <= 4.5; lh += 0.1)
    for (let la = 0.15; la <= 4.5; la += 0.1) {
      const e = err(lh, la);
      if (e < be) [bh, ba, be] = [lh, la, e];
    }
  for (let step = 0.05; step >= 0.005; step /= 2) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const [dh, da] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const lh = bh + dh, la = ba + da;
        if (lh <= 0.05 || la <= 0.05) continue;
        const e = err(lh, la);
        if (e < be) {
          [bh, ba, be] = [lh, la, e];
          moved = true;
        }
      }
    }
  }
  return { lh: bh, la: ba, fitError: be };
}

export function fitCorners(book: Book) {
  const cl = book.corners_totals ?? [];
  let best: { line: number; pOver: number } | null = null;
  let d = Infinity;
  for (const line of new Set(cl.map((o) => o.point).filter((x): x is number => x != null))) {
    const o = cl.find((x) => x.point === line && x.code.startsWith('over'))?.price;
    const u = cl.find((x) => x.point === line && x.code.startsWith('under'))?.price;
    if (!o || !u) continue;
    if (Math.abs(o - u) < d) {
      d = Math.abs(o - u);
      best = { line, pOver: fair([o, u])[0] };
    }
  }
  if (!best) return null;
  // bisection on λ so that P(corners > line) matches
  let lo = 0.5, hi = 25;
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    const p = pmf(mid, 60);
    const under = p.slice(0, Math.floor(best.line) + 1).reduce((a, b) => a + b, 0);
    if (1 - under < best.pOver) lo = mid;
    else hi = mid;
  }
  return { lc: (lo + hi) / 2 };
}

type Goals = { h1: number; a1: number; h: number; a: number };
function goalPredicate(leg: Leg): ((g: Goals) => boolean) | null {
  const c = leg.code;
  const L = leg.point ?? NaN;
  switch (leg.marketKey) {
    case 'h2h':
      return c === 'home' ? (g) => g.h > g.a : c === 'away' ? (g) => g.h < g.a : (g) => g.h === g.a;
    case 'double_chance':
      return c === 'home_draw' ? (g) => g.h >= g.a : c === 'draw_away' ? (g) => g.h <= g.a : (g) => g.h !== g.a;
    case 'btts':
      return c === 'yes' ? (g) => g.h > 0 && g.a > 0 : (g) => !(g.h > 0 && g.a > 0);
    case 'totals':
      return c.startsWith('over') ? (g) => g.h + g.a > L : (g) => g.h + g.a < L;
    case 'ht_h2h':
      return c === 'home' ? (g) => g.h1 > g.a1 : c === 'away' ? (g) => g.h1 < g.a1 : (g) => g.h1 === g.a1;
    case 'ht_totals':
      return c.startsWith('over') ? (g) => g.h1 + g.a1 > L : (g) => g.h1 + g.a1 < L;
    case 'correct_score': {
      const m = c.match(/^cs_(\d+)_(\d+)$/);
      if (!m) return null;
      const x = Number(m[1]), y = Number(m[2]);
      return (g) => g.h === x && g.a === y;
    }
  }
  return null;
}

export class BuilderError extends Error {}

export function priceBuilder(book: Book, legs: Leg[], legPrices: number[]) {
  if (legs.length < 2) throw new BuilderError('Pick at least 2 selections');
  if (legs.length > 8) throw new BuilderError('A Bet Builder can have up to 8 selections');
  for (const l of legs) {
    if (!BUILDER_KEYS.includes(l.marketKey)) throw new BuilderError('This market is not available in Bet Builder');
    if (l.point != null && Number.isInteger(l.point)) throw new BuilderError('Whole-number lines cannot be used in Bet Builder');
  }
  const keyOf = (l: Leg) => `${l.marketKey}:${l.point ?? ''}`;
  if (new Set(legs.map(keyOf)).size !== legs.length) throw new BuilderError('Only one selection per market line');

  const goalLegs = legs.filter((l) => l.marketKey !== 'corners_totals');
  const cornerLegs = legs.filter((l) => l.marketKey === 'corners_totals');

  let pGoals = 1;
  if (goalLegs.length) {
    const fit = fitGoals(book);
    if (!fit) throw new BuilderError('Bet Builder is not available for this match yet');
    const preds = goalLegs.map(goalPredicate);
    if (preds.some((p) => !p)) throw new BuilderError('Unsupported selection');
    const h1 = pmf(fit.lh * H1, 8), a1 = pmf(fit.la * H1, 8), h2 = pmf(fit.lh * (1 - H1), 9), a2 = pmf(fit.la * (1 - H1), 9);
    let sum = 0;
    for (let i = 0; i <= 8; i++)
      for (let j = 0; j <= 8; j++) {
        const p1 = h1[i] * a1[j];
        if (p1 < 1e-12) continue;
        for (let k = 0; k <= 9; k++)
          for (let m = 0; m <= 9; m++) {
            const g = { h1: i, a1: j, h: i + k, a: j + m };
            if (preds.every((f) => f!(g))) sum += p1 * h2[k] * a2[m];
          }
      }
    pGoals = sum;
  }
  let pCorners = 1;
  if (cornerLegs.length) {
    const fit = fitCorners(book);
    if (!fit) throw new BuilderError('Corners are not available in Bet Builder for this match');
    const p = pmf(fit.lc, 60);
    pCorners = p.reduce((a, pk, k) => (cornerLegs.every((l) => (l.code.startsWith('over') ? k > l.point! : k < l.point!)) ? a + pk : a), 0);
  }
  const P = pGoals * pCorners;
  if (P < 0.0015) throw new BuilderError("These selections can't all happen together (or the combination is too unlikely)");
  if (P > 0.97) throw new BuilderError('This combination is almost certain — add something with a real price');
  let price = (1 - config.builderMargin) / P;
  // safety rail against a poor model fit: never above 1.5× the straight accumulator
  const accumulator = legPrices.reduce((a, b) => a * b, 1);
  price = Math.min(price, accumulator * 1.5, 1000);
  return { price: Math.max(1.01, Math.floor(price * 100) / 100), probability: P };
}
