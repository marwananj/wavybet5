import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { asyncH, HttpError } from '../lib/http';
import { money, prisma } from '../lib/prisma';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { applyBalanceChange } from '../services/wallet';

/**
 * Player rewards: referral programme, daily reward wheel, weekly cashback, daily missions and the
 * weekly wager tournament. All money goes through the ledger as BONUS transactions.
 */
const r = Router();

/* ───────────────────────────── time helpers (UTC) ───────────────────────────── */

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const dayStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
/** Monday 00:00 UTC of the week containing d */
function weekStart(d = new Date()) {
  const s = dayStart(d);
  const dow = (s.getUTCDay() + 6) % 7; // Mon=0
  return new Date(s.getTime() - dow * 86_400_000);
}
function weekKey(start: Date) {
  // ISO week number
  const t = new Date(start.getTime() + 3 * 86_400_000); // Thursday of that week
  const y = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round((t.getTime() - weekStart(jan4).getTime()) / (7 * 86_400_000));
  return `${y}-W${String(w).padStart(2, '0')}`;
}
const WEEK = 7 * 86_400_000;

/** total stakes placed by a user (casino + sports) between two dates */
async function wageredBetween(userId: string, from: Date, to: Date) {
  const [c, b] = await Promise.all([
    prisma.casinoRound.aggregate({ where: { userId, createdAt: { gte: from, lt: to }, status: { not: 'ACTIVE' } }, _sum: { stake: true } }),
    prisma.bet.aggregate({ where: { userId, createdAt: { gte: from, lt: to }, status: { not: 'VOID' } }, _sum: { stake: true } }),
  ]);
  return Number(c._sum.stake ?? 0) + Number(b._sum.stake ?? 0);
}

/** credit a bonus; optional wagering requirement is added to the player's lock */
async function payBonus(db: Prisma.TransactionClient, userId: string, amount: number, note: string, wagerX = 0) {
  const amt = money(amount);
  await applyBalanceChange(db, { userId, amount: amt, type: 'BONUS', note });
  if (wagerX > 0) await db.user.update({ where: { id: userId }, data: { bonusWagerLeft: { increment: amt.mul(wagerX) } } });
  return amt;
}

async function requireVerified(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerified: true, selfExcludedUntil: true } });
  if (!u.emailVerified) throw new HttpError(403, 'Verify your e-mail first', 'EMAIL_UNVERIFIED');
  if (u.selfExcludedUntil && u.selfExcludedUntil > new Date()) throw new HttpError(403, 'Rewards are paused while you are self-excluded');
}

/* ───────────────────────────── referral programme ───────────────────────────── */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
async function ensureReferralCode(userId: string, username: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
  if (u.referralCode) return u.referralCode;
  const base = username.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10);
  const candidates = [base.length >= 4 ? base : null, ...Array.from({ length: 5 }, () => (base.slice(0, 6) || 'WAVY') + Array.from(crypto.randomBytes(3), (b) => CODE_ALPHABET[b % 32]).join(''))].filter(Boolean) as string[];
  for (const code of candidates) {
    const taken = await prisma.user.findFirst({ where: { referralCode: { equals: code, mode: 'insensitive' } }, select: { id: true } });
    if (taken) continue;
    try {
      await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
      return code;
    } catch {
      /* race — try the next one */
    }
  }
  throw new HttpError(500, 'Could not create your code, try again');
}

r.get(
  '/referral',
  requireAuth,
  asyncH(async (req, res) => {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { username: true, referralEarned: true, referralPaid: true } });
    const code = await ensureReferralCode(req.user!.id, me.username);
    const [count, agg, recent] = await Promise.all([
      prisma.user.count({ where: { referredById: req.user!.id } }),
      prisma.user.aggregate({ where: { referredById: req.user!.id }, _sum: { wagered: true } }),
      prisma.user.findMany({ where: { referredById: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 20, select: { username: true, createdAt: true, wagered: true } }),
    ]);
    const earned = Number(me.referralEarned);
    const paid = Number(me.referralPaid);
    res.json({
      code,
      link: `${config.clientUrl.replace(/\/$/, '')}/?ref=${code}`,
      rate: config.referralRate,
      minClaim: config.referralMinClaim,
      friends: count,
      friendsWagered: Number(agg._sum.wagered ?? 0),
      earned: Math.floor(earned * 100) / 100,
      paid,
      claimable: Math.max(0, Math.floor((earned - paid) * 100) / 100),
      recent: recent.map((u) => ({ user: u.username.slice(0, 2) + '***' + u.username.slice(-1), joined: u.createdAt, wagered: Number(u.wagered) })),
    });
  })
);

