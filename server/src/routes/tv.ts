import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncH, HttpError } from '../lib/http';
import { prisma } from '../lib/prisma';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { BET_WINDOW, currentRound, drawTime, PERIOD, placeTvBet, resultOf, serializeTv, settleTv, TV_GAMES, tvFairness } from '../services/tv';

const r = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });

r.get('/fair', asyncH(async (_req, res) => res.json(await tvFairness())));

r.get(
  '/:game/state',
  optionalAuth,
  asyncH(async (req, res) => {
    const game = req.params.game;
    const g = TV_GAMES[game];
    if (!g) throw new HttpError(404, 'Unknown game');
    void settleTv();
    const now = Date.now();
    const round = currentRound(now);
    const drawn = now >= drawTime(round);
    // last 12 finished draws (the current one only once it has been drawn)
    const last = await Promise.all(
      Array.from({ length: 12 }, (_, i) => round - (drawn ? 0 : 1) - i).map(async (rn) => ({ round: rn, result: await resultOf(game, rn) }))
    );
    let mine: ReturnType<typeof serializeTv>[] = [];
    if (req.user) {
      const bets = await prisma.tvBet.findMany({ where: { userId: req.user.id, game, round: { gte: round - 1 } }, orderBy: { createdAt: 'desc' }, take: 20 });
      mine = bets.map(serializeTv);
    }
    // total staked on each market this round (crowd heat)
    const crowd = await prisma.tvBet.groupBy({ by: ['market'], where: { game, round }, _sum: { stake: true }, _count: { _all: true } });
    res.json({
      game,
      name: g.name,
      markets: g.markets,
      period: PERIOD,
      betWindow: BET_WINDOW,
      serverNow: now,
      round,
      roundStart: round * PERIOD,
      drawAt: drawTime(round),
      nextAt: (round + 1) * PERIOD,
      result: drawn ? last[0].result : null,
      history: last.slice(drawn ? 1 : 0, 12),
      mine,
      crowd: Object.fromEntries(crowd.map((c) => [c.market, { stake: Number(c._sum.stake ?? 0), bets: c._count._all }])),
    });
  })
);

r.post(
  '/:game/bet',
  requireAuth,
  limiter,
  asyncH(async (req, res) => {
    const b = z.object({ market: z.string().min(1).max(20), stake: z.number().positive() }).parse(req.body);
    res.json(await placeTvBet(req.user!.id, req.params.game, b.market, b.stake));
  })
);

export default r;
