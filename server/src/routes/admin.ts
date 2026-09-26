import { Prisma } from '@prisma/client';
import { tierOf } from '../services/rewards';
import { emailProvider, lastEmailFailure, sendVerificationEmail } from '../services/email';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { asyncH, HttpError } from '../lib/http';
import { D, money, prisma } from '../lib/prisma';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { nowpayments } from '../services/nowpayments';
import { feed } from '../services/feed';
import { af, afStatus } from '../services/apifootball';
import { evaluateBets, settleEvent, voidEvent } from '../services/settlement';
import { applyBalanceChange } from '../services/wallet';
import { refundWithdrawal } from './wallet';
import { publicUser } from './auth';
import { invalidateMarkets, seenBetTypes } from '../services/markets';
import { grantFirstDepositBonus } from '../services/rewards';

const r = Router();
r.use(requireAuth, requireAdmin);

r.get(
  '/stats',
  asyncH(async (_req, res) => {
    const since = new Date(Date.now() - 30 * 86400_000);
    const [users, newUsers, deposits, withdrawals, pendingW, pendingD, openBets, stakes, payouts, balances, quota, casino] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: since } } }),
      prisma.transaction.aggregate({ where: { type: 'DEPOSIT', status: 'COMPLETED', createdAt: { gte: since } }, _sum: { amount: true }, _count: true }),
      prisma.transaction.aggregate({ where: { type: 'WITHDRAWAL', status: 'COMPLETED', createdAt: { gte: since } }, _sum: { amount: true }, _count: true }),
      prisma.transaction.aggregate({ where: { type: 'WITHDRAWAL', status: 'PENDING' }, _sum: { amount: true }, _count: true }),
      prisma.transaction.aggregate({ where: { type: 'DEPOSIT', status: 'PENDING', txHash: { not: null } }, _sum: { amount: true }, _count: true }),
      prisma.bet.aggregate({ where: { status: 'OPEN' }, _sum: { stake: true, potentialPayout: true }, _count: true }),
      prisma.bet.aggregate({ where: { createdAt: { gte: since } }, _sum: { stake: true } }),
      prisma.bet.aggregate({ where: { settledAt: { gte: since } }, _sum: { payout: true } }),
      prisma.user.aggregate({ _sum: { balance: true } }),
      prisma.setting.findUnique({ where: { key: 'odds_quota_remaining' } }),
      prisma.casinoRound.aggregate({ where: { createdAt: { gte: since }, status: { not: 'ACTIVE' } }, _sum: { stake: true, payout: true }, _count: true }),
    ]);
    const n = (v: unknown) => Number(v ?? 0);
    res.json({
      users, newUsers30d: newUsers,
      deposits30d: { sum: n(deposits._sum.amount), count: deposits._count },
      withdrawals30d: { sum: Math.abs(n(withdrawals._sum.amount)), count: withdrawals._count },
      pendingWithdrawals: { sum: Math.abs(n(pendingW._sum.amount)), count: pendingW._count },
      pendingDeposits: { sum: n(pendingD._sum.amount), count: pendingD._count },
      paymentMode: config.paymentMode,
      casino30d: { rounds: casino._count, wagered: n(casino._sum.stake), ggr: n(casino._sum.stake) - n(casino._sum.payout) },
      openBets: { count: openBets._count, stake: n(openBets._sum.stake), liability: n(openBets._sum.potentialPayout) },
      ggr30d: n(stakes._sum.stake) - n(payouts._sum.payout),
      playerBalances: n(balances._sum.balance),
      oddsQuotaRemaining: quota ? Number(quota.value) : null,
      withdrawalMode: config.withdrawalMode,
      feed: feed.name,
    });
  })
);

/* -------------------------------- Users ---------------------------------- */