r.post(
  '/referral/claim',
  requireAuth,
  asyncH(async (req, res) => {
    await requireVerified(req.user!.id);
    const out = await prisma.$transaction(async (db) => {
      const u = await db.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { referralEarned: true, referralPaid: true } });
      const amount = Math.floor((Number(u.referralEarned) - Number(u.referralPaid)) * 100) / 100;
      if (amount < config.referralMinClaim) throw new HttpError(400, `You can claim from $${config.referralMinClaim.toFixed(2)}`);
      const ok = await db.user.updateMany({ where: { id: req.user!.id, referralPaid: u.referralPaid }, data: { referralPaid: { increment: money(amount) } } });
      if (ok.count !== 1) throw new HttpError(409, 'Already claimed');
      await payBonus(db, req.user!.id, amount, 'Referral commission');
      const bal = await db.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { balance: true } });
      return { claimed: amount, balance: String(bal.balance) };
    });
    res.json(out);
  })
);

/* ───────────────────────────── daily reward wheel ───────────────────────────── */

/** prize table (USD, weight). EV ≈ $0.44 per spin */
export const SPIN_PRIZES: [number, number][] = [
  [0.1, 400],
  [0.25, 280],
  [0.5, 180],
  [1, 90],
  [2, 40],
  [5, 9],
  [25, 1],
];
const SPIN_TOTAL = SPIN_PRIZES.reduce((a, p) => a + p[1], 0);
const SPIN_GAP = 24 * 3600_000;

async function spinStatus(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { lastSpinAt: true, emailVerified: true } });
  const deposit = await prisma.transaction.findFirst({ where: { userId, type: 'DEPOSIT', status: 'COMPLETED' }, select: { id: true } });
  const week = await wageredBetween(userId, new Date(Date.now() - WEEK), new Date());
  const next = u.lastSpinAt ? u.lastSpinAt.getTime() + SPIN_GAP : 0;
  const reasons: string[] = [];
  if (!config.dailySpinEnabled) reasons.push('The reward wheel is paused');
  if (!u.emailVerified) reasons.push('Verify your e-mail');
  if (!deposit) reasons.push('Make your first deposit');
  if (week < config.dailySpinMinWager) reasons.push(`Wager $${config.dailySpinMinWager} in the last 7 days ($${week.toFixed(2)} so far)`);
  return { prizes: SPIN_PRIZES.map((p) => p[0]), nextAt: next > Date.now() ? new Date(next).toISOString() : null, ready: next <= Date.now() && reasons.length === 0, reasons, weekWager: week };
}

r.get('/spin', requireAuth, asyncH(async (req, res) => res.json(await spinStatus(req.user!.id))));

r.post(
  '/spin',
  requireAuth,
  asyncH(async (req, res) => {
    const st = await spinStatus(req.user!.id);
    if (st.reasons.length) throw new HttpError(400, st.reasons[0]);
    if (st.nextAt) throw new HttpError(429, 'Come back when the timer runs out');
    const roll = crypto.randomInt(0, SPIN_TOTAL);
    let acc = 0;
    let idx = 0;
    for (let i = 0; i < SPIN_PRIZES.length; i++) {
      acc += SPIN_PRIZES[i][1];
      if (roll < acc) {
        idx = i;
        break;
      }
    }
    const prize = SPIN_PRIZES[idx][0];
    const out = await prisma.$transaction(async (db) => {
      const cutoff = new Date(Date.now() - SPIN_GAP);
      const ok = await db.user.updateMany({ where: { id: req.user!.id, OR: [{ lastSpinAt: null }, { lastSpinAt: { lte: cutoff } }] }, data: { lastSpinAt: new Date() } });
      if (ok.count !== 1) throw new HttpError(429, 'Already spun today');
      await payBonus(db, req.user!.id, prize, 'Daily reward wheel', 1);
      const bal = await db.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { balance: true } });
      return { balance: String(bal.balance) };
    });
    res.json({ index: idx, prize, ...out, nextAt: new Date(Date.now() + SPIN_GAP).toISOString() });
  })
);

