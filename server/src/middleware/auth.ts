import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { HttpError } from '../lib/http';
import { prisma } from '../lib/prisma';

export interface AuthUser {
  id: string;
  role: 'USER' | 'ADMIN';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAccessToken(u: AuthUser) {
  return jwt.sign({ sub: u.id, role: u.role }, config.jwtAccessSecret, { expiresIn: '15m' });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new HttpError(401, 'Not authenticated');
    const payload = jwt.verify(h.slice(7), config.jwtAccessSecret) as { sub: string; role: AuthUser['role'] };
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, role: true, isBanned: true } });
    if (!user) throw new HttpError(401, 'Not authenticated');
    if (user.isBanned) throw new HttpError(403, 'Account suspended');
    req.user = { id: user.id, role: user.role };
    next();
  } catch (e) {
    next(e instanceof HttpError ? e : new HttpError(401, 'Session expired', 'TOKEN_EXPIRED'));
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'ADMIN') return next(new HttpError(403, 'Admin only'));
  next();
}

/** attach req.user when a valid token is sent, but never reject the request */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next();
  try {
    const payload = jwt.verify(h.slice(7), config.jwtAccessSecret) as { sub: string; role: AuthUser['role'] };
    req.user = { id: payload.sub, role: payload.role };
  } catch {
    /* anonymous */
  }
  next();
}