r.get(
  '/users',
  asyncH(async (req, res) => {
    const { q } = z.object({ q: z.string().optional() }).parse(req.query);
    const users = await prisma.user.findMany({
      where: q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { username: { contains: q, mode: 'insensitive' } }, { id: q }] } : {},
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ users: users.map((u) => ({ ...publicUser(u), isBanned: u.isBanned, lastLoginAt: u.lastLoginAt })) });
  })
);

r.post(
  '/users/:id/ban',
  asyncH(async (req, res) => {
    const { banned } = z.object({ banned: z.boolean() }).parse(req.body);
    await prisma.user.update({ where: { id: req.params.id }, data: { isBanned: banned } });
    if (banned) await prisma.refreshToken.updateMany({ where: { userId: req.params.id }, data: { revokedAt: new Date() } });
    res.json({ ok: true });
  })
);

/** send a test verification e-mail to the admin and return the provider's raw answer */
r.post(
  '/test-email',
  asyncH(async (req, res) => {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    const to = typeof req.body?.to === 'string' && req.body.to.includes('@') ? req.body.to : me.email;
    try {
      await sendVerificationEmail(to, me.username, '123456');
      res.json({ ok: true, provider: emailProvider(), to });
    } catch (e) {
      res.json({ ok: false, provider: emailProvider(), to, error: (e as Error).message, raw: lastEmailFailure });
    }
  })
);

