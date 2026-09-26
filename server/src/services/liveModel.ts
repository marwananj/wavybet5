import { config } from '../config';
import type { OutcomeIn } from './markets';

/**
 * In-play 1st-half markets when the live feed doesn't price them.
 * Fits the remaining-match goal rates (Poisson) to the live match-result and total-goals prices,
 * then projects the rest of the first half (≈45% of a match's goals are scored before the break).
 */
const MAXG = 12;
function pmf(l: number) {
  const p: number[] = [];
  let v = Math.exp(-l);
  for (let k = 0; k <= MAXG; k++) {
    p.push(v);
    v = (v * l) / (k + 1);
  }
  return p;
}

/** P(home win, draw, away win) given the current score and remaining Poisson rates */
function result(h: number, a: number, lh: number, la: number) {
  const ph = pmf(lh);
  const pa = pmf(la);
  let w = 0;
  let d = 0;
  let l = 0;
  for (let i = 0; i <= MAXG; i++)
    for (let j = 0; j <= MAXG; j++) {
      const p = ph[i] * pa[j];
      const diff = h + i - (a + j);
      if (diff > 0) w += p;
      else if (diff === 0) d += p;
      else l += p;
    }
  return [w, d, l];
}
function overProb(already: number, total: number, line: number) {
  const need = Math.floor(line - already) + 1; // goals still needed to go over
  if (need <= 0) return 1;
  const p = pmf(total);
  let under = 0;
  for (let k = 0; k < need && k <= MAXG; k++) under += p[k];
  return 1 - under;
}

function bisect(f: (x: number) => number, lo: number, hi: number) {
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (f(m) > 0) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
}

const fair = (prices: number[]) => {
  const inv = prices.map((p) => 1 / p);
  const s = inv.reduce((a, b) => a + b, 0);
  return inv.map((x) => x / s);
};
const priceOf = (p: number) => {
  const raw = 1 / (p * (1 + config.liveMargin));
  return Math.min(51, Math.max(1.01, Math.floor(raw * 100) / 100));
};

export function modelFirstHalf(opts: {
  minute: number;
  home: string;
  away: string;
  score: [number, number];
  htScore?: [number, number]; // current score IS the 1st-half score before the break
  h2h: { home: number; draw: number; away: number };
  totals?: { line: number; over: number; under: number };
}): { ht_h2h: OutcomeIn[]; ht_totals: OutcomeIn[] } | null {
  const { minute, score } = opts;
  if (minute >= 43) return null;
  const [h, a] = score;
  const remMatch = Math.max(1, 90 - minute);
  // expected goals left in the match
  let T = 2.7 * (remMatch / 90);
  if (opts.totals) {
    const [po] = fair([opts.totals.over, opts.totals.under]);
    const f = (t: number) => overProb(h + a, t, opts.totals!.line) - po;
    if (f(0.01) < 0 && f(8) > 0) T = bisect(f, 0.01, 8);
  }
  // split between the teams to match the live 1X2
  const [pw, , pl] = fair([opts.h2h.home, opts.h2h.draw, opts.h2h.away]);
  const target = pw - pl;
  const g = (r: number) => {
    const [w, , l] = result(h, a, T * r, T * (1 - r));
    return w - l - target;
  };
  const r = g(0.02) < 0 && g(0.98) > 0 ? bisect(g, 0.02, 0.98) : 0.5;
  const lh = T * r;
  const la = T * (1 - r);
  // share of the remaining goals that fall before half-time
  const rem1 = Math.max(0, 45 - minute);
  const w1 = rem1 * (0.45 / 45);
  const f1 = w1 / (w1 + 0.55);
  const [hw, hd, hl] = result(h, a, lh * f1, la * f1);
  const ht_h2h: OutcomeIn[] = [
    { code: 'home', name: opts.home, price: priceOf(hw), suspended: hw < 0.01 || hw > 0.985 },
    { code: 'draw', name: 'Draw', price: priceOf(hd), suspended: hd < 0.01 || hd > 0.985 },
    { code: 'away', name: opts.away, price: priceOf(hl), suspended: hl < 0.01 || hl > 0.985 },
  ];
  const ht_totals: OutcomeIn[] = [];
  const now = h + a;
  const tot1 = (lh + la) * f1;
  for (const line of [now + 0.5, now + 1.5]) {
    if (line > 4.5) continue;
    const po = overProb(now, tot1, line);
    if (po < 0.03 || po > 0.97) continue;
    ht_totals.push({ code: `over_${line}`, name: `Over ${line}`, price: priceOf(po), point: line });
    ht_totals.push({ code: `under_${line}`, name: `Under ${line}`, price: priceOf(1 - po), point: line });
  }
  return { ht_h2h, ht_totals };
}
