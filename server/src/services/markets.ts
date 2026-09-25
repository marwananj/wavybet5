import { D, prisma } from '../lib/prisma';

/**
 * Market catalogue shared by the pre-match and in-play parsers.
 *
 * Keys stored in the database:
 *   h2h · double_chance · btts · totals (several lines) ·
 *   ht_h2h · ht_totals (1st half) · correct_score · corners_totals · corners_h2h
 * Line markets use line-specific outcome codes (over_2.5 / under_2.5) so a bet can never move lines.
 */
export type MarketKey =
  | 'h2h' | 'double_chance' | 'btts' | 'totals' | 'ht_h2h' | 'ht_totals' | 'correct_score' | 'corners_totals' | 'corners_h2h';

export const MARKET_ORDER: MarketKey[] = ['h2h', 'double_chance', 'totals', 'btts', 'ht_h2h', 'ht_totals', 'correct_score', 'corners_totals', 'corners_h2h'];

/** Map a provider bet name (pre-match or live, any bookmaker spelling) to one of our markets. */
export function classifyBet(rawName: string): MarketKey | null {
  const n = rawName.trim().toLowerCase().replace(/\s+/g, ' ');
  const has = (...w: string[]) => w.some((x) => n.includes(x));
  const half = has('first half', '1st half', 'half time', 'halftime', 'half-time', '(1st', '- 1st');
  const second = has('second half', '2nd half');
  const noise = has('team', 'home', 'away', 'asian', 'handicap', 'odd/even', 'odd / even', 'exactly', 'range', 'minute', 'card', 'booking',
    'penalt', 'scorer', 'win to nil', 'clean sheet', 'margin', 'next', 'last', 'first to', 'race', 'double result', '/full', 'result/',
    'result /', 'draw no bet', 'extra time', 'highest');

  if (has('corner')) {
    if (half || second || has('asian', 'handicap', 'team', 'home', 'away', 'race', 'first', 'last', 'odd', 'range', 'exact')) return null;
    if (has('1x2', 'winner', 'most corners', 'corners result')) return 'corners_h2h';
    if (has('over', 'under', 'total', 'match corners')) return 'corners_totals';
    return null;
  }
  // exact full-match names first ("Both Teams Score" contains "team", which the noise filter rejects)
  if (!half && !second) {
    if (/^both teams (to )?score$/.test(n)) return 'btts';
    if (/^double chance$/.test(n)) return 'double_chance';
  }
  if (second || noise) return null;

  if (half) {
    if (/^(first half winner|1st half winner|half time result|halftime result|1x2 - first half|1x2 \(1st half\)|1st half result|1st half - 1x2|first half result|1x2 1st half)$/.test(n)) return 'ht_h2h';
    if (has('both')) return null;
    if (has('over/under', 'over under', 'goals', 'total')) return has('exact', 'score') ? null : 'ht_totals';
    return null;
  }
  if (/^(match winner|fulltime result|full time result|1x2|match result|result)$/.test(n)) return 'h2h';
  if (/^double chance$/.test(n)) return 'double_chance';
  if (/^both teams (to )?score$/.test(n)) return 'btts';
  if (/^(exact score|correct score|final score)$/.test(n)) return 'correct_score';
  if (/^(goals over\/under|over\/under|over\/under line|total goals|match goals|goals over under|over under)$/.test(n)) return 'totals';
  return null;
}

/** "Over 2.5" | value "Over" + handicap "2.5" → { side, line } */
export function parseLine(value: string, handicap?: string | null) {
  const m = String(value).trim().match(/^(over|under)\s*([\d.]+)?$/i);
  if (!m) return null;
  const line = Number(handicap ?? m[2]);
  if (!Number.isFinite(line)) return null;
  return { side: m[1].toLowerCase() as 'over' | 'under', line };
}