/* ───────────────────────────── weekly cashback ───────────────────────────── */

async function lossBetween(userId: string, from: Date, to: Date) {
  const [c, b] = await Promise.all([
    prisma.casinoRound.aggregate({ where: { userId, finishedAt: { gte: from, lt: to }, status: { not: 'ACTIVE' } }, _sum: { stake: true, payout: true } }),
    prisma.bet.aggregate({ where: { userId, settledAt: { gte: from, lt: to }, status: { not: 'VOID' } }, _sum: { stake: true, payout: true } }),
  ]);
  const staked = Number(c._sum.stake ?? 0) + Number(b._sum.stake ?? 0);
  const won = Number(c._sum.payout ?? 0) + Number(b._sum.payout ?? 0);
  return staked - won;
}

async function cashbackStatus(userId: string) {
  const thisWeek = weekStart();
  const lastWeek = new Date(thisWeek.getTime() - WEEK);
  const key = weekKey(lastWeek);
  const [u, lastLoss, curLoss] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { cashbackWeek: true } }),
    lossBetween(userId, lastWeek, thisWeek),
    lossBetween(userId, thisWeek, new Date()),
  ]);
  const amount = lastLoss >= config.cashbackMinLoss ? Math.min(config.cashbackMax, Math.floor(lastLoss * config.cashbackRate * 100) / 100) : 0;
  return {
    rate: config.cashbackRate,
    minLoss: config.cashbackMinLoss,
    max: config.cashbackMax,
    week: key,
    lastWeekLoss: Math.max(0, Math.round(lastLoss * 100) / 100),
    amount,
    claimed: u.cashbackWeek === key,
    claimable: amount > 0 && u.cashbackWeek !== key,
    thisWeekLoss: Math.max(0, Math.round(curLoss * 100) / 100),
    thisWeekEstimate: curLoss >= config.cashbackMinLoss ? Math.min(config.cashbackMax, Math.floor(curLoss * config.cashbackRate * 100) / 100) : 0,
    nextWeekStarts: new Date(thisWeek.getTime() + WEEK).toISOString(),
  };
}

r.get('/cashback', requireAuth, asyncH(async (req, res) => res.json(await cashbackStatus(req.user!.id))));

r.post(
  '/cashback/claim',
  requireAuth,
  asyncH(async (req, res) => {
    await requireVerified(req.user!.id);
    const st = await cashbackStatus(req.user!.id);
    if (!st.claimable) throw new HttpError(400, st.claimed ? 'Already claimed for last week' : `Cashback needs a net loss of at least $${config.cashbackMinLoss} last week`);
    const out = await prisma.$transaction(async (db) => {
      const ok = await db.user.updateMany({ where: { id: req.user!.id, OR: [{ cashbackWeek: null }, { cashbackWeek: { not: st.week } }] }, data: { cashbackWeek: st.week } });
      if (ok.count !== 1) throw new HttpError(409, 'Already claimed');
      await payBonus(db, req.user!.id, st.amount, `Weekly cashback ${st.week}`);
      const bal = await db.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { balance: true } });
      return { claimed: st.amount, balance: String(bal.balance) };
    });
    res.json(out);
  })
);

/* ───────────────────────────── daily missions ───────────────────────────── */

interface MissionDef {
  id: string;
  title: string;
  goal: number;
  reward: number;
  unit: '$' | '';
}
const MISSIONS: MissionDef[] = [
  { id: 'wager50', title: 'Wager $50 today', goal: 50, reward: 0.5, unit: '$' },
  { id: 'rounds30', title: 'Play 30 Originals rounds', goal: 30, reward: 0.3, unit: '' },
  { id: 'sports3', title: 'Place 3 sports bets', goal: 3, reward: 0.3, unit: '' },
  { id: 'win2x', title: 'Win a sports bet at odds 2.00+', goal: 1, reward: 0.5, unit: '' },
  { id: 'games3', title: 'Try 3 different Originals', goal: 3, reward: 0.25, unit: '' },
];

