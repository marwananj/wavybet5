/* Roulette bet model shared by the table, the racetrack and the result logic. */

export const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const color = (n: number) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

/** "straight:17" · "split:17-20" · "street:1-2-3" · "corner:1-2-4-5" · "line:1-…-6" · "red" · "dozen:2" · "column:3" */
export type BetKey = string;
export const INSIDE = ['split', 'street', 'corner', 'line'] as const;

export const k = {
  straight: (n: number) => `straight:${n}`,
  inside: (type: (typeof INSIDE)[number], nums: number[]) => `${type}:${[...nums].sort((a, b) => a - b).join('-')}`,
};

/** payout (to 1) shown in tooltips */
export const PAYS: Record<string, number> = { straight: 35, split: 17, street: 11, corner: 8, line: 5, red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1, dozen: 2, column: 2 };

export function covered(key: BetKey): number[] {
  const [t, v] = key.split(':');
  const all = Array.from({ length: 36 }, (_, i) => i + 1);
  switch (t) {
    case 'straight':
      return [Number(v)];
    case 'split':
    case 'street':
    case 'corner':
    case 'line':
      return v.split('-').map(Number);
    case 'red':
      return all.filter((n) => RED.has(n));
    case 'black':
      return all.filter((n) => !RED.has(n));
    case 'odd':
      return all.filter((n) => n % 2 === 1);
    case 'even':
      return all.filter((n) => n % 2 === 0);
    case 'low':
      return all.filter((n) => n <= 18);
    case 'high':
      return all.filter((n) => n >= 19);
    case 'dozen':
      return all.filter((n) => Math.ceil(n / 12) === Number(v));
    case 'column':
      return all.filter((n) => ((n - 1) % 3) + 1 === Number(v));
  }
  return [];
}

/** API payload for a key */
export function toApi(key: BetKey, amount: number) {
  const [type, v] = key.split(':');
  if ((INSIDE as readonly string[]).includes(type)) return { type, numbers: v.split('-').map(Number), amount };
  return { type, ...(v != null ? { value: Number(v) } : {}), amount };
}

/* ── inside-bet hotspots on the table ──
 * Abstract table coords: u runs along the table (0 = zero edge … 12 = column end),
 * v across it (0 = street edge … 3 = far edge). The layout maps them to % positions. */
export interface Hotspot {
  key: BetKey;
  u: number;
  v: number;
  kind: 'split' | 'street' | 'corner' | 'line';
}
export const HOTSPOTS: Hotspot[] = (() => {
  const out: Hotspot[] = [];
  for (let n = 1; n <= 36; n++) {
    const c = Math.floor((n - 1) / 3);
    const r = ((n - 1) % 3) + 1;
    if (n + 3 <= 36) out.push({ key: k.inside('split', [n, n + 3]), u: c + 1, v: r - 0.5, kind: 'split' });
    if (r < 3) out.push({ key: k.inside('split', [n, n + 1]), u: c + 0.5, v: r, kind: 'split' });
    if (r < 3 && n + 4 <= 36) out.push({ key: k.inside('corner', [n, n + 1, n + 3, n + 4]), u: c + 1, v: r, kind: 'corner' });
    if (r === 1) {
      out.push({ key: k.inside('street', [n, n + 1, n + 2]), u: c + 0.5, v: 0, kind: 'street' });
      if (c < 11) out.push({ key: k.inside('line', [n, n + 1, n + 2, n + 3, n + 4, n + 5]), u: c + 1, v: 0, kind: 'line' });
    }
  }
  for (let r = 1; r <= 3; r++) out.push({ key: k.inside('split', [0, r]), u: 0, v: r - 0.5, kind: 'split' });
  out.push({ key: k.inside('street', [0, 1, 2]), u: 0, v: 1, kind: 'street' });
  out.push({ key: k.inside('street', [0, 2, 3]), u: 0, v: 2, kind: 'street' });
  out.push({ key: k.inside('corner', [0, 1, 2, 3]), u: 0, v: 0, kind: 'corner' });
  return out;
})();

/* ── racetrack (French) bets — the standard chip patterns ── */
const sp = (a: number, b: number) => k.inside('split', [a, b]);
export const ANNOUNCED: Record<string, { name: string; chips: [BetKey, number][] }> = {
  voisins: {
    name: 'Voisins du zéro',
    chips: [
      [k.inside('street', [0, 2, 3]), 2],
      [sp(4, 7), 1],
      [sp(12, 15), 1],
      [sp(18, 21), 1],
      [sp(19, 22), 1],
      [sp(32, 35), 1],
      [k.inside('corner', [25, 26, 28, 29]), 2],
    ],
  },
  tiers: { name: 'Tiers du cylindre', chips: [[sp(5, 8), 1], [sp(10, 11), 1], [sp(13, 16), 1], [sp(23, 24), 1], [sp(27, 30), 1], [sp(33, 36), 1]] },
  orphelins: { name: 'Orphelins', chips: [[k.straight(1), 1], [sp(6, 9), 1], [sp(14, 17), 1], [sp(17, 20), 1], [sp(31, 34), 1]] },
  zero: { name: 'Jeu zéro', chips: [[sp(0, 3), 1], [sp(12, 15), 1], [k.straight(26), 1], [sp(32, 35), 1]] },
};
export const SECTION_NUMBERS: Record<string, number[]> = Object.fromEntries(
  Object.entries(ANNOUNCED).map(([id, a]) => [id, [...new Set(a.chips.flatMap(([key]) => covered(key)))]])
);

/** straight-up chips on n and `count` neighbours either side on the wheel */
export function neighbours(n: number, count: number): number[] {
  const i = ORDER.indexOf(n);
  return Array.from({ length: count * 2 + 1 }, (_, j) => ORDER[(i - count + j + 37 * 2) % 37]);
}
