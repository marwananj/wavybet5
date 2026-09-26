import { useEffect } from 'react';
import { sfx } from '../casino/sound';
import { api } from './api';
import { subscribeLive } from './live';
import type { SportEvent } from './types';
import { isFav } from './favs';

/**
 * Goal alerts. Watches every live score pushed by the server; when a score goes up it:
 *  • fires a `wb-goal` window event (match cards flash "GOAL")
 *  • plays the stadium goal sound + toast for matches the player cares about:
 *    the match page they are on, picks in their betslip, and matches with open bets.
 */
export interface GoalDetail {
  id: string;
  side: 'home' | 'away';
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number | null;
}

const scores = new Map<string, [number, number]>();
const viewing = new Set<string>();
let openBetEvents = new Set<string>();

/** seed a score we fetched over REST, so the first push doesn't look like a goal */
export function primeScore(ev: Pick<SportEvent, 'id' | 'status' | 'homeScore' | 'awayScore'>) {
  if (ev.status === 'LIVE' && ev.homeScore != null && ev.awayScore != null && !scores.has(ev.id)) scores.set(ev.id, [ev.homeScore, ev.awayScore]);
}
export function watchEvent(id: string) {
  viewing.add(id);
  return () => void viewing.delete(id);
}

function slipEventIds() {
  try {
    return new Set<string>((JSON.parse(localStorage.getItem('wb_slip_v1') ?? '[]') as { eventId: string }[]).map((p) => p.eventId));
  } catch {
    return new Set<string>();
  }
}

type Toast = (kind: 'ok' | 'err' | 'info', msg: string) => void;

export function useGoalAlerts(toast: Toast, loggedIn: boolean) {
  // matches with open bets (refreshed every minute)
  useEffect(() => {
    if (!loggedIn) {
      openBetEvents = new Set();
      return;
    }
    let alive = true;
    const load = () =>
      api<{ bets: { selections: { eventId: string }[] }[] }>('/bets?status=open')
        .then((d) => alive && (openBetEvents = new Set(d.bets.flatMap((b) => b.selections.map((s) => s.eventId)))))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [loggedIn]);

  useEffect(
    () =>
      subscribeLive((events) => {
        const mine = slipEventIds();
        for (const e of events) {
          if (e.homeScore == null || e.awayScore == null) continue;
          const prev = scores.get(e.id);
          scores.set(e.id, [e.homeScore, e.awayScore]);
          if (e.status !== 'LIVE' || !prev) continue;
          const side = e.homeScore > prev[0] ? 'home' : e.awayScore > prev[1] ? 'away' : null;
          if (!side) continue;
          const detail: GoalDetail = {
            id: e.id, side, homeTeam: e.homeTeam, awayTeam: e.awayTeam, homeScore: e.homeScore, awayScore: e.awayScore, minute: e.liveMinute ?? null,
          };
          window.dispatchEvent(new CustomEvent<GoalDetail>('wb-goal', { detail }));
          if (viewing.has(e.id) || mine.has(e.id) || openBetEvents.has(e.id) || isFav('events', e.id)) {
            sfx.goal();
            toast('ok', `⚽ GOAL! ${e.homeTeam} ${e.homeScore}–${e.awayScore} ${e.awayTeam}${e.liveMinute != null ? ` (${e.liveMinute}')` : ''}`);
          }
        }
      }),
    [toast]
  );
}

/** subscribe a component to goal events (e.g. a card flashing) */
export function onGoal(fn: (d: GoalDetail) => void) {
  const h = (e: Event) => fn((e as CustomEvent<GoalDetail>).detail);
  window.addEventListener('wb-goal', h);
  return () => window.removeEventListener('wb-goal', h);
}