async function missionProgress(userId: string) {
  const from = dayStart();
  const to = new Date(from.getTime() + 86_400_000);
  const [wager, rounds, sports, win2x, games, claims] = await Promise.all([
    wageredBetween(userId, from, to),
    prisma.casinoRound.count({ where: { userId, createdAt: { gte: from, lt: to }, status: { not: 'ACTIVE' } } }),
    prisma.bet.count({ where: { userId, createdAt: { gte: from, lt: to } } }),
    prisma.bet.count({ where: { userId, settledAt: { gte: from, lt: to }, status: 'WON', totalOdds: { gte: 2 } } }),
    prisma.casinoRound.groupBy({ by: ['game'], where: { userId, createdAt: { gte: from, lt: to } } }),
    prisma.missionClaim.findMany({ where: { userId, day: dayKey(from) }, select: { missionId: true } }),
  ]);
  const value: Record<string, number> = { wager50: wager, rounds30: rounds, sports3: sports, win2x, games3: games.length };
  const done = new Set(claims.map((c) => c.missionId));
  return {
    day: dayKey(from),
    resetsAt: to.toISOString(),
    missions: MISSIONS.map((m) => ({
      ...m,
      progress: Math.min(m.goal, Math.round(value[m.id] * 100) / 100),
      complete: value[m.id] >= m.goal,
      claimed: done.has(m.id),
    })),
  };
}

r.get('/missions', requireAuth, asyncH(async (req, res) => res.json(await missionProgress(req.user!.id))));

r.post(
  '/missions/:id/claim',
  requireAuth,
  asyncH(async (req, res) => {
    await requireVerified(req.user!.id);
    const st = await missionProgress(req.user!.id);
    const m = st.missions.find((x) => x.id === req.params.id);
    if (!m) throw new HttpError(404, 'Unknown mission');
    if (m.claimed) throw new HttpError(409, 'Already claimed');
    if (!m.complete) throw new HttpError(400, 'Mission not completed yet');
    const out = await prisma.$transaction(async (db) => {
      try {
        await db.missionClaim.create({ data: { userId: req.user!.id, day: st.day, missionId: m.id, reward: money(m.reward) } });
      } catch {
        throw new HttpError(409, 'Already claimed');
      }
      await payBonus(db, req.user!.id, m.reward, `Mission: ${m.title}`, 1);
      const bal = await db.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { balance: true } });
      return { claimed: m.reward, balance: String(bal.balance) };
    });
    res.json(out);
  })
);

/* ───────────────────────────── weekly tournament ───────────────────────────── */

/** prize split for places 1–10 (sums to 1) */
export const TOURNAMENT_SPLIT = [0.3, 0.2, 0.12, 0.09, 0.07, 0.06, 0.05, 0.04, 0.04, 0.03];

async function leaderboard(from: Date, to: Date, limit = 50) {
  const [c, b] = await Promise.all([
    prisma.casinoRound.groupBy({ by: ['userId'], where: { createdAt: { gte: from, lt: to }, status: { not: 'ACTIVE' } }, _sum: { stake: true } }),
    prisma.bet.groupBy({ by: ['userId'], where: { createdAt: { gte: from, lt: to }, status: { not: 'VOID' } }, _sum: { stake: true } }),
  ]);
  const m = new Map<string, number>();
  for (const x of c) m.set(x.userId, (m.get(x.userId) ?? 0) + Number(x._sum.stake ?? 0));
  for (const x of b) m.set(x.userId, (m.get(x.userId) ?? 0) + Number(x._sum.stake ?? 0));
  const rows = [...m.entries()].filter(([, w]) => w >= config.tournamentMinWager).sort((a, b2) => b2[1] - a[1]);
  const top = rows.slice(0, limit);
  const users = await prisma.user.findMany({ where: { id: { in: top.map((t) => t[0]) }, role: 'USER' }, select: { id: true, username: true } });
  const names = new Map(users.map((u) => [u.id, u.username]));
  // admins / test accounts never take prizes
  const ranked = top.filter(([id]) => names.has(id));
  return { rows: ranked.map(([id, w], i) => ({ rank: i + 1, userId: id, username: names.get(id)!, wagered: Math.round(w * 100) / 100 })), all: rows };
}

