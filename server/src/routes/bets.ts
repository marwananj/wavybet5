import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { asyncH, HttpError } from '../lib/http';
import { D, money, Prisma, prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { applyBalanceChange } from '../services/wallet';
import { outcomeOpen } from '../services/live';

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
        throw new HttpError(400, 'Selections from the same match cannot be combined');
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

function serializeBet(b: {
  id: string; type: string; stake: unknown; totalOdds: unknown; potentialPayout: unknown; payout: unknown; status: string;
  createdAt: Date; settledAt: Date | null;
  selections: { id: string; eventId: string; marketKey: string; outcomeName: string; odds: unknown; status: string; eventLabel: string; sportTitle: string; commenceTime: Date }[];
}) {
  return {
    id: b.id, type: b.type, stake: String(b.stake), totalOdds: String(b.totalOdds), potentialPayout: String(b.potentialPayout),
    payout: b.payout == null ? null : String(b.payout), status: b.status, createdAt: b.createdAt, settledAt: b.settledAt,
    selections: b.selections.map((s) => ({
      id: s.id, eventId: s.eventId, marketKey: s.marketKey, outcomeName: s.outcomeName, odds: String(s.odds), status: s.status,
      eventLabel: s.eventLabel, sportTitle: s.sportTitle, commenceTime: s.commenceTime,
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
