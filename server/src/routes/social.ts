import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncH, HttpError } from '../lib/http';
import { prisma } from '../lib/prisma';
import { optionalAuth, requireAdmin, requireAuth } from '../middleware/auth';
import { GAME_NAMES } from '../casino/service';
import { tierOf } from '../services/rewards';
import { outcomeOpen } from '../services/open';
import { broadcast, streamClientCount } from '../services/stream';

/**
 * Social layer: public bet feed, global chat room (pushed live over the SSE stream) and private
 * customer-support threads between a player and the support team (admins).
 */
const r = Router();

const mask = (name: string) => (name.length <= 3 ? `${name[0]}**` : `${name.slice(0, 2)}${'*'.repeat(Math.min(4, name.length - 3))}${name.slice(-1)}`);

/* ─────────────────────────────── bet feed ─────────────────────────────── */

const displayName = (u: { username: string; hideInFeed: boolean }, own: boolean) => (own || !u.hideInFeed ? u.username : 'Hidden');
const feedUser = { select: { username: true, wagered: true, hideInFeed: true } } as const;

r.get(
  '/feed',
  optionalAuth,
  asyncH(async (req, res) => {
    const q = z.object({ tab: z.enum(['all', 'high', 'mine', 'sports', 'casino']).default('all') }).parse(req.query);
    let userId: string | undefined;
    if (q.tab === 'mine') {
      if (!req.user) throw new HttpError(401, 'Not authenticated');
      userId = req.user.id;
    }
    const high = q.tab === 'high' ? { gte: 100 } : undefined;
    const [rounds, bets] = await Promise.all([
      prisma.casinoRound.findMany({
            where: { status: { not: 'ACTIVE' }, ...(userId ? { userId } : {}), ...(high ? { stake: high } : {}) },
            include: { user: feedUser },
            orderBy: { createdAt: 'desc' },
            take: q.tab === 'sports' ? 0 : 25,
          }),
      prisma.bet.findMany({
            // every sports bet shows as soon as it is placed (open), then again with its result
            where: { ...(userId ? { userId } : {}), ...(high ? { stake: high } : {}), status: { not: 'VOID' } },
            include: {
              user: feedUser,
              selections: { select: { outcomeId: true, eventId: true, eventLabel: true, sportTitle: true, marketKey: true, outcomeName: true, odds: true, status: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: q.tab === 'casino' ? 0 : 25,
          }),
    ]);
    const rows = [
      ...rounds.map((x) => {
        const t = tierOf(Number(x.user.wagered)).tier;
        return {
          id: x.id,
          kind: 'casino' as const,
          game: GAME_NAMES[x.game] ?? x.game,
          gameId: x.game,
          user: displayName(x.user, x.userId === req.user?.id),
          hidden: x.user.hideInFeed,
          tier: t.id,
          tierName: t.name,
          at: x.finishedAt ?? x.createdAt,
          stake: String(x.stake),
          multiplier: Number(x.multiplier),
          payout: String(x.payout),
          status: x.status,
        };
      }),
      ...bets.map((b) => {
        const t = tierOf(Number(b.user.wagered)).tier;
        return {
          id: b.id,
          kind: 'sport' as const,
          game: b.type === 'PARLAY' ? `Parlay · ${b.selections.length} legs` : b.type === 'BUILDER' ? 'Bet Builder' : b.selections[0]?.eventLabel ?? 'Sports',
          gameId: 'sports',
          user: displayName(b.user, b.userId === req.user?.id),
          hidden: b.user.hideInFeed,
          tier: t.id,
          tierName: t.name,
          at: b.status === 'OPEN' ? b.createdAt : b.settledAt ?? b.createdAt,
          stake: String(b.stake),
          multiplier: b.status === 'OPEN' ? Number(b.totalOdds) : Number(b.payout ?? 0) / Number(b.stake),
          payout: String(b.status === 'OPEN' ? b.potentialPayout : b.payout ?? 0),
          status: b.status,
          odds: Number(b.totalOdds),
          // selections so other players can copy the bet
          picks:
            b.type === 'BUILDER'
              ? undefined
              : b.selections.map((s) => ({ outcomeId: s.outcomeId, eventId: s.eventId, eventLabel: s.eventLabel, sportTitle: s.sportTitle, marketKey: s.marketKey, outcomeName: s.outcomeName, odds: Number(s.odds), status: s.status })),
        };
      }),
    ]
      .sort((a, b) => +new Date(b.at) - +new Date(a.at))
      .slice(0, 25);
    res.json({ rows });
  })
);

/** most-backed selections right now (open markets only) */
let trendCache: { at: number; data: unknown } | null = null;
r.get(
  '/trending',
  asyncH(async (_req, res) => {
    if (trendCache && Date.now() - trendCache.at < 60_000) return res.json(trendCache.data);
    const since = new Date(Date.now() - 24 * 3600_000);
    const groups = await prisma.betSelection.groupBy({
      by: ['outcomeId'],
      where: { bet: { createdAt: { gte: since } }, status: 'OPEN' },
      _count: { _all: true },
      _sum: { odds: true },
      orderBy: { _count: { outcomeId: 'desc' } },
      take: 30,
    });
    const outcomes = await prisma.outcome.findMany({ where: { id: { in: groups.map((g) => g.outcomeId) } }, include: { market: { include: { event: true } } } });
    const now = new Date();
    const byId = new Map(outcomes.map((o) => [o.id, o]));
    const picks = groups
      .map((g) => {
        const o = byId.get(g.outcomeId);
        if (!o || !outcomeOpen(o, now)) return null;
        const ev = o.market.event;
        return {
          outcomeId: o.id,
          eventId: ev.id,
          eventLabel: `${ev.homeTeam} vs ${ev.awayTeam}`,
          homeTeam: ev.homeTeam,
          awayTeam: ev.awayTeam,
          sportTitle: ev.sportTitle,
          commenceTime: ev.commenceTime,
          live: ev.status === 'LIVE',
          marketKey: o.market.key,
          outcomeName: o.name,
          odds: Number(o.price),
          bets: g._count._all,
        };
      })
      .filter(Boolean)
      .slice(0, 12);
    const data = { picks };
    trendCache = { at: Date.now(), data };
    res.json(data);
  })
);

/** public player card (hidden players are private) */
r.get(
  '/players/:name',
  asyncH(async (req, res) => {
    const u = await prisma.user.findFirst({
      where: { username: { equals: String(req.params.name), mode: 'insensitive' } },
      select: { id: true, username: true, wagered: true, hideInFeed: true, createdAt: true, role: true },
    });
    if (!u || u.hideInFeed) throw new HttpError(404, 'This player keeps their profile private');
    const [bets, rounds, bestRound, bestBet, fav] = await Promise.all([
      prisma.bet.count({ where: { userId: u.id } }),
      prisma.casinoRound.count({ where: { userId: u.id, status: { not: 'ACTIVE' } } }),
      prisma.casinoRound.findFirst({ where: { userId: u.id, status: { in: ['WON', 'CASHED'] } }, orderBy: { multiplier: 'desc' }, select: { game: true, multiplier: true, payout: true } }),
      prisma.bet.findFirst({ where: { userId: u.id, status: 'WON' }, orderBy: { totalOdds: 'desc' }, select: { totalOdds: true, payout: true, type: true } }),
      prisma.casinoRound.groupBy({ by: ['game'], where: { userId: u.id }, _count: { _all: true }, orderBy: { _count: { game: 'desc' } }, take: 1 }),
    ]);
    const t = tierOf(Number(u.wagered));
    res.json({
      username: u.username,
      staff: u.role === 'ADMIN',
      tier: t.tier,
      next: t.next,
      progress: t.progress,
      joined: u.createdAt,
      bets,
      rounds,
      favouriteGame: fav[0] ? GAME_NAMES[fav[0].game] ?? fav[0].game : null,
      bestCasino: bestRound ? { game: GAME_NAMES[bestRound.game] ?? bestRound.game, multiplier: Number(bestRound.multiplier), payout: Number(bestRound.payout) } : null,
      bestSports: bestBet ? { odds: Number(bestBet.totalOdds), payout: Number(bestBet.payout ?? 0), type: bestBet.type } : null,
    });
  })
);

/* ─────────────────────────────── global chat ─────────────────────────────── */

const chatLimiter = rateLimit({ windowMs: 10_000, limit: 4, standardHeaders: true, legacyHeaders: false, message: { error: 'Slow down — max 4 messages per 10 seconds' } });
const BANNED = [/https?:\/\//i, /www\./i, /\.(com|net|io|gg|xyz|bet)\b/i, /t\.me\//i];

async function serializeMsg(m: { id: string; body: string; staff: boolean; createdAt: Date; user: { username: string; role: string; wagered: unknown } }) {
  return {
    id: m.id,
    user: m.user.username,
    staff: m.staff || m.user.role === 'ADMIN',
    tier: tierOf(Number(m.user.wagered)).tier.id,
    body: m.body,
    at: m.createdAt,
  };
}

r.get(
  '/chat/global',
  asyncH(async (_req, res) => {
    const msgs = await prisma.chatMessage.findMany({
      where: { room: 'global', deleted: false },
      include: { user: { select: { username: true, role: true, wagered: true } } },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
    res.json({ messages: await Promise.all(msgs.reverse().map(serializeMsg)), online: Math.max(1, streamClientCount()) });
  })
);

r.post(
  '/chat/global',
  requireAuth,
  chatLimiter,
  asyncH(async (req, res) => {
    const { body } = z.object({ body: z.string().trim().min(1).max(300) }).parse(req.body);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!u.emailVerified) throw new HttpError(403, 'Verify your e-mail to use the chat');
    if (u.chatMutedUntil && u.chatMutedUntil > new Date()) throw new HttpError(403, `You are muted until ${u.chatMutedUntil.toISOString().slice(11, 16)} UTC`);
    if (u.role !== 'ADMIN' && BANNED.some((re) => re.test(body))) throw new HttpError(400, 'Links are not allowed in chat');
    const m = await prisma.chatMessage.create({
      data: { userId: u.id, room: 'global', body, staff: u.role === 'ADMIN' },
      include: { user: { select: { username: true, role: true, wagered: true } } },
    });
    const out = await serializeMsg(m);
    broadcast('chat', { message: out });
    res.status(201).json({ message: out });
  })
);

/* ─────────────────────────────── support ─────────────────────────────── */

const supportLimiter = rateLimit({ windowMs: 60_000, limit: 15 });

async function thread(userId: string) {
  const msgs = await prisma.chatMessage.findMany({
    where: { room: 'support', threadUserId: userId, deleted: false },
    include: { user: { select: { username: true, role: true } } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return msgs.map((m) => ({ id: m.id, body: m.body, staff: m.staff, user: m.staff ? 'WavyBet Support' : m.user.username, at: m.createdAt }));
}

r.get(
  '/chat/support',
  requireAuth,
  asyncH(async (req, res) => {
    res.json({ messages: await thread(req.user!.id) });
  })
);

r.post(
  '/chat/support',
  requireAuth,
  supportLimiter,
  asyncH(async (req, res) => {
    const { body } = z.object({ body: z.string().trim().min(1).max(1000) }).parse(req.body);
    await prisma.chatMessage.create({ data: { userId: req.user!.id, room: 'support', threadUserId: req.user!.id, body } });
    const count = await prisma.chatMessage.count({ where: { room: 'support', threadUserId: req.user!.id } });
    if (count === 1) {
      // first contact: automatic acknowledgement from the support desk
      const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
      if (admin)
        await prisma.chatMessage.create({
          data: {
            userId: admin.id, room: 'support', threadUserId: req.user!.id, staff: true, readByStaff: true,
            body: "Thanks for contacting WavyBet support 👋 An agent will reply here shortly — you'll see it in this window. Tip: for deposits, include your TXID.",
          },
        });
    }
    broadcast('support', { threadUserId: req.user!.id });
    res.status(201).json({ messages: await thread(req.user!.id) });
  })
);

/* admin side */
r.get(
  '/chat/admin/threads',
  requireAuth,
  requireAdmin,
  asyncH(async (_req, res) => {
    const last = await prisma.chatMessage.findMany({
      where: { room: 'support' },
      orderBy: { createdAt: 'desc' },
      distinct: ['threadUserId'],
      take: 100,
      include: { user: { select: { username: true } } },
    });
    const unread = await prisma.chatMessage.groupBy({ by: ['threadUserId'], where: { room: 'support', staff: false, readByStaff: false }, _count: { _all: true } });
    const players = await prisma.user.findMany({ where: { id: { in: last.map((m) => m.threadUserId!).filter(Boolean) } }, select: { id: true, username: true, email: true, balance: true } });
    res.json({
      threads: last.map((m) => {
        const p = players.find((x) => x.id === m.threadUserId);
        return {
          userId: m.threadUserId,
          username: p?.username ?? '?',
          email: p?.email ?? '',
          balance: String(p?.balance ?? 0),
          last: m.body,
          lastStaff: m.staff,
          at: m.createdAt,
          unread: unread.find((u) => u.threadUserId === m.threadUserId)?._count._all ?? 0,
        };
      }),
    });
  })
);

r.get(
  '/chat/admin/threads/:userId',
  requireAuth,
  requireAdmin,
  asyncH(async (req, res) => {
    await prisma.chatMessage.updateMany({ where: { room: 'support', threadUserId: req.params.userId, staff: false }, data: { readByStaff: true } });
    res.json({ messages: await thread(req.params.userId) });
  })
);

r.post(
  '/chat/admin/threads/:userId',
  requireAuth,
  requireAdmin,
  asyncH(async (req, res) => {
    const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
    await prisma.chatMessage.create({ data: { userId: req.user!.id, room: 'support', threadUserId: req.params.userId, body, staff: true, readByStaff: true } });
    broadcast('support', { threadUserId: req.params.userId });
    res.status(201).json({ messages: await thread(req.params.userId) });
  })
);

r.post(
  '/chat/admin/delete/:id',
  requireAuth,
  requireAdmin,
  asyncH(async (req, res) => {
    await prisma.chatMessage.update({ where: { id: req.params.id }, data: { deleted: true } });
    broadcast('chat', { deleted: req.params.id });
    res.json({ ok: true });
  })
);

r.post(
  '/chat/admin/mute',
  requireAuth,
  requireAdmin,
  asyncH(async (req, res) => {
    const b = z.object({ username: z.string(), minutes: z.number().int().min(0).max(60 * 24 * 365) }).parse(req.body);
    const u = await prisma.user.findFirst({ where: { username: { equals: b.username, mode: 'insensitive' } } });
    if (!u) throw new HttpError(404, 'User not found');
    await prisma.user.update({ where: { id: u.id }, data: { chatMutedUntil: b.minutes ? new Date(Date.now() + b.minutes * 60_000) : null } });
    res.json({ ok: true });
  })
);

export default r;
