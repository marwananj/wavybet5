import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { asyncH, HttpError } from '../lib/http';
import { D, money, Prisma, prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { applyBalanceChange } from '../services/wallet';
import { outcomeOpen } from '../services/live';
import { BuilderError, priceBuilder, type Book } from '../services/builder';

const r = Router();
const betLimiter = rateLimit({ windowMs: 60_000, limit: 40 });

const placeSchema = z.object({
  mode: z.enum(['singles', 'parlay']),
  selections: z
    .array(z.object({ outcomeId: z.string(), odds: z.number().positive(), stake: z.number().positive().optional() }))
    .min(1)
    .max(config.maxParlayLegs),
  stake: z.number().positive().optional(),
  acceptOddsChanges: z.enum(['none', 'higher', 'any']).default('higher'),
});

r.post(
  '/',
  requireAuth,
  betLimiter,
  asyncH(async (req, res) => {
    const body = placeSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.selfExcludedUntil && user.selfExcludedUntil > new Date()) throw new HttpError(403, 'You are self-excluded');

    const ids = body.selections.map((s) => s.outcomeId);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Duplicate selection');

    // load + validate availability and odds (run twice for live bets: before and after the delay)
    const check = async (stage: 'initial' | 'after-delay') => {
      const found = await prisma.outcome.findMany({ where: { id: { in: ids } }, include: { market: { include: { event: true } } } });
      const map = new Map(found.map((o) => [o.id, o]));
      const now = new Date();
      const changed: { outcomeId: string; odds: number | null }[] = [];
      for (const s of body.selections) {
        const o = map.get(s.outcomeId);
        if (!o || !outcomeOpen(o, now)) {
          changed.push({ outcomeId: s.outcomeId, odds: null });
          continue;
        }
        const cur = Number(o.price);
        const ok = cur === s.odds || body.acceptOddsChanges === 'any' || (body.acceptOddsChanges === 'higher' && cur > s.odds);
        if (!ok) changed.push({ outcomeId: s.outcomeId, odds: cur });
      }
      if (changed.length) {
        const closed = changed.some((c) => c.odds === null);
        const msg = closed
          ? stage === 'after-delay' ? 'Market suspended while your bet was being accepted — try again' : 'One or more selections are suspended or closed'
          : 'Odds have changed';
        throw new HttpError(409, msg, 'ODDS_CHANGED', changed);
      }
      return { outcomes: found, byId: map };
    };

    let { outcomes, byId } = await check('initial');
    const hasLive = outcomes.some((o) => o.market.event.status === 'LIVE');
    if (hasLive && config.liveBetDelayMs > 0) {
      // in-play bet delay: protects against betting on something that already happened
      await new Promise((r) => setTimeout(r, config.liveBetDelayMs));
      ({ outcomes, byId } = await check('after-delay'));
    }

    type Leg = (typeof outcomes)[number];
    const legs: Leg[] = body.selections.map((s) => byId.get(s.outcomeId)!);
    const selData = (o: Leg) => ({
      eventId: o.market.eventId,
      outcomeId: o.id,
      marketKey: o.market.key,
      outcomeCode: o.code,
      outcomeName: o.name,
      point: o.point,
      odds: o.price,
      eventLabel: `${o.market.event.homeTeam} vs ${o.market.event.awayTeam}`,
      sportTitle: o.market.event.sportTitle,
      commenceTime: o.market.event.commenceTime,
    });

    const planned: { type: string; stake: ReturnType<typeof D>; odds: ReturnType<typeof D>; legs: Leg[] }[] = [];
    if (body.mode === 'parlay') {
      if (legs.length < 2) throw new HttpError(400, 'A parlay needs at least 2 selections');
      if (new Set(legs.map((l) => l.market.eventId)).size !== legs.length)
        throw new HttpError(400, 'Selections from the same match cannot go in a parlay — use Bet Builder on the match page');
      if (!body.stake) throw new HttpError(400, 'Enter a stake');
      const odds = legs.reduce((acc, l) => acc.mul(l.price), D(1)).toDecimalPlaces(2);
      planned.push({ type: 'PARLAY', stake: money(body.stake), odds, legs });
    } else {
      body.selections.forEach((s, i) => {
        if (!s.stake) throw new HttpError(400, 'Enter a stake for every selection');
        planned.push({ type: 'SINGLE', stake: money(s.stake), odds: D(legs[i].price), legs: [legs[i]] });
      });
    }
    for (const p of planned) {
      if (p.stake.lt(config.minStake)) throw new HttpError(400, `Minimum stake is $${config.minStake}`);
      if (p.stake.gt(config.maxStake)) throw new HttpError(400, `Maximum stake is $${config.maxStake}`);
      if (p.stake.mul(p.odds).gt(config.maxPayout)) throw new HttpError(400, `Maximum payout is $${config.maxPayout}`);
    }

    const bets = await prisma.$transaction(async (db) => {
      const created: Prisma.BetGetPayload<{ include: { selections: true } }>[] = [];
      for (const p of planned) {
        const bet = await db.bet.create({
          data: {
            userId: user.id,
            type: p.type,
            stake: p.stake,
            totalOdds: p.odds,
            potentialPayout: money(p.stake.mul(p.odds)),
            selections: { create: p.legs.map(selData) },
          },
          include: { selections: true },
        });
        await applyBalanceChange(db, { userId: user.id, amount: p.stake.negated(), type: 'BET_STAKE', betId: bet.id, note: `${p.type === 'PARLAY' ? `${p.legs.length}-leg parlay` : 'Single'} @ ${p.odds}` });
        created.push(bet);
      }
      return created;
    });

    const balance = (await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { balance: true } })).balance;
    res.status(201).json({ bets: bets.map(serializeBet), balance: String(balance) });
  })
);

