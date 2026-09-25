import { Router } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { asyncH, HttpError } from '../lib/http';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import {
  COIN_WIN, DICE_EDGE, KENO_RISKS, THUNDER_COUNTS, THUNDER_MULTS, THUNDER_RTP, THUNDER_STRAIGHT, playCoinflip, playDice, playKeno, playRoulette, playRps, RPS, RPS_WIN, WHEEL_ORDER,
  type RouletteBet,
} from '../casino/engine/instant';
import { KENO_TABLES, type KenoRisk } from '../casino/engine/kenoTables';
import { bjAct, bjStart, bjTotals, bjView, type BjAction, type BjState } from '../casino/engine/blackjack';
import { hiloGuess, hiloSkip, hiloStart, hiloView, type HiloChoice, type HiloState } from '../casino/engine/hilo';
import { CHICKEN_LEVELS, chickenLadder, chickenMultiplier, chickenStart, chickenStep, chickenView, type ChickenLevel, type ChickenState } from '../casino/engine/chicken';
import { HORSE_RTP, makeCard, playHorses, type HorseBet } from '../casino/engine/horses';
import { playWheel, WHEEL_RISKS, WHEEL_SEGMENTS, WHEEL_TABLES, type WheelRisk } from '../casino/engine/wheel';
import { TOWER_FLOORS, TOWER_LEVELS, towerCashout, towerLadder, towerMultiplier, towerPick, towerStart, towerView, type TowerLevel, type TowerState } from '../casino/engine/tower';
import { AA_PAYS, ANTE_PAYS, HAND_NAMES, holdemAct, holdemOutcome, holdemStart, holdemView, type HoldemState } from '../casino/engine/holdem';
import {
  actStateful, activeSeed, GAME_NAMES, getActive, playInstant, publicRound, rotateSeed, startStateful, type StatefulDef,
} from '../casino/service';

const r = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false });

/* ------------------------------ info ---------------------------------- */

r.get('/config', (_req, res) => {
  res.json({
    enabled: config.casinoEnabled,
    minStake: config.casinoMinStake,
    maxStake: config.casinoMaxStake,
    maxPayout: config.casinoMaxPayout,
    games: Object.entries(GAME_NAMES).map(([id, name]) => ({ id, name })),
    dice: { edge: DICE_EDGE },
    keno: { tables: KENO_TABLES },
    rps: { win: RPS_WIN },
    coinflip: { win: COIN_WIN },
    roulette: { order: WHEEL_ORDER, thunder: { straight: THUNDER_STRAIGHT, counts: THUNDER_COUNTS, multipliers: THUNDER_MULTS, rtp: THUNDER_RTP } },
    wheel: { tables: WHEEL_TABLES },
    tower: { floors: TOWER_FLOORS, levels: Object.fromEntries(Object.entries(TOWER_LEVELS).map(([k, v]) => [k, { ...v, ladder: towerLadder(k as TowerLevel) }])) },
    holdem: { hands: HAND_NAMES, ante: ANTE_PAYS, aa: AA_PAYS },
    chicken: Object.fromEntries(Object.entries(CHICKEN_LEVELS).map(([k, v]) => [k, { ...v, ladder: chickenLadder(k as ChickenLevel) }])),
  });
});

r.get(
  '/fair',
  requireAuth,
  asyncH(async (req, res) => {
    const s = await activeSeed(prisma, req.user!.id);
    const prev = await prisma.fairSeed.findFirst({ where: { userId: req.user!.id, active: false }, orderBy: { revealedAt: 'desc' } });
    res.json({
      serverSeedHash: s.serverSeedHash,
      clientSeed: s.clientSeed,
      nonce: s.nonce,
      previous: prev ? { serverSeed: prev.serverSeed, serverSeedHash: prev.serverSeedHash, clientSeed: prev.clientSeed, nonce: prev.nonce } : null,
    });
  })
);

r.post(
  '/fair/rotate',
  requireAuth,
  asyncH(async (req, res) => {
    const { clientSeed } = z.object({ clientSeed: z.string().trim().min(1).max(64).optional() }).parse(req.body ?? {});
    const out = await rotateSeed(req.user!.id, clientSeed);
    res.json({
      previous: out.previous,
      current: { serverSeedHash: out.next.serverSeedHash, clientSeed: out.next.clientSeed, nonce: out.next.nonce },
    });
  })
);

/** Next race card for this player (public: client seed + upcoming nonce). Guests get a preview card. */
r.get(
  '/horses/card',
  asyncH(async (req, res) => {
    const auth = req.headers.authorization;
    let seed = { clientSeed: 'wavybet-preview', nonce: Math.floor(Date.now() / 60_000) };
    if (auth?.startsWith('Bearer ')) {
      try {
        const { sub } = jwt.verify(auth.slice(7), config.jwtAccessSecret) as { sub: string };
        const s = await activeSeed(prisma, sub);
        seed = { clientSeed: s.clientSeed, nonce: s.nonce };
      } catch {
        /* guest preview */
      }
    }
    const card = makeCard(seed.clientSeed, seed.nonce);
    res.json({ card: { ...card, runners: card.runners.map(({ p: _p, ...r }) => r) }, rtp: HORSE_RTP });
  })
);

