import { config } from '../config';

/* ------------------------- Is this price bettable now? ------------------------- */

export type EvLike = {
  status: string;
  commenceTime: Date;
  liveBlocked?: boolean;
  liveUpdatedAt?: Date | null;
  liveSuspendedUntil?: Date | null;
};

export function eventOpen(ev: EvLike, now = new Date()) {
  if (ev.status === 'UPCOMING') return ev.commenceTime > now;
  if (ev.status !== 'LIVE' || !config.liveBetting || config.provider !== 'apifootball') return false;
  if (ev.liveBlocked) return false;
  if (!ev.liveUpdatedAt || now.getTime() - ev.liveUpdatedAt.getTime() > config.liveStaleMs) return false;
  if (ev.liveSuspendedUntil && ev.liveSuspendedUntil > now) return false;
  return true;
}

export function outcomeOpen(
  o: { active: boolean; suspended?: boolean; market: { suspended: boolean; event: EvLike } },
  now = new Date()
) {
  return o.active && !o.suspended && !o.market.suspended && eventOpen(o.market.event, now);
}


/**
 * "Really in play right now": LIVE, kicked off less than 4 hours ago and still receiving score/odds
 * updates. Finished matches drop out of the live lists even before the result job has settled them.
 */
export const liveNowWhere = (now = new Date()) => {
  const fresh = new Date(now.getTime() - 6 * 60_000);
  return {
    status: 'LIVE' as const,
    commenceTime: { gte: new Date(now.getTime() - 4 * 3600_000) },
    AND: [{ OR: [{ lastScoreSync: { gte: fresh } }, { liveUpdatedAt: { gte: fresh } }, { NOT: { id: { startsWith: 'af_' } } }] }],
  };
};