/* ───────────────────────────── Bet Builder ───────────────────────────── */

const builderSchema = z.object({ eventId: z.string(), outcomeIds: z.array(z.string()).min(2).max(8) });

async function quoteBuilder(eventId: string, outcomeIds: string[]) {
  if (new Set(outcomeIds).size !== outcomeIds.length) throw new HttpError(400, 'Duplicate selection');
  const ev = await prisma.event.findUnique({ where: { id: eventId }, include: { markets: { include: { outcomes: { where: { active: true } } } } } });
  if (!ev) throw new HttpError(404, 'Match not found');
  if (ev.status !== 'UPCOMING' || ev.commenceTime <= new Date()) throw new HttpError(400, 'Bet Builder is available before kick-off only');
  const book: Book = {};
  const all = new Map<string, { o: (typeof ev.markets)[number]['outcomes'][number]; m: (typeof ev.markets)[number] }>();
  for (const m of ev.markets) {
    book[m.key] = m.outcomes.map((o) => ({ code: o.code, price: Number(o.price), point: o.point == null ? null : Number(o.point) }));
    for (const o of m.outcomes) all.set(o.id, { o, m });
  }
  const legs = outcomeIds.map((id) => {
    const x = all.get(id);
    if (!x) throw new HttpError(409, 'A selection is no longer available', 'ODDS_CHANGED');
    if (x.m.suspended || x.o.suspended) throw new HttpError(409, 'A selection is suspended', 'ODDS_CHANGED');
    return x;
  });
  try {
    const q = priceBuilder(
      book,
      legs.map((l) => ({ marketKey: l.m.key, code: l.o.code, point: l.o.point == null ? null : Number(l.o.point) })),
      legs.map((l) => Number(l.o.price))
    );
    return { ev, legs, ...q };
  } catch (e) {
    if (e instanceof BuilderError) throw new HttpError(400, e.message, 'BUILDER');
    throw e;
  }
}

r.post(
  '/builder/quote',
  asyncH(async (req, res) => {
    const b = builderSchema.parse(req.body);
    const q = await quoteBuilder(b.eventId, b.outcomeIds);
    res.json({ price: q.price });
  })
);

