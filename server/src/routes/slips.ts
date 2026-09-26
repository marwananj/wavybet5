import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncH, HttpError } from '../lib/http';
import { prisma } from '../lib/prisma';
import { outcomeOpen } from '../services/open';
import { optionalAuth } from '../middleware/auth';

/**
 * Shareable betslips ("booking codes"). A player saves their selections as a short code
 * (e.g. WB7K2QX9) and anyone can load the same picks — with today's prices — into their own slip.
 */
const r = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

const newCode = () => 'WB' + Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');

r.post(
  '/slips',
  limiter,
  optionalAuth,
  asyncH(async (req, res) => {
    const { outcomeIds } = z.object({ outcomeIds: z.array(z.string().min(1).max(64)).min(1).max(15) }).parse(req.body);
    const ids = [...new Set(outcomeIds)];
    const found = await prisma.outcome.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new HttpError(400, 'Some selections no longer exist');
    // same picks → same code (keeps codes short-lived and avoids duplicates)
    const existing = await prisma.slipCode.findFirst({ where: { outcomeIds: { equals: ids } }, orderBy: { createdAt: 'desc' } });
    if (existing) return res.json({ code: existing.code });
    for (let i = 0; i < 5; i++) {
      const code = newCode();
      try {
        await prisma.slipCode.create({ data: { code, outcomeIds: ids, createdBy: req.user?.id ?? null } });
        return res.json({ code });
      } catch {
        /* collision — try again */
      }
    }
    throw new HttpError(500, 'Could not create a code, try again');
  })
);

r.get(
  '/slips/:code',
  limiter,
  asyncH(async (req, res) => {
    const code = String(req.params.code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const slip = await prisma.slipCode.findUnique({ where: { code } });
    if (!slip) throw new HttpError(404, 'Code not found — check it and try again');
    const outcomes = await prisma.outcome.findMany({ where: { id: { in: slip.outcomeIds } }, include: { market: { include: { event: true } } } });
    const now = new Date();
    const picks = slip.outcomeIds
      .map((id) => outcomes.find((o) => o.id === id))
      .filter((o): o is NonNullable<typeof o> => !!o)
      .map((o) => {
        const ev = o.market.event;
        return {
          outcomeId: o.id,
          eventId: ev.id,
          eventLabel: `${ev.homeTeam} vs ${ev.awayTeam}`,
          sportTitle: ev.sportTitle,
          marketKey: o.market.key,
          outcomeName: o.name,
          odds: Number(o.price),
          live: ev.status === 'LIVE',
          unavailable: !outcomeOpen(o, now),
        };
      });
    prisma.slipCode.update({ where: { code }, data: { uses: { increment: 1 } } }).catch(() => {});
    res.json({ code, picks, available: picks.filter((p) => !p.unavailable).length });
  })
);

export default r;
