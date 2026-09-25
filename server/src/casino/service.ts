import { Prisma } from '@prisma/client';
import { config } from '../config';
import { HttpError } from '../lib/http';
import { D, money, prisma } from '../lib/prisma';
import { applyBalanceChange } from '../services/wallet';
import { makeRng, newClientSeed, newServerSeed, sha256, type Rng } from './fair';
import { GameError, type InstantResult } from './engine/instant';

type Tx = Prisma.TransactionClient;
type Dec = Prisma.Decimal;

export const GAME_NAMES: Record<string, string> = {
  dice: 'Dice',
  keno: 'Keno',
  rps: 'Rock Paper Scissors',
  coinflip: 'Coin Flip',
  roulette: 'Roulette',
  blackjack: 'Blackjack',
  hilo: 'HiLo',
  chicken: 'Chicken Road',
  wheel: 'Wheel',
  holdem: "Casino Hold'em",
  tower: 'Tower',
  horses: 'Wavy Horse Racing',
};

/* ------------------------------- seeds -------------------------------- */

export async function activeSeed(db: Tx | typeof prisma, userId: string) {
  const s = await db.fairSeed.findFirst({ where: { userId, active: true } });
  if (s) return s;
  const serverSeed = newServerSeed();
  return db.fairSeed.create({ data: { userId, serverSeed, serverSeedHash: sha256(serverSeed), clientSeed: newClientSeed() } });
}

/** Reserve the next nonce atomically (row lock serialises concurrent bets). */
async function takeNonce(db: Tx, userId: string) {
  const s0 = await activeSeed(db, userId);
  const seed = await db.fairSeed.update({ where: { id: s0.id }, data: { nonce: { increment: 1 } } });
  return { seed, nonce: seed.nonce - 1, rng: makeRng({ serverSeed: seed.serverSeed, clientSeed: seed.clientSeed, nonce: seed.nonce - 1 }) };
}

export async function rotateSeed(userId: string, clientSeed?: string) {
  const active = await prisma.casinoRound.count({ where: { userId, status: 'ACTIVE' } });
  if (active) throw new HttpError(400, 'Finish your active games before changing seeds');
  return prisma.$transaction(async (db) => {
    const old = await activeSeed(db, userId);
    await db.fairSeed.update({ where: { id: old.id }, data: { active: false, revealedAt: new Date() } });
    const serverSeed = newServerSeed();
    const next = await db.fairSeed.create({
      data: { userId, serverSeed, serverSeedHash: sha256(serverSeed), clientSeed: clientSeed?.trim() || newClientSeed() },
    });
    return { previous: { serverSeed: old.serverSeed, serverSeedHash: old.serverSeedHash, clientSeed: old.clientSeed, nonce: old.nonce }, next };
  });
}

/* ------------------------------- guards ------------------------------- */

export async function assertCanPlay(userId: string) {
  if (!config.casinoEnabled) throw new HttpError(503, 'Casino is temporarily closed');
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { selfExcludedUntil: true } });
  if (u.selfExcludedUntil && u.selfExcludedUntil > new Date()) throw new HttpError(403, 'You are self-excluded');
}

export function checkStake(stake: number) {
  if (!(stake >= config.casinoMinStake)) throw new HttpError(400, `Minimum bet is $${config.casinoMinStake}`);
  if (stake > config.casinoMaxStake) throw new HttpError(400, `Maximum bet is $${config.casinoMaxStake}`);
  return money(stake);
}

const cap = (p: Dec) => (p.gt(config.casinoMaxPayout) ? D(config.casinoMaxPayout) : p);

async function balanceOf(db: Tx, userId: string) {
  return String((await db.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } })).balance);
}

export function publicRound(
  r: { id: string; game: string; stake: Dec; payout: Dec; multiplier: Dec; status: string; nonce: number; createdAt: Date; finishedAt: Date | null },
  seed: { serverSeedHash: string; clientSeed: string; serverSeed: string; revealedAt: Date | null },
  view?: unknown
) {
  return {
    id: r.id,
    game: r.game,
    stake: String(r.stake),
    payout: String(r.payout),
    multiplier: Number(r.multiplier),
    status: r.status,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
    fair: {
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: r.nonce,
      serverSeed: seed.revealedAt ? seed.serverSeed : null,
    },
    ...(view !== undefined ? { view } : {}),
  };
}

const wrapGameErrors = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof GameError) throw new HttpError(400, e.message);
    throw e;
  }
};

/* --------------------------- instant games ---------------------------- */

export async function playInstant(
  userId: string,
  game: string,
  stakeNum: number,
  play: (rng: Rng, ctx: { clientSeed: string; nonce: number }) => InstantResult
) {
  await assertCanPlay(userId);
  const stake = checkStake(stakeNum);
  return prisma.$transaction(async (db) => {
    const { seed, nonce, rng } = await takeNonce(db, userId);
    await applyBalanceChange(db, { userId, amount: stake.negated(), type: 'CASINO_BET', note: GAME_NAMES[game] });
    const r = wrapGameErrors(() => play(rng, { clientSeed: seed.clientSeed, nonce }));
    const payout = cap(r.payout != null ? money(r.payout) : money(stake.mul(r.multiplier)));
    const round = await db.casinoRound.create({
      data: {
        userId, game, stake, payout, multiplier: D(r.multiplier), status: r.status,
        seedId: seed.id, nonce, state: r.result as Prisma.InputJsonValue, finishedAt: new Date(),
      },
    });
    if (payout.gt(0)) {
      await applyBalanceChange(db, { userId, amount: payout, type: 'CASINO_WIN', note: `${GAME_NAMES[game]} ${r.multiplier}×` });
    }
    return { round: publicRound(round, seed, r.result), result: r.result, balance: await balanceOf(db, userId) };
  });
}

