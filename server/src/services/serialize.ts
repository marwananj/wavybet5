import { Prisma } from '../lib/prisma';
import { eventOpen } from './open';
import { MARKET_ORDER } from './markets';

export const eventInclude = {
  markets: { include: { outcomes: { where: { active: true }, orderBy: { code: 'asc' as const } } } },
};

export type EvWithMarkets = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

const ORDER: Record<string, number> = { home: 0, draw: 1, away: 2, over: 0, under: 1, yes: 0, no: 1, home_draw: 0, home_away: 1, draw_away: 2 };
const outcomeSort = (a: { code: string; point: unknown }, b: { code: string; point: unknown }) => {
  const pa = a.point == null ? 0 : Number(a.point), pb = b.point == null ? 0 : Number(b.point);
  if (pa !== pb) return pa - pb;
  const cs = (c: string) => c.match(/^cs_(\d+)_(\d+)$/);
  const ca = cs(a.code), cb = cs(b.code);
  if (ca && cb) return Number(ca[1]) + Number(ca[2]) - (Number(cb[1]) + Number(cb[2])) || Number(ca[1]) - Number(cb[1]);
  return (ORDER[a.code.split('_')[0]] ?? ORDER[a.code] ?? 9) - (ORDER[b.code.split('_')[0]] ?? ORDER[b.code] ?? 9);
};

/**
 * `lite` (lists + live push): only the 1X2 market plus a market count — keeps list payloads small.
 * The match page loads the full book.
 */
export function serializeEvent(e: EvWithMarkets, opts: { lite?: boolean } = {}) {
  const open = eventOpen(e);
  const now = Date.now();
  const visible = e.markets.filter((m) => m.outcomes.length && (e.status === 'LIVE' || !m.suspended));
  const markets = (opts.lite ? visible.filter((m) => m.key === 'h2h') : visible)
    .sort((a, b) => ((MARKET_ORDER.indexOf(a.key as never) + 99) % 99) - ((MARKET_ORDER.indexOf(b.key as never) + 99) % 99));
  return {
    id: e.id,
    sportKey: e.sportKey,
    sportTitle: e.sportTitle,
    commenceTime: e.commenceTime,
    homeTeam: e.homeTeam,
    awayTeam: e.awayTeam,
    homeLogo: e.homeLogo,
    awayLogo: e.awayLogo,
    status: e.status,
    homeScore: e.homeScore,
    awayScore: e.awayScore,
    htHome: e.htHome ?? null,
    htAway: e.htAway ?? null,
    cornersHome: e.cornersHome ?? null,
    cornersAway: e.cornersAway ?? null,
    featured: e.featured,
    liveMinute: e.status === 'LIVE' ? e.liveElapsed : null,
    bettingOpen: open,
    marketCount: visible.reduce((n, m) => n + m.outcomes.length, 0),
    /** why a live event is locked, for the UI */
    lockReason:
      e.status !== 'LIVE' ? null
      : e.liveBlocked ? 'blocked'
      : e.liveSuspendedUntil && e.liveSuspendedUntil.getTime() > now ? 'goal'
      : !open ? 'waiting' : null,
    markets: markets.map((m) => ({
      id: m.id,
      key: m.key,
      suspended: m.suspended || !open,
      outcomes: [...m.outcomes]
        .sort(outcomeSort)
        .map((o) => ({ id: o.id, code: o.code, name: o.name, price: Number(o.price), point: o.point == null ? null : Number(o.point), suspended: o.suspended })),
    })),
  };
}
