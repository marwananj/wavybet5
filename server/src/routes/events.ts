import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { asyncH, HttpError } from '../lib/http';
import { outcomeOpen } from '../services/open';
import { eventInclude, serializeEvent } from '../services/serialize';
import { addStreamClient } from '../services/stream';
import { prisma } from '../lib/prisma';

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
      })
      .parse(req.query);
    const now = new Date();
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
    res.json({ events: events.map(serializeEvent) });
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
    res.json({ events: events.map(serializeEvent) });
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