/* --------------------------- stateful games --------------------------- */

export interface Settlement {
  stakeUnits: number;
  payoutUnits: number;
  status: 'WON' | 'LOST' | 'PUSH' | 'CASHED';
}
export interface StatefulDef<S, P = Record<string, unknown>> {
  start(params: P, rng: Rng): S;
  /** extra stake units debited together with the base stake at start (side bets) */
  startExtra?(params: P): number;
  /** mutate state; return extra stake units to debit (double/split) */
  act(state: S, action: string, params: Record<string, unknown>, rng: Rng): { extraStake?: number };
  isFinished(state: S): boolean;
  settle(state: S): Settlement;
  view(state: S): unknown;
}

interface Stored<S> {
  base: string; // base stake (money)
  game: S;
}

export async function getActive<S>(userId: string, game: string, def: StatefulDef<S>) {
  const r = await prisma.casinoRound.findFirst({ where: { userId, game, status: 'ACTIVE' }, include: { seed: true }, orderBy: { createdAt: 'desc' } });
  if (!r) return null;
  const st = r.state as unknown as Stored<S>;
  return publicRound(r, r.seed, def.view(st.game));
}

async function finishIfDone<S, P = any>(
  db: Tx,
  userId: string,
  game: string,
  def: StatefulDef<S, P>,
  st: Stored<S>,
  stakeTotal: Dec
) {
  if (!def.isFinished(st.game)) return null;
  const s = def.settle(st.game);
  const base = D(st.base);
  const payout = cap(money(base.mul(s.payoutUnits)));
  const multiplier = s.stakeUnits > 0 ? Math.floor((s.payoutUnits / s.stakeUnits) * 10000) / 10000 : 0;
  if (payout.gt(0)) {
    await applyBalanceChange(db, { userId, amount: payout, type: 'CASINO_WIN', note: `${GAME_NAMES[game]} ${multiplier}×` });
  }
  return { payout, multiplier: D(multiplier), status: s.status, finishedAt: new Date(), stake: stakeTotal };
}

export async function startStateful<S, P>(userId: string, game: string, def: StatefulDef<S, P>, stakeNum: number, params: P) {
  await assertCanPlay(userId);
  const stake = checkStake(stakeNum);
  return prisma.$transaction(async (db) => {
    const existing = await db.casinoRound.findFirst({ where: { userId, game, status: 'ACTIVE' } });
    if (existing) throw new HttpError(409, 'You already have a game in progress', 'ACTIVE_ROUND');
    const { seed, nonce, rng } = await takeNonce(db, userId);
    await applyBalanceChange(db, { userId, amount: stake.negated(), type: 'CASINO_BET', note: GAME_NAMES[game] });
    let stakeTotal = stake;
    const extraUnits = def.startExtra?.(params) ?? 0;
    if (extraUnits > 0) {
      const extra = money(stake.mul(extraUnits));
      await applyBalanceChange(db, { userId, amount: extra.negated(), type: 'CASINO_BET', note: `${GAME_NAMES[game]} side bet` });
      stakeTotal = stakeTotal.add(extra);
    }
    const g = wrapGameErrors(() => def.start(params, rng));
    const st: Stored<S> = { base: String(stake), game: g };
    const fin = await finishIfDone(db, userId, game, def, st, stakeTotal);
    const round = await db.casinoRound.create({
      data: {
        userId, game, stake: stakeTotal, seedId: seed.id, nonce, state: st as unknown as Prisma.InputJsonValue,
        status: 'ACTIVE', ...(fin ?? {}),
      },
    });
    return { round: publicRound(round, seed, def.view(g)), balance: await balanceOf(db, userId) };
  });
}

export async function actStateful<S>(
  userId: string,
  game: string,
  def: StatefulDef<S>,
  roundId: string,
  action: string,
  params: Record<string, unknown>
) {
  return prisma.$transaction(async (db) => {
    const r = await db.casinoRound.findFirst({ where: { id: roundId, userId, game, status: 'ACTIVE' }, include: { seed: true } });
    if (!r) throw new HttpError(404, 'This game is already finished');
    const st = JSON.parse(JSON.stringify(r.state)) as Stored<S>;
    const rng = makeRng({ serverSeed: r.seed.serverSeed, clientSeed: r.seed.clientSeed, nonce: r.nonce });
    const { extraStake = 0 } = wrapGameErrors(() => def.act(st.game, action, params, rng));
    let stakeTotal = D(r.stake);
    if (extraStake > 0) {
      const extra = money(D(st.base).mul(extraStake));
      await applyBalanceChange(db, { userId, amount: extra.negated(), type: 'CASINO_BET', note: `${GAME_NAMES[game]} ${action}` });
      stakeTotal = stakeTotal.add(extra);
    }
    const fin = await finishIfDone(db, userId, game, def, st, stakeTotal);
    const upd = await db.casinoRound.updateMany({
      where: { id: r.id, status: 'ACTIVE', version: r.version },
      data: { state: st as unknown as Prisma.InputJsonValue, version: { increment: 1 }, stake: stakeTotal, ...(fin ?? {}) },
    });
    if (upd.count !== 1) throw new HttpError(409, 'Too fast — please try again');
    const fresh = await db.casinoRound.findUniqueOrThrow({ where: { id: r.id } });
    return { round: publicRound(fresh, r.seed, def.view(st.game)), balance: await balanceOf(db, userId) };
  });
}
