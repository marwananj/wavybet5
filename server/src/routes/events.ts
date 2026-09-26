import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { asyncH, HttpError } from '../lib/http';
import { outcomeOpen } from '../services/open';
import { eventInclude, serializeEvent } from '../services/serialize';
import { addStreamClient } from '../services/stream';
import { prisma } from '../lib/prisma';
import { af } from '../services/apifootball';

const r = Router();

/** Server-Sent Events: live odds, scores and locks pushed the moment the server receives them. */
r.get('/live/stream', (req, res) => addStreamClient(req, res));


r.get(
  '/sports',
  asyncH(async (_req, res) => {
    const sports = await prisma.sport.findMany({ where: { enabled: true, provider: config.provider }, orderBy: [{ group: 'asc' }, { title: 'asc' }] });
    const counts = await prisma.event.groupBy({
      by: ['sportKey'],
      where: {
        OR: [
          { status: 'UPCOMING', commenceTime: { gt: new Date() } },
          { status: 'LIVE' },
        ],
      },
      _count: { _all: true },
    });
    const c = Object.fromEntries(counts.map((x) => [x.sportKey, x._count._all]));
    res.json({ sports: sports.map((s) => ({ key: s.key, group: s.group, title: s.title, count: c[s.key] ?? 0 })) });
  })
);

r.get(
  '/events',
  asyncH(async (req, res) => {
    const q = z
      .object({
        sport: z.string().optional(),
        group: z.string().optional(),
        status: z.enum(['upcoming', 'live', 'all']).default('upcoming'),
        q: z.string().max(60).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(60),
        ids: z.string().max(2000).optional(),
      })
      .parse(req.query);
    const now = new Date();
    // favourites: fetch exactly these matches (still open or live)
    if (q.ids) {
      const ids = q.ids.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 60);
      const favs = await prisma.event.findMany({
        where: { id: { in: ids }, status: { in: ['UPCOMING', 'LIVE'] } },
        include: eventInclude,
        orderBy: { commenceTime: 'asc' },
      });
      return res.json({ events: favs.map((e) => serializeEvent(e, { lite: true })) });
    }
    const events = await prisma.event.findMany({
      where: {
        ...(q.sport ? { sportKey: q.sport } : {}),
        sport: { enabled: true, provider: config.provider, ...(q.group ? { group: q.group } : {}) },
        ...(q.status === 'upcoming'
          ? { status: 'UPCOMING', commenceTime: { gt: now } }
          : q.status === 'live'
          ? { status: 'LIVE' }
          : { status: { in: ['UPCOMING', 'LIVE'] } }),
        ...(q.q
          ? { OR: [{ homeTeam: { contains: q.q, mode: 'insensitive' } }, { awayTeam: { contains: q.q, mode: 'insensitive' } }, { sportTitle: { contains: q.q, mode: 'insensitive' } }] }
          : {}),
      },
      include: eventInclude,
      orderBy: { commenceTime: 'asc' },
      take: q.limit,
    });
    res.json({ events: events.map((e) => serializeEvent(e, { lite: true })) });
  })
);

r.get(
  '/events/featured',
  asyncH(async (_req, res) => {
    const now = new Date();
    let events = await prisma.event.findMany({
      where: { featured: true, status: 'UPCOMING', commenceTime: { gt: now }, sport: { provider: config.provider } },
      include: eventInclude,
      orderBy: { commenceTime: 'asc' },
      take: 10,
    });
    if (events.length < 6) {
      const more = await prisma.event.findMany({
        where: { status: 'UPCOMING', commenceTime: { gt: now, lt: new Date(Date.now() + 3 * 86400_000) }, markets: { some: { key: 'h2h', suspended: false } }, sport: { provider: config.provider, enabled: true }, id: { notIn: events.map((e) => e.id) } },
        include: eventInclude,
        orderBy: { commenceTime: 'asc' },
        take: 10 - events.length,
      });
      events = [...events, ...more];
    }
    res.json({ events: events.map((e) => serializeEvent(e, { lite: true })) });
  })
);

r.get(
  '/events/:id',
  asyncH(async (req, res) => {
    const e = await prisma.event.findUnique({ where: { id: req.params.id }, include: eventInclude });
    if (!e) throw new HttpError(404, 'Event not found');
    res.json({ event: serializeEvent(e) });
  })
);

/* ───────────────────────────── match tracker ─────────────────────────────
 * Real match data for the pitch view: events (goals, cards, subs, VAR), live statistics
 * (possession, shots, corners…) and formations. One API call per watched match per TRACKER_CACHE_MS,
 * shared by every viewer. */
