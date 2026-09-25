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