/** every sports bet on the site, newest first, with totals for the current filter */
r.get(
  '/bets',
  asyncH(async (req, res) => {
    const q = z
      .object({
        status: z.enum(['all', 'OPEN', 'WON', 'LOST', 'CASHOUT', 'VOID']).default('all'),
        type: z.enum(['all', 'SINGLE', 'PARLAY', 'BUILDER']).default('all'),
        q: z.string().trim().max(80).optional(),
        minStake: z.coerce.number().min(0).optional(),
        days: z.coerce.number().int().min(1).max(365).default(7),
        cursor: z.string().optional(),
      })
      .parse(req.query);
    const since = new Date(Date.now() - q.days * 86_400_000);
    const where: Prisma.BetWhereInput = {
      createdAt: { gte: since },
      ...(q.status !== 'all' ? { status: q.status } : {}),
      ...(q.type !== 'all' ? { type: q.type } : {}),
      ...(q.minStake ? { stake: { gte: q.minStake } } : {}),
      ...(q.q
        ? {
            OR: [
              { user: { username: { contains: q.q, mode: 'insensitive' } } },
              { user: { email: { contains: q.q, mode: 'insensitive' } } },
              { id: q.q },
              { selections: { some: { eventLabel: { contains: q.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [bets, byStatus, openAgg, exposure] = await Promise.all([
      prisma.bet.findMany({
        where,
        include: { user: { select: { username: true, email: true, wagered: true } }, selections: true },
        orderBy: { createdAt: 'desc' },
        take: 51,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      prisma.bet.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { stake: true, payout: true } }),
      prisma.bet.aggregate({ where: { ...where, status: 'OPEN' }, _sum: { potentialPayout: true, stake: true }, _count: { _all: true } }),
      // biggest open liability per match (all open bets, any date)
      prisma.betSelection.groupBy({
        by: ['eventId', 'eventLabel'],
        where: { status: 'OPEN', bet: { status: 'OPEN' } },
        _count: { _all: true },
        orderBy: { _count: { eventId: 'desc' } },
        take: 8,
      }),
    ]);
    const next = bets.length > 50 ? bets[50].id : null;
    const list = bets.slice(0, 50);
    let staked = 0;
    let paid = 0;
    let settledStake = 0;
    const counts: Record<string, number> = {};
    for (const g of byStatus) {
      counts[g.status] = g._count._all;
      staked += Number(g._sum.stake ?? 0);
      if (g.status !== 'OPEN') {
        paid += Number(g._sum.payout ?? 0);
        settledStake += Number(g._sum.stake ?? 0);
      }
    }
    // open liability per match: sum of potential payouts of open bets touching that match
    const expRows = await Promise.all(
      exposure.map(async (e) => {
        const agg = await prisma.bet.aggregate({ where: { status: 'OPEN', selections: { some: { eventId: e.eventId, status: 'OPEN' } } }, _sum: { potentialPayout: true, stake: true } });
        return { eventId: e.eventId, event: e.eventLabel, bets: e._count._all, stake: Number(agg._sum.stake ?? 0), liability: Number(agg._sum.potentialPayout ?? 0) };
      })
    );
    res.json({
      bets: list.map((b) => ({
        id: b.id,
        type: b.type,
        status: b.status,
        stake: String(b.stake),
        totalOdds: String(b.totalOdds),
        potentialPayout: String(b.potentialPayout),
        payout: b.payout == null ? null : String(b.payout),
        createdAt: b.createdAt,
        settledAt: b.settledAt,
        user: { username: b.user.username, email: b.user.email, tier: tierOf(Number(b.user.wagered)).tier.id },
        live: b.selections.some((s) => s.commenceTime <= b.createdAt),
        selections: b.selections.map((s) => ({
          id: s.id,
          eventLabel: s.eventLabel,
          sportTitle: s.sportTitle,
          marketKey: s.marketKey,
          outcomeName: s.outcomeName,
          odds: String(s.odds),
          status: s.status,
          commenceTime: s.commenceTime,
        })),
      })),
      next,
      summary: {
        count: Object.values(counts).reduce((a, b) => a + b, 0),
        counts,
        staked: Math.round(staked * 100) / 100,
        paid: Math.round(paid * 100) / 100,
        ggr: Math.round((settledStake - paid) * 100) / 100,
        openCount: openAgg._count._all,
        openStake: Number(openAgg._sum.stake ?? 0),
        openLiability: Number(openAgg._sum.potentialPayout ?? 0),
      },
      exposure: expRows.sort((a, b) => b.liability - a.liability),
    });
  })
);

/** manually confirm a player's e-mail (support case, e.g. the e-mail never arrived) */
r.post(
  '/users/:id/verify-email',
  asyncH(async (req, res) => {
    await prisma.user.update({ where: { id: req.params.id }, data: { emailVerified: true, verifyCodeHash: null, verifyCodeExpires: null, verifyAttempts: 0 } });
    res.json({ ok: true });
  })
);

r.post(
  '/users/:id/adjust',
  asyncH(async (req, res) => {
    const { amount, note } = z.object({ amount: z.number().refine((v) => v !== 0), note: z.string().min(3).max(200) }).parse(req.body);
    const tx = await prisma.$transaction((db) =>
      applyBalanceChange(db, { userId: req.params.id, amount: money(amount), type: 'ADJUSTMENT', note: `Admin: ${note}` })
    );
    res.json({ ok: true, balanceAfter: String(tx.balanceAfter) });
  })
);

r.post(
  '/users/:id/kyc',
  asyncH(async (req, res) => {
    const { status } = z.object({ status: z.enum(['NONE', 'PENDING', 'VERIFIED', 'REJECTED']) }).parse(req.body);
    await prisma.user.update({ where: { id: req.params.id }, data: { kycStatus: status } });
    res.json({ ok: true });
  })
);

/* --------------------------- Manual deposits ----------------------------- */

r.get(
  '/deposits',
  asyncH(async (req, res) => {
    const { status } = z.object({ status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED', 'FAILED']).default('PENDING') }).parse(req.query);
    const items = await prisma.transaction.findMany({
      where: { type: 'DEPOSIT', status, ...(status === 'PENDING' ? { txHash: { not: null } } : {}) },
      include: { user: { select: { username: true, email: true, kycStatus: true } } },
      orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
      take: 100,
    });
    res.json({ items: items.map((t) => ({ ...t, amount: String(t.amount), balanceAfter: undefined })) });
  })
);

/** Credit a manual deposit after checking the payment on the blockchain. Amount can be corrected. */
r.post(
  '/deposits/:id/approve',
  asyncH(async (req, res) => {
    const { amount } = z.object({ amount: z.number().positive().max(1_000_000).optional() }).parse(req.body);
    const tx = await prisma.transaction.findFirst({ where: { id: req.params.id, type: 'DEPOSIT', status: 'PENDING' } });
    if (!tx) throw new HttpError(404, 'Pending deposit not found');
    const credit = amount != null ? money(amount) : D(tx.amount);
    await prisma.$transaction(async (db) => {
      const flipped = await db.transaction.updateMany({
        where: { id: tx.id, status: 'PENDING' },
        data: { status: 'COMPLETED', amount: credit, note: amount != null && !credit.eq(tx.amount) ? `Approved (amount corrected from ${tx.amount})` : 'Approved' },
      });
      if (flipped.count !== 1) throw new HttpError(409, 'Already processed');
      const u = await db.user.update({ where: { id: tx.userId }, data: { balance: { increment: credit } } });
      await db.transaction.update({ where: { id: tx.id }, data: { balanceAfter: u.balance } });
      await grantFirstDepositBonus(db, tx.userId, credit);
    });
    res.json({ ok: true, credited: String(credit) });
  })
);

r.post(
  '/deposits/:id/reject',
  asyncH(async (req, res) => {
    const { reason } = z.object({ reason: z.string().min(3).max(200) }).parse(req.body);
    const r2 = await prisma.transaction.updateMany({
      where: { id: req.params.id, type: 'DEPOSIT', status: 'PENDING' },
      data: { status: 'FAILED', note: `Rejected: ${reason}` },
    });
    if (!r2.count) throw new HttpError(404, 'Pending deposit not found');
    res.json({ ok: true });
  })
);

/* ----------------------------- Withdrawals ------------------------------- */

r.get(
  '/withdrawals',
  asyncH(async (req, res) => {
    const { status } = z.object({ status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED', 'FAILED']).default('PENDING') }).parse(req.query);
    const items = await prisma.transaction.findMany({
      where: { type: 'WITHDRAWAL', status },
      include: { user: { select: { username: true, email: true, kycStatus: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    res.json({ items: items.map((t) => ({ ...t, amount: String(D(t.amount).abs()), balanceAfter: undefined })) });
  })
);

r.post(
  '/withdrawals/:id/approve',
  asyncH(async (req, res) => {
    const { txHash } = z.object({ txHash: z.string().max(200).optional() }).parse(req.body);
    const tx = await prisma.transaction.findFirst({ where: { id: req.params.id, type: 'WITHDRAWAL', status: 'PENDING' } });
    if (!tx) throw new HttpError(404, 'Pending withdrawal not found');
    if (tx.providerId) throw new HttpError(400, 'Payout already sent to provider');

    if (config.withdrawalMode === 'manual') {
      if (!txHash) throw new HttpError(400, 'Paste the blockchain transaction hash after you send the funds');
      await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'COMPLETED', txHash } });
      return res.json({ ok: true, status: 'COMPLETED' });
    }

    const usd = Number(D(tx.amount).abs());
    const cryptoAmount = await nowpayments.estimate(usd, tx.cryptoCurrency!);
    const extraId = tx.note?.startsWith('Memo/Tag: ') ? tx.note.slice(10) : undefined;
    const payout = await nowpayments.createPayout(tx.address!, tx.cryptoCurrency!, cryptoAmount, extraId);
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { providerId: String(payout.withdrawals?.[0]?.id ?? payout.id), cryptoAmount: String(cryptoAmount) },
    });
    res.json({ ok: true, status: 'PENDING', note: config.np2faSecret ? 'Payout sent' : 'Payout created — confirm it with 2FA in your NOWPayments dashboard' });
  })
);

r.post(
  '/withdrawals/:id/reject',
  asyncH(async (req, res) => {
    const { reason } = z.object({ reason: z.string().min(3).max(200) }).parse(req.body);
    await refundWithdrawal(req.params.id, `Rejected: ${reason}`);
    res.json({ ok: true });
  })
);

/* --------------------------- Events & odds ------------------------------- */

r.get(
  '/events',
  asyncH(async (req, res) => {
    const { q, status } = z.object({ q: z.string().optional(), status: z.enum(['UPCOMING', 'LIVE', 'COMPLETED', 'CANCELLED']).optional() }).parse(req.query);
    const events = await prisma.event.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(q ? { OR: [{ homeTeam: { contains: q, mode: 'insensitive' } }, { awayTeam: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { commenceTime: status === 'UPCOMING' ? 'asc' : 'desc' },
      take: 100,
    });
    const open = await prisma.betSelection.groupBy({ by: ['eventId'], where: { eventId: { in: events.map((e) => e.id) }, status: 'OPEN' }, _count: { _all: true } });
    const oc = Object.fromEntries(open.map((o) => [o.eventId, o._count._all]));
    res.json({ events: events.map((e) => ({ ...e, openSelections: oc[e.id] ?? 0 })) });
  })
);

r.post(
  '/events/:id/featured',
  asyncH(async (req, res) => {
    const { featured } = z.object({ featured: z.boolean() }).parse(req.body);
    await prisma.event.update({ where: { id: req.params.id }, data: { featured } });
    res.json({ ok: true });
  })
);

/** Every bet type the odds feeds have sent since the server started, and which market we map it to. */
r.get(
  '/feed-bet-types',
  asyncH(async (_req, res) => {
    const list = [...seenBetTypes.entries()].map(([k, v]) => ({ name: k.slice(k.indexOf(':') + 1), ...v })).sort((a, b) => b.count - a.count);
    res.json({ types: list });
  })
);

/** Manual result entry — for events the feed never finalises */
r.post(
  '/events/:id/settle',
  asyncH(async (req, res) => {
    const b = z
      .object({
        homeScore: z.number().int().min(0),
        awayScore: z.number().int().min(0),
        htHome: z.number().int().min(0).optional(),
        htAway: z.number().int().min(0).optional(),
        cornersHome: z.number().int().min(0).optional(),
        cornersAway: z.number().int().min(0).optional(),
      })
      .parse(req.body);
    await prisma.event.update({ where: { id: req.params.id }, data: { ...b, status: 'COMPLETED' } });
    await prisma.market.updateMany({ where: { eventId: req.params.id }, data: { suspended: true } });
    invalidateMarkets([req.params.id]);
    const settled = await settleEvent(req.params.id);
    res.json({ ok: true, settled });
  })
);

r.post(
  '/events/:id/void',
  asyncH(async (req, res) => {
    await prisma.market.updateMany({ where: { eventId: req.params.id }, data: { suspended: true } });
    invalidateMarkets([req.params.id]);
    const settled = await voidEvent(req.params.id);
    res.json({ ok: true, settled });
  })
);

r.post(
  '/bets/:id/void',
  asyncH(async (req, res) => {
    const bet = await prisma.bet.findUniqueOrThrow({ where: { id: req.params.id } });
    if (bet.status !== 'OPEN') throw new HttpError(400, 'Only open bets can be voided');
    // full void: stake back, regardless of legs already graded
    await prisma.betSelection.updateMany({ where: { betId: req.params.id }, data: { status: 'VOID' } });
    await evaluateBets([req.params.id]);
    res.json({ ok: true });
  })
);

r.get(
  '/sports',
  asyncH(async (_req, res) => {
    res.json({ sports: await prisma.sport.findMany({ where: { provider: config.provider }, orderBy: [{ group: 'asc' }, { title: 'asc' }] }) });
  })
);

r.post(
  '/sports/:key',
  asyncH(async (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    await prisma.sport.update({ where: { key: req.params.key }, data: { enabled } });
    res.json({ ok: true });
  })
);

r.get(
  '/feed-status',
  asyncH(async (_req, res) => {
    if (config.provider !== 'apifootball') return res.json({ feed: feed.name, ok: feed.hasKey });
    if (!config.afKey) return res.json({ feed: feed.name, ok: false, error: 'APIFOOTBALL_KEY is not set' });
    const d = (await afStatus()) as { errors?: unknown; response?: { subscription?: { plan?: string; end?: string; active?: boolean }; requests?: { current?: number; limit_day?: number } } };
    const errs = d.errors && (Array.isArray(d.errors) ? d.errors.length : Object.keys(d.errors as object).length);
    if (errs) return res.json({ feed: feed.name, ok: false, error: JSON.stringify(d.errors) });
    res.json({
      feed: feed.name, ok: true,
      plan: d.response?.subscription?.plan, active: d.response?.subscription?.active, ends: d.response?.subscription?.end,
      usedToday: d.response?.requests?.current, limitPerDay: d.response?.requests?.limit_day,
    });
  })
);

/** Live diagnostics: what API-Football has in play right now vs. what the site holds. */
r.get(
  '/live-check',
  asyncH(async (_req, res) => {
    if (config.provider !== 'apifootball') return res.json({ error: 'Live betting needs ODDS_PROVIDER=apifootball' });
    const now = new Date();
    const out: Record<string, unknown> = {
      serverTime: now.toISOString(),
      liveBettingEnabled: config.liveBetting,
      liveIntervalSec: config.liveOddsIntervalMs / 1000,
    };
    const sports = await prisma.sport.findMany({ where: { provider: 'apifootball', enabled: true, active: true }, select: { key: true } });
    const ours = new Set(sports.map((s) => Number(s.key.replace('soccer_af_', ''))));
    out.leaguesSynced = ours.size;
    try {
      const fx = await af<{ fixture: { id: number }; league: { id: number; name: string }; teams: { home: { name: string }; away: { name: string } } }>('/fixtures', { live: 'all' });
      const inOurs = fx.response.filter((f) => ours.has(f.league.id));
      out.liveMatchesWorldwide = fx.results;
      out.liveMatchesInYourLeagues = inOurs.length;
      out.examplesInYourLeagues = inOurs.slice(0, 5).map((f) => `${f.teams.home.name} vs ${f.teams.away.name} (${f.league.name})`);
    } catch (e) {
      out.fixturesError = (e as Error).message;
    }
    try {
      const od = await af<{ fixture: { id: number } }>('/odds/live', {});
      out.matchesWithLiveOdds = od.results;
      const liveIds = new Set(od.response.map((o) => `af_${o.fixture.id}`));
      const dbLive = await prisma.event.findMany({ where: { status: 'LIVE', id: { startsWith: 'af_' } }, select: { id: true, liveUpdatedAt: true } });
      out.liveMatchesOnSite = dbLive.length;
      out.liveMatchesOnSiteWithOdds = dbLive.filter((e) => liveIds.has(e.id)).length;
      const last = dbLive.map((e) => e.liveUpdatedAt?.getTime() ?? 0).sort((a, b) => b - a)[0];
      out.lastLiveOddsUpdateSecAgo = last ? Math.round((now.getTime() - last) / 1000) : null;
    } catch (e) {
      out.liveOddsError = (e as Error).message;
    }
    res.json(out);
  })
);

r.post(
  '/sync',
  asyncH(async (req, res) => {
    const { what } = z.object({ what: z.enum(['sports', 'odds', 'scores']) }).parse(req.body);
    const result = what === 'sports' ? await feed.syncSports() : what === 'odds' ? await feed.syncOdds() : await feed.syncScores();
    res.json({ ok: true, result });
  })
);

export default r;
