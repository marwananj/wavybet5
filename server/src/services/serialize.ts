import { Prisma } from '../lib/prisma';
import { eventOpen } from './open';

export const eventInclude = {
  markets: { include: { outcomes: { where: { active: true }, orderBy: { code: 'asc' as const } } } },
};

export type EvWithMarkets = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

const ORDER: Record<string, number> = { home: 0, draw: 1, away: 2, over: 0, under: 1, yes: 0, no: 1, home_draw: 0, home_away: 1, draw_away: 2 };
const ORDER_MARKETS = ['h2h', 'double_chance', 'totals', 'btts'];
export function serializeEvent(e: EvWithMarkets) {
  const open = eventOpen(e);
  const now = Date.now();
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
    featured: e.featured,
    liveMinute: e.status === 'LIVE' ? e.liveElapsed : null,
    bettingOpen: open,
    /** why a live event is locked, for the UI */
    lockReason:
      e.status !== 'LIVE' ? null
      : e.liveBlocked ? 'blocked'
      : e.liveSuspendedUntil && e.liveSuspendedUntil.getTime() > now ? 'goal'
      : !open ? 'waiting' : null,
    markets: e.markets
      // before kick-off hide markets we pulled; in play show them locked
      .filter((m) => m.outcomes.length && (e.status === 'LIVE' || !m.suspended))
      .sort((a, b) => ((ORDER_MARKETS.indexOf(a.key) + 99) % 99) - ((ORDER_MARKETS.indexOf(b.key) + 99) % 99))
      .map((m) => ({
        id: m.id,
        key: m.key,
        suspended: m.suspended || !open,
        outcomes: m.outcomes
          .sort((a, b) => (ORDER[a.code.split('_')[0]] ?? ORDER[a.code] ?? 9) - (ORDER[b.code.split('_')[0]] ?? ORDER[b.code] ?? 9))
          .map((o) => ({ id: o.id, code: o.code, name: o.name, price: Number(o.price), point: o.point == null ? null : Number(o.point), suspended: o.suspended })),
      })),
  };
}
