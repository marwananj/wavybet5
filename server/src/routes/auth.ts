import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { asyncH, HttpError } from '../lib/http';
import { prisma } from '../lib/prisma';
import { requireAuth, signAccessToken } from '../middleware/auth';

const r = Router();
const COOKIE = 'wb_rt';

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

const registerSchema = z.object({
  email: z.string().email().max(120).transform((s) => s.toLowerCase().trim()),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers and _'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(100)
    .regex(/[A-Za-z]/, 'Password needs a letter')
    .regex(/[0-9]/, 'Password needs a number'),
  dateOfBirth: z.coerce.date(),
  country: z.string().length(2).transform((s) => s.toUpperCase()),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms' }) }),
});

function ageOf(dob: Date) {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

/** Country from a CDN header (Cloudflare) when available — used for geo-blocking. */
export function ipCountry(req: Request): string | undefined {
  const c = (req.headers['cf-ipcountry'] as string | undefined)?.toUpperCase();
  return c && c !== 'XX' ? c : undefined;
}

export function publicUser(u: {
  id: string; email: string; username: string; role: string; balance: unknown; country: string;
  kycStatus: string; selfExcludedUntil: Date | null; dailyDepositLimit: unknown; createdAt: Date;
}) {
  return {
    id: u.id, email: u.email, username: u.username, role: u.role, balance: String(u.balance),
    country: u.country, kycStatus: u.kycStatus, selfExcludedUntil: u.selfExcludedUntil,
    dailyDepositLimit: u.dailyDepositLimit == null ? null : String(u.dailyDepositLimit), createdAt: u.createdAt,
  };
}

async function issueSession(res: Response, user: { id: string; role: 'USER' | 'ADMIN' }) {
  const raw = crypto.randomBytes(48).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + config.jwtRefreshDays * 86400_000);
  await prisma.refreshToken.create({ data: { tokenHash, userId: user.id, expiresAt } });
  res.cookie(COOKIE, raw, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: config.env === 'production' ? 'none' : 'lax',
    expires: expiresAt,
    path: '/api/auth',
  });
  return signAccessToken(user);
}

r.post(
  '/register',
  authLimiter,
  asyncH(async (req, res) => {
    const body = registerSchema.parse(req.body);
    if (ageOf(body.dateOfBirth) < config.minAge) throw new HttpError(400, `You must be ${config.minAge}+ to register`);
    const geo = ipCountry(req);
    if (config.blockedCountries.includes(body.country) || (geo && config.blockedCountries.includes(geo)))
      throw new HttpError(403, 'WavyBet is not available in your country', 'GEO_BLOCKED');

    const exists = await prisma.user.findFirst({
      where: { OR: [{ email: body.email }, { username: { equals: body.username, mode: 'insensitive' } }] },
    });
    if (exists) throw new HttpError(409, exists.email === body.email ? 'Email already registered' : 'Username taken');

    const user = await prisma.user.create({
      data: {
        email: body.email,
        username: body.username,
        passwordHash: await bcrypt.hash(body.password, 12),
        dateOfBirth: body.dateOfBirth,
        country: body.country,
        lastLoginAt: new Date(),
      },
    });
    const accessToken = await issueSession(res, user);
    res.status(201).json({ accessToken, user: publicUser(user) });
  })
);

r.post(
  '/login',
  authLimiter,
  asyncH(async (req, res) => {
    const { login, password } = z.object({ login: z.string().min(1), password: z.string().min(1) }).parse(req.body);
    const l = login.trim();
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: l.toLowerCase() }, { username: { equals: l, mode: 'insensitive' } }] },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new HttpError(401, 'Invalid credentials');
    if (user.isBanned) throw new HttpError(403, 'Account suspended');
    const geo = ipCountry(req);
    if (geo && config.blockedCountries.includes(geo) && user.role !== 'ADMIN')
      throw new HttpError(403, 'WavyBet is not available in your country', 'GEO_BLOCKED');
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const accessToken = await issueSession(res, user);
    res.json({ accessToken, user: publicUser(user) });
  })
);

r.post(
  '/refresh',
  asyncH(async (req, res) => {
    const raw = req.cookies?.[COOKIE];
    if (!raw) throw new HttpError(401, 'No session');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    const token = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!token || token.revokedAt || token.expiresAt < new Date()) {
      // Reuse of a revoked token => revoke every session of that user.
      if (token?.revokedAt) await prisma.refreshToken.updateMany({ where: { userId: token.userId }, data: { revokedAt: new Date() } });
      res.clearCookie(COOKIE, { path: '/api/auth' });
      throw new HttpError(401, 'Session expired');
    }
    if (token.user.isBanned) throw new HttpError(403, 'Account suspended');
    await prisma.refreshToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    const accessToken = await issueSession(res, token.user);
    res.json({ accessToken, user: publicUser(token.user) });
  })
);

r.post(
  '/logout',
  asyncH(async (req, res) => {
    const raw = req.cookies?.[COOKIE];
    if (raw) {
      const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
      await prisma.refreshToken.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } });
    }
    res.clearCookie(COOKIE, { path: '/api/auth' });
    res.json({ ok: true });
  })
);

r.get(
  '/me',
  requireAuth,
  asyncH(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    res.json({ user: publicUser(user) });
  })
);

r.post(
  '/change-password',
  requireAuth,
  asyncH(async (req, res) => {
    const { current, next } = z
      .object({ current: z.string(), next: registerSchema.shape.password })
      .parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await bcrypt.compare(current, user.passwordHash))) throw new HttpError(400, 'Current password is wrong');
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(next, 12) } });
    await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    const accessToken = await issueSession(res, user);
    res.json({ ok: true, accessToken });
  })
);

/** Responsible gambling: deposit limit + self-exclusion */
r.post(
  '/responsible',
  requireAuth,
  asyncH(async (req, res) => {
    const body = z
      .object({
        dailyDepositLimit: z.number().positive().max(1_000_000).nullable().optional(),
        selfExcludeDays: z.number().int().min(1).max(3650).optional(),
      })
      .parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    const data: { dailyDepositLimit?: number | null; selfExcludedUntil?: Date } = {};
    if (body.dailyDepositLimit !== undefined) {
      // Lowering a limit is instant; raising/removing needs to wait (anti-impulse) — enforced simply here.
      const cur = user.dailyDepositLimit ? Number(user.dailyDepositLimit) : null;
      if (cur !== null && (body.dailyDepositLimit === null || body.dailyDepositLimit > cur)) {
        const lastChange = await prisma.setting.findUnique({ where: { key: `limitchg:${user.id}` } });
        if (lastChange && Date.now() - Number(lastChange.value) < 24 * 3600_000)
          throw new HttpError(400, 'You can raise or remove your limit 24h after your last change');
      }
      data.dailyDepositLimit = body.dailyDepositLimit;
      await prisma.setting.upsert({
        where: { key: `limitchg:${user.id}` },
        create: { key: `limitchg:${user.id}`, value: String(Date.now()) },
        update: { value: String(Date.now()) },
      });
    }
    if (body.selfExcludeDays) data.selfExcludedUntil = new Date(Date.now() + body.selfExcludeDays * 86400_000);
    const updated = await prisma.user.update({ where: { id: user.id }, data });
    if (data.selfExcludedUntil) await prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } });
    res.json({ user: publicUser(updated) });
  })
);

export default r;