r.get(
  '/rounds',
  requireAuth,
  asyncH(async (req, res) => {
    const q = z.object({ game: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query);
    const rounds = await prisma.casinoRound.findMany({
      where: { userId: req.user!.id, status: { not: 'ACTIVE' }, ...(q.game ? { game: q.game } : {}) },
      include: { seed: true },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    res.json({ rounds: rounds.map((x) => publicRound(x, x.seed)) });
  })
);

/* --------------------------- instant games ---------------------------- */

const stake = z.number().positive();

r.post(
  '/play/:game',
  requireAuth,
  limiter,
  asyncH(async (req, res) => {
    const uid = req.user!.id;
    const game = req.params.game;
    let out;
    switch (game) {
      case 'dice': {
        const b = z.object({ stake, target: z.number().min(0).max(100), over: z.boolean() }).parse(req.body);
        out = await playInstant(uid, game, b.stake, (rng) => playDice(b, rng));
        break;
      }
      case 'keno': {
        const b = z.object({ stake, picks: z.array(z.number().int()).min(1).max(10), risk: z.enum(KENO_RISKS as [KenoRisk, ...KenoRisk[]]) }).parse(req.body);
        out = await playInstant(uid, game, b.stake, (rng) => playKeno(b, rng));
        break;
      }
      case 'rps': {
        const b = z.object({ stake, pick: z.enum(RPS) }).parse(req.body);
        out = await playInstant(uid, game, b.stake, (rng) => playRps(b, rng));
        break;
      }
      case 'coinflip': {
        const b = z.object({ stake, side: z.enum(['heads', 'tails']) }).parse(req.body);
        out = await playInstant(uid, game, b.stake, (rng) => playCoinflip(b, rng));
        break;
      }
      case 'roulette': {
        const b = z
          .object({
            bets: z
              .array(
                z.object({
                  type: z.enum(['straight', 'split', 'street', 'corner', 'line', 'red', 'black', 'odd', 'even', 'low', 'high', 'dozen', 'column']),
                  value: z.number().int().optional(),
                  numbers: z.array(z.number().int().min(0).max(36)).min(2).max(6).optional(),
                  amount: z.number().positive(),
                })
              )
              .min(1)
              .max(200),
            mode: z.enum(['classic', 'thunder']).optional(),
          })
          .parse(req.body);
        const total = Math.round(b.bets.reduce((a, x) => a + x.amount, 0) * 100) / 100;
        out = await playInstant(uid, game, total, (rng) => playRoulette({ bets: b.bets as RouletteBet[], mode: b.mode }, rng));
        break;
      }
      case 'wheel': {
        const b = z
          .object({ stake, risk: z.enum(WHEEL_RISKS as unknown as [WheelRisk, ...WheelRisk[]]), segments: z.number().int().refine((n) => (WHEEL_SEGMENTS as readonly number[]).includes(n)) })
          .parse(req.body);
        out = await playInstant(uid, game, b.stake, (rng) => playWheel(b, rng));
        break;
      }
      case 'horses': {
        const b = z
          .object({
            cardId: z.string().min(1).max(64),
            bets: z
              .array(z.object({ type: z.enum(['win', 'place', 'forecast', 'quinella']), horses: z.array(z.number().int().min(0).max(7)).min(1).max(2), amount: z.number().positive() }))
              .min(1)
              .max(30),
          })
          .parse(req.body);
        const total = Math.round(b.bets.reduce((a, x) => a + x.amount, 0) * 100) / 100;
        out = await playInstant(uid, game, total, (rng, ctx) => playHorses({ bets: b.bets as HorseBet[], cardId: b.cardId }, makeCard(ctx.clientSeed, ctx.nonce), rng));
        break;
      }
      default:
        throw new HttpError(404, 'Unknown game');
    }
    res.json(out);
  })
);

/* --------------------------- stateful games --------------------------- */

const blackjack: StatefulDef<BjState> = {
  start: (_p, rng) => bjStart(rng),
  act: (s, action, _p, rng) => bjAct(s, action as BjAction, rng),
  isFinished: (s) => s.finished,
  settle: (s) => {
    const t = bjTotals(s);
    return { stakeUnits: t.stake, payoutUnits: t.payout, status: t.payout > t.stake ? 'WON' : t.payout === t.stake ? 'PUSH' : 'LOST' };
  },
  view: (s) => bjView(s),
};

type HiloStored = HiloState & { cashed?: boolean };
const hilo: StatefulDef<HiloStored> = {
  start: (_p, rng) => hiloStart(rng),
  act: (s, action, p, rng) => {
    if (action === 'guess') hiloGuess(s, z.enum(['higher', 'lower', 'same']).parse(p.choice) as HiloChoice, rng);
    else if (action === 'skip') hiloSkip(s, rng);
    else if (action === 'cashout') {
      if (s.finished || s.wins < 1) throw new HttpError(400, 'Win at least one guess before cashing out');
      s.finished = true;
      s.cashed = true;
    } else throw new HttpError(400, 'Unknown action');
    return {};
  },
  isFinished: (s) => s.finished,
  settle: (s) => (s.cashed ? { stakeUnits: 1, payoutUnits: s.multiplier, status: 'CASHED' } : { stakeUnits: 1, payoutUnits: 0, status: 'LOST' }),
  view: (s) => ({ ...hiloView(s), cashed: !!s.cashed }),
};

type ChickenStored = ChickenState & { cashed?: boolean };
const chicken: StatefulDef<ChickenStored, { level: ChickenLevel }> = {
  start: (p, rng) => chickenStart(p.level, rng),
  act: (s, action) => {
    if (action === 'step') chickenStep(s);
    else if (action === 'cashout') {
      if (s.finished || s.lane < 1) throw new HttpError(400, 'Cross at least one lane before cashing out');
      s.finished = true;
      s.cashed = true;
    } else throw new HttpError(400, 'Unknown action');
    return {};
  },
  isFinished: (s) => s.finished,
  settle: (s) =>
    s.dead ? { stakeUnits: 1, payoutUnits: 0, status: 'LOST' } : { stakeUnits: 1, payoutUnits: chickenMultiplier(s.level, s.lane), status: 'CASHED' },
  view: (s) => ({ ...chickenView(s), cashed: !!s.cashed }),
};

const tower: StatefulDef<TowerState, { level: TowerLevel }> = {
  start: (p, rng) => towerStart(p.level, rng),
  act: (s, action, p) => {
    if (action === 'pick') towerPick(s, z.number().int().parse(p.tile));
    else if (action === 'cashout') towerCashout(s);
    else throw new HttpError(400, 'Unknown action');
    return {};
  },
  isFinished: (s) => s.finished,
  settle: (s) =>
    s.dead ? { stakeUnits: 1, payoutUnits: 0, status: 'LOST' } : { stakeUnits: 1, payoutUnits: towerMultiplier(s.level, s.floor), status: 'CASHED' },
  view: (s) => towerView(s),
};

const holdem: StatefulDef<HoldemState, { aaUnits: number }> = {
  start: (p, rng) => holdemStart(p.aaUnits, rng),
  startExtra: (p) => p.aaUnits,
  act: (s, action) => holdemAct(s, action),
  isFinished: (s) => s.finished,
  settle: (s) => {
    const o = holdemOutcome(s);
    const status = o.payoutUnits > o.stakeUnits ? 'WON' : Math.abs(o.payoutUnits - o.stakeUnits) < 1e-9 ? 'PUSH' : 'LOST';
    return { stakeUnits: o.stakeUnits, payoutUnits: o.payoutUnits, status };
  },
  view: (s) => holdemView(s),
};

const DEFS: Record<string, StatefulDef<any, any>> = { blackjack, hilo, chicken, tower, holdem };
const def = (game: string) => {
  const d = DEFS[game];
  if (!d) throw new HttpError(404, 'Unknown game');
  return d;
};

r.get(
  '/:game/active',
  requireAuth,
  asyncH(async (req, res) => {
    res.json({ round: await getActive(req.user!.id, req.params.game, def(req.params.game)) });
  })
);

r.post(
  '/:game/start',
  requireAuth,
  limiter,
  asyncH(async (req, res) => {
    const game = req.params.game;
    const d = def(game);
    const b = z
      .object({ stake, level: z.enum(['easy', 'medium', 'hard', 'expert']).optional(), aa: z.number().min(0).max(config.casinoMaxStake).optional() })
      .parse(req.body);
    if ((game === 'chicken' || game === 'tower') && !b.level) throw new HttpError(400, 'Choose a difficulty');
    let aaUnits = 0;
    if (game === 'holdem' && b.aa && b.aa > 0) {
      if (b.aa < config.casinoMinStake) throw new HttpError(400, `Minimum AA Bonus is $${config.casinoMinStake}`);
      aaUnits = Math.round(b.aa * 100) / Math.round(b.stake * 100);
    }
    res.json(await startStateful(req.user!.id, game, d, b.stake, { level: b.level, aaUnits }));
  })
);

r.post(
  '/:game/:id/:action',
  requireAuth,
  limiter,
  asyncH(async (req, res) => {
    const { game, id, action } = req.params;
    res.json(await actStateful(req.user!.id, game, def(game), id, action, req.body ?? {}));
  })
);

export default r;