r.post(
  '/builder',
  requireAuth,
  betLimiter,
  asyncH(async (req, res) => {
    const b = builderSchema.extend({ stake: z.number().positive(), odds: z.number().positive() }).parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.selfExcludedUntil && user.selfExcludedUntil > new Date()) throw new HttpError(403, 'You are self-excluded');
    const q = await quoteBuilder(b.eventId, b.outcomeIds);
    if (q.price < b.odds) throw new HttpError(409, 'The Bet Builder price changed', 'ODDS_CHANGED', [{ outcomeId: 'builder', odds: q.price }]);
    const stake = money(b.stake);
    const odds = D(q.price);
    if (stake.lt(config.minStake)) throw new HttpError(400, `Minimum stake is $${config.minStake}`);
    if (stake.gt(config.maxStake)) throw new HttpError(400, `Maximum stake is $${config.maxStake}`);
    if (stake.mul(odds).gt(config.maxPayout)) throw new HttpError(400, `Maximum payout is $${config.maxPayout}`);
    const label = `${q.ev.homeTeam} vs ${q.ev.awayTeam}`;
    const bet = await prisma.$transaction(async (db) => {
      const created = await db.bet.create({
        data: {
          userId: user.id,
          type: 'BUILDER',
          stake,
          totalOdds: odds,
          potentialPayout: money(stake.mul(odds)),
          selections: {
            create: q.legs.map(({ o, m }) => ({
              eventId: q.ev.id, outcomeId: o.id, marketKey: m.key, outcomeCode: o.code, outcomeName: o.name, point: o.point, odds: o.price,
              eventLabel: label, sportTitle: q.ev.sportTitle, commenceTime: q.ev.commenceTime,
            })),
          },
        },
        include: { selections: true },
      });
      await applyBalanceChange(db, { userId: user.id, amount: stake.negated(), type: 'BET_STAKE', betId: created.id, note: `Bet Builder (${q.legs.length} legs) @ ${odds}` });
      return created;
    });
    const balance = (await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { balance: true } })).balance;
    res.status(201).json({ bets: [serializeBet(bet)], balance: String(balance) });
  })
);

function serializeBet(b: {
  id: string; type: string; stake: unknown; totalOdds: unknown; potentialPayout: unknown; payout: unknown; status: string;
  createdAt: Date; settledAt: Date | null;
  selections: { id: string; eventId: string; marketKey: string; outcomeName: string; odds: unknown; status: string; eventLabel: string; sportTitle: string; commenceTime: Date; early?: boolean; point?: unknown }[];
}) {
  return {
    id: b.id, type: b.type, stake: String(b.stake), totalOdds: String(b.totalOdds), potentialPayout: String(b.potentialPayout),
    payout: b.payout == null ? null : String(b.payout), status: b.status, createdAt: b.createdAt, settledAt: b.settledAt,
    selections: b.selections.map((s) => ({
      id: s.id, eventId: s.eventId, marketKey: s.marketKey, outcomeName: s.outcomeName, odds: String(s.odds), status: s.status,
      eventLabel: s.eventLabel, sportTitle: s.sportTitle, commenceTime: s.commenceTime, early: !!s.early,
    })),
  };
}

r.get(
  '/',
  requireAuth,
  asyncH(async (req, res) => {
    const q = z.object({ status: z.enum(['open', 'settled', 'won', 'lost', 'all']).default('all'), cursor: z.string().optional() }).parse(req.query);
    const where =
      q.status === 'open' ? { status: 'OPEN' as const }
      : q.status === 'settled' ? { status: { in: ['WON', 'LOST', 'VOID'] as ('WON' | 'LOST' | 'VOID')[] } }
      : q.status === 'won' ? { status: 'WON' as const }
      : q.status === 'lost' ? { status: 'LOST' as const }
      : {};
    const bets = await prisma.bet.findMany({
      where: { userId: req.user!.id, ...where },
      include: { selections: { orderBy: { commenceTime: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 21,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const stats = await prisma.bet.groupBy({ by: ['status'], where: { userId: req.user!.id }, _count: { _all: true }, _sum: { stake: true, payout: true } });
    res.json({
      bets: bets.slice(0, 20).map(serializeBet),
      nextCursor: bets.length > 20 ? bets[19].id : null,
      stats: stats.map((s) => ({ status: s.status, count: s._count._all, stake: String(s._sum.stake ?? 0), payout: String(s._sum.payout ?? 0) })),
    });
  })
);

export default r;
