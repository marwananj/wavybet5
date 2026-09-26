import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncH, HttpError } from '../lib/http';
import { prisma } from '../lib/prisma';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { GAME_NAMES } from '../casino/service';
import { tierOf } from '../services/rewards';
import { broadcast, streamClientCount } from '../services/stream';

/**
 * Social layer: public bet feed, global chat room (pushed live over the SSE stream) and private
 * customer-support threads between a player and the support team (admins).
 */
const r = Router();

const mask = (name: string) => (name.length <= 3 ? `${name[0]}**` : `${name.slice(0, 2)}${'*'.repeat(Math.min(4, name.length - 3))}${name.slice(-1)}`);

/* ─────────────────────────────── bet feed ─────────────────────────────── */

r.get(
  '/feed',
  asyncH(async (req, res) => {
    const q = z.object({ tab: z.enum(['all', 'high', 'mine']).default('all') }).parse(req.query);
    let userId: string | undefined;
    if (q.tab === 'mine') {
      // optional auth: reuse the auth middleware
      await new Promise<void>((resolve, reject) => requireAuth(req, res, (e?: unknown) => (e ? reject(e) : resolve())));
      userId = req.user!.id;
    }
    const high = q.tab === 'high' ? { gte: 100 } : undefined;
    const [rounds, bets] = await Promise.all([
      prisma.casinoRound.findMany({
        where: { status: { not: 'ACTIVE' }, ...(userId ? { userId } : {}), ...(high ? { stake: high } : {}) },
        include: { user: { select: { username: true, wagered: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.bet.findMany({
        where: { status: { in: ['WON', 'LOST', 'CASHOUT'] }, ...(userId ? { userId } : {}), ...(high ? { stake: high } : {}) },
        include: { user: { select: { username: true, wagered: true } }, selections: { take: 1, select: { eventLabel: true } } },
        orderBy: { settledAt: 'desc' },
        take: 20,
      }),
    ]);
    const rows = [
      ...rounds.map((x) => ({
        id: x.id,
        kind: 'casino' as const,
        game: GAME_NAMES[x.game] ?? x.game,
        gameId: x.game,
        user: userId ? x.user.username : mask(x.user.username),
        tier: tierOf(Number(x.user.wagered)).tier.id,
        at: x.finishedAt ?? x.createdAt,
        stake: String(x.stake),
        multiplier: Number(x.multiplier),
        payout: String(x.payout),
      })),
      ...bets.map((b) => ({
        id: b.id,
        kind: 'sport' as const,
        game: b.type === 'PARLAY' ? 'Parlay' : b.type === 'BUILDER' ? 'Bet Builder' : b.selections[0]?.eventLabel ?? 'Sports',
        gameId: 'sports',
        user: userId ? b.user.username : mask(b.user.username),
        tier: tierOf(Number(b.user.wagered)).tier.id,
        at: b.settledAt ?? b.createdAt,
        stake: String(b.stake),
        multiplier: Number(b.payout ?? 0) / Number(b.stake),
        payout: String(b.payout ?? 0),
      })),
    ]
      .sort((a, b) => +new Date(b.at) - +new Date(a.at))
      .slice(0, 20);
    res.json({ rows });
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