interface AfFull {
  fixture: { id: number; status: { short: string; long: string; elapsed: number | null; extra?: number | null }; venue?: { name?: string | null; city?: string | null }; referee?: string | null };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
  score: { halftime?: { home: number | null; away: number | null } };
  events?: { time: { elapsed: number; extra: number | null }; team: { id: number }; player: { name: string | null }; assist: { name: string | null }; type: string; detail: string; comments?: string | null }[];
  statistics?: { team: { id: number }; statistics: { type: string; value: number | string | null }[] }[];
  lineups?: { team: { id: number; colors?: { player?: { primary?: string } } }; formation: string | null }[];
}
const trackerCache = new Map<string, { at: number; data: unknown }>();
const STAT_KEYS: Record<string, string> = {
  'ball possession': 'possession', 'total shots': 'shots', 'shots on goal': 'shotsOn', 'shots off goal': 'shotsOff', 'blocked shots': 'blocked',
  'shots insidebox': 'insideBox', 'corner kicks': 'corners', 'fouls': 'fouls', 'offsides': 'offsides', 'yellow cards': 'yellow', 'red cards': 'red',
  'goalkeeper saves': 'saves', 'total passes': 'passes', 'passes %': 'passPct', 'expected_goals': 'xg',
};

r.get(
  '/events/:id/tracker',
  asyncH(async (req, res) => {
    const id = req.params.id;
    const ev = await prisma.event.findUnique({ where: { id } });
    if (!ev || !id.startsWith('af_')) throw new HttpError(404, 'No tracker for this match');
    const ttl = ev.status === 'LIVE' ? config.trackerCacheMs : ev.status === 'UPCOMING' ? 10 * 60_000 : 30 * 60_000;
    const hit = trackerCache.get(id);
    if (hit && Date.now() - hit.at < ttl) return res.json(hit.data);
    if (!config.afKey || ev.commenceTime.getTime() > Date.now() + 2 * 3600_000) {
      const data = { status: ev.status, available: false, events: [], stats: null, formations: [null, null] };
      trackerCache.set(id, { at: Date.now(), data });
      return res.json(data);
    }
    let f: AfFull | undefined;
    try {
      f = (await af<AfFull>('/fixtures', { id: id.slice(3), timezone: 'UTC' })).response[0];
    } catch (e) {
      if (hit) return res.json(hit.data); // serve stale on provider hiccups
      throw new HttpError(502, 'Match data temporarily unavailable');
    }
    if (!f) throw new HttpError(404, 'No tracker for this match');
    const side = (teamId: number) => (teamId === f!.teams.home.id ? 'home' : 'away');
    const stats: Record<string, [number | null, number | null]> = {};
    for (const t of f.statistics ?? []) {
      const s0 = side(t.team.id) === 'home' ? 0 : 1;
      for (const st of t.statistics) {
        const k = STAT_KEYS[st.type.toLowerCase()];
        if (!k) continue;
        const v = st.value == null ? null : typeof st.value === 'string' ? parseFloat(st.value) : st.value;
        (stats[k] ??= [null, null])[s0] = v == null || Number.isNaN(v) ? null : v;
      }
    }
    const data = {
      available: true,
      status: f.fixture.status.short,
      statusLong: f.fixture.status.long,
      elapsed: f.fixture.status.elapsed,
      extra: f.fixture.status.extra ?? null,
      score: [f.goals.home, f.goals.away],
      ht: f.score.halftime ? [f.score.halftime.home, f.score.halftime.away] : null,
      venue: f.fixture.venue?.name ? `${f.fixture.venue.name}${f.fixture.venue.city ? `, ${f.fixture.venue.city}` : ''}` : null,
      referee: f.fixture.referee ?? null,
      formations: [f.lineups?.find((l) => side(l.team.id) === 'home')?.formation ?? null, f.lineups?.find((l) => side(l.team.id) === 'away')?.formation ?? null],
      events: (f.events ?? []).map((e) => ({
        minute: e.time.elapsed,
        extra: e.time.extra,
        team: side(e.team.id),
        type: e.type, // Goal | Card | subst | Var
        detail: e.detail,
        player: e.player?.name ?? null,
        assist: e.assist?.name ?? null,
      })),
      stats: Object.keys(stats).length ? stats : null,
    };
    // keep corners / half-time on the event current for settlement and the UI
    const c = stats.corners;
    if ((c && c[0] != null && c[1] != null) || (data.ht && data.ht[0] != null && f.fixture.status.short !== '1H')) {
      await prisma.event.update({
        where: { id },
        data: {
          ...(c && c[0] != null && c[1] != null ? { cornersHome: c[0], cornersAway: c[1] } : {}),
          ...(data.ht && data.ht[0] != null && f.fixture.status.short !== '1H' ? { htHome: data.ht[0], htAway: data.ht[1] } : {}),
        },
      }).catch(() => {});
    }
    trackerCache.set(id, { at: Date.now(), data });
    if (trackerCache.size > 500) trackerCache.delete(trackerCache.keys().next().value!);
    res.json(data);
  })
);

r.post(
  '/outcomes',
  asyncH(async (req, res) => {
    // Used by the betslip to refresh prices of the selections it holds
    const { ids } = z.object({ ids: z.array(z.string()).max(30) }).parse(req.body);
    const outcomes = await prisma.outcome.findMany({ where: { id: { in: ids } }, include: { market: { include: { event: true } } } });
    const now = new Date();
    res.json({
      outcomes: outcomes.map((o) => ({
        id: o.id,
        price: Number(o.price),
        available: outcomeOpen(o, now),
        live: o.market.event.status === 'LIVE',
      })),
    });
  })
);

export default r;