/** "2:1" / "2-1" → [2, 1] */
export function parseScore(value: string): [number, number] | null {
  const m = String(value).trim().match(/^(\d{1,2})\s*[-:]\s*(\d{1,2})$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** 3-way label → home/draw/away */
export function side3(value: string): 'home' | 'draw' | 'away' | null {
  const v = String(value).trim().toLowerCase();
  if (v === 'home' || v === '1') return 'home';
  if (v === 'draw' || v === 'x') return 'draw';
  if (v === 'away' || v === '2') return 'away';
  return null;
}

export function dcCode(value: string): 'home_draw' | 'home_away' | 'draw_away' | null {
  const v = String(value).trim().toLowerCase().replace(/\s/g, '');
  if (v === 'home/draw' || v === '1x' || v === '1/x') return 'home_draw';
  if (v === 'home/away' || v === '12' || v === '1/2') return 'home_away';
  if (v === 'draw/away' || v === 'x2' || v === 'x/2') return 'draw_away';
  return null;
}

/* ───────────────────────── efficient persistence ─────────────────────────
 * The in-play job reprices every live match every few seconds; only rows that actually changed are
 * written (in-memory cache of the last written state), new rows are batch-inserted. */

export interface OutcomeIn {
  code: string;
  name: string;
  price: number;
  point?: number | null;
  suspended?: boolean;
}
const marketIds = new Map<string, string>();
const lastState = new Map<string, string>(); // marketId|code -> fingerprint
const fp = (o: OutcomeIn) => `${o.name}|${o.price}|${o.point ?? ''}|${o.suspended ? 1 : 0}|1`;

export async function saveMarket(eventId: string, key: string, outcomes: OutcomeIn[], suspended: boolean) {
  const mk = `${eventId}|${key}`;
  let marketId = marketIds.get(mk);
  if (!marketId) {
    const m = await prisma.market.upsert({ where: { eventId_key: { eventId, key } }, create: { eventId, key, suspended }, update: { suspended } });
    marketId = m.id as string;
    marketIds.set(mk, marketId);
    const rows = await prisma.outcome.findMany({ where: { marketId } });
    for (const r of rows) lastState.set(`${marketId}|${r.code}`, `${r.name}|${Number(r.price)}|${r.point == null ? '' : Number(r.point)}|${r.suspended ? 1 : 0}|${r.active ? 1 : 0}`);
  } else {
    const cur = lastState.get(`${marketId}|#market`);
    if (cur !== String(suspended)) await prisma.market.update({ where: { id: marketId }, data: { suspended } });
  }
  lastState.set(`${marketId}|#market`, String(suspended));

  const creates: OutcomeIn[] = [];
  for (const o of outcomes) {
    const k = `${marketId}|${o.code}`;
    const prev = lastState.get(k);
    const next = fp(o);
    if (prev === next) continue;
    if (prev === undefined) creates.push(o);
    else
      await prisma.outcome.update({
        where: { marketId_code: { marketId, code: o.code } },
        data: { name: o.name, price: D(o.price), point: o.point != null ? D(o.point) : null, suspended: !!o.suspended, active: true },
      });
    lastState.set(k, next);
  }
  if (creates.length) {
    await prisma.outcome.createMany({
      data: creates.map((o) => ({ marketId: marketId!, code: o.code, name: o.name, price: D(o.price), point: o.point != null ? D(o.point) : null, suspended: !!o.suspended })),
      skipDuplicates: true,
    });
  }
  // outcomes no longer offered disappear (e.g. a goal line that moved)
  const mid: string = marketId;
  const keep = new Set(outcomes.map((o) => o.code));
  const stale = [...lastState.keys()].filter((k) => k.startsWith(`${mid}|`) && !k.endsWith('#market') && !keep.has(k.slice(mid.length + 1)) && lastState.get(k)!.endsWith('|1'));
  if (stale.length) {
    await prisma.outcome.updateMany({ where: { marketId, code: { in: stale.map((k) => k.slice(marketId!.length + 1)) } }, data: { active: false } });
    for (const k of stale) lastState.set(k, lastState.get(k)!.replace(/\|1$/, '|0'));
  }
}

/**
 * Something outside saveMarket() changed market.suspended directly (goal lock, feed missing, kick-off).
 * Drop the cached lock state so the next saveMarket() writes the real value again.
 */
export function invalidateMarkets(eventIds?: string[]) {
  for (const [k, id] of marketIds) {
    if (eventIds && !eventIds.some((e) => k.startsWith(`${e}|`))) continue;
    lastState.delete(`${id}|#market`);
  }
}

/** Forget cached ids for an event (after it finishes) so memory stays small. */
export function forgetEvent(eventId: string) {
  for (const [k, id] of marketIds) {
    if (!k.startsWith(`${eventId}|`)) continue;
    marketIds.delete(k);
    for (const s of [...lastState.keys()]) if (s.startsWith(`${id}|`)) lastState.delete(s);
  }
}

/* ───────────────────────── bet-type discovery (admin) ───────────────────────── */
export const seenBetTypes = new Map<string, { source: 'prematch' | 'live'; mapped: MarketKey | null; sample: string; count: number }>();
export function noteBetType(source: 'prematch' | 'live', name: string, sample: string) {
  const k = `${source}:${name}`;
  const cur = seenBetTypes.get(k);
  if (cur) cur.count++;
  else if (seenBetTypes.size < 600) seenBetTypes.set(k, { source, mapped: classifyBet(name), sample, count: 1 });
}
