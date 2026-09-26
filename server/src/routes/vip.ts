import { Router } from 'express';
import { config } from '../config';
import { asyncH } from '../lib/http';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { claimVip, TIERS, vipStatus } from '../services/rewards';

const r = Router();

/** Public programme info (for guests) */
r.get('/info', (_req, res) => {
  res.json({
    tiers: TIERS,
    step: config.wagerRewardStep,
    reward: config.wagerRewardAmount,
    firstDeposit: { bonus: config.firstDepositBonus, min: config.firstDepositMin, wagerX: config.firstDepositWagerX },
  });
});

r.get(
  '/',
  requireAuth,
  asyncH(async (req, res) => {
    res.json(await vipStatus(req.user!.id));
  })
);

r.post(
  '/claim',
  requireAuth,
  asyncH(async (req, res) => {
    const amount = await claimVip(req.user!.id);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { balance: true } });
    res.json({ claimed: String(amount), balance: String(u.balance), status: await vipStatus(req.user!.id) });
  })
);

export default r;