let lastSettleCheck = 0;
/** pays last week's winners once (idempotent: unique week+rank) */
async function settlePreviousWeek() {
  if (Date.now() - lastSettleCheck < 5 * 60_000) return;
  lastSettleCheck = Date.now();
  const thisWeek = weekStart();
  const prev = new Date(thisWeek.getTime() - WEEK);
  const key = weekKey(prev);
  const done = await prisma.tournamentPayout.count({ where: { week: key } });
  if (done > 0 || config.tournamentPool <= 0) return;
  const { rows } = await leaderboard(prev, thisWeek, TOURNAMENT_SPLIT.length);
  for (const row of rows) {
    const amount = Math.floor(config.tournamentPool * TOURNAMENT_SPLIT[row.rank - 1] * 100) / 100;
    if (amount <= 0) continue;
    try {
      await prisma.$transaction(async (db) => {
        await db.tournamentPayout.create({ data: { week: key, rank: row.rank, userId: row.userId, wagered: money(row.wagered), amount: money(amount) } });
        await payBonus(db, row.userId, amount, `Weekly race ${key} · #${row.rank}`);
      });
    } catch {
      /* already paid by another instance */
    }
  }
}

const mask = (name: string) => (name.length <= 3 ? name[0] + '**' : name.slice(0, 2) + '***' + name.slice(-1));
let boardCache: { at: number; data: unknown } | null = null;

r.get(
  '/tournament',
  optionalAuth,
  asyncH(async (req, res) => {
    await settlePreviousWeek().catch((e) => console.error('[tournament] settle failed', e));
    const start = weekStart();
    const end = new Date(start.getTime() + WEEK);
    if (!boardCache || Date.now() - boardCache.at > 60_000) {
      const { rows } = await leaderboard(start, end, 50);
      const prevKey = weekKey(new Date(start.getTime() - WEEK));
      const winners = await prisma.tournamentPayout.findMany({ where: { week: prevKey }, orderBy: { rank: 'asc' } });
      const wu = await prisma.user.findMany({ where: { id: { in: winners.map((w) => w.userId) } }, select: { id: true, username: true } });
      const wn = new Map(wu.map((u) => [u.id, u.username]));
      boardCache = {
        at: Date.now(),
        data: {
          week: weekKey(start),
          endsAt: end.toISOString(),
          pool: config.tournamentPool,
          minWager: config.tournamentMinWager,
          prizes: TOURNAMENT_SPLIT.map((p) => Math.floor(config.tournamentPool * p * 100) / 100),
          rows: rows.map((x) => ({ ...x, user: mask(String(x.username)) })),
          lastWeek: { week: prevKey, winners: winners.map((w) => ({ rank: w.rank, user: mask(String(wn.get(String(w.userId)) ?? "?")), amount: Number(w.amount), wagered: Number(w.wagered) })) },
        },
      };
    }
    const data = boardCache.data as { rows: { userId: string; username: string; user: string; rank: number; wagered: number }[] } & Record<string, unknown>;
    // "you" row for logged-in players (token optional)
    let me: { rank: number | null; wagered: number } | null = null;
    const uid = (req as { user?: { id: string } }).user?.id;
    if (uid) {
      const mine = data.rows.find((x) => x.userId === uid);
      me = mine ? { rank: mine.rank, wagered: mine.wagered } : { rank: null, wagered: await wageredBetween(uid, start, end) };
    }
    res.json({ ...data, rows: data.rows.map(({ userId, username: _u, ...x }) => ({ ...x, me: userId === uid })), me });
  })
);

/* admin: quick overview of reward costs this week */
export const rewardsWeekCost = async () => {
  const from = weekStart();
  const agg = await prisma.transaction.aggregate({ where: { type: 'BONUS', createdAt: { gte: from } }, _sum: { amount: true } });
  return Number(agg._sum.amount ?? 0);
};

export default r;
