import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { config } from '../config';
import { asyncH, HttpError } from '../lib/http';
import { D, money, prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { nowpayments } from '../services/nowpayments';
import { applyBalanceChange } from '../services/wallet';
import { assertNoBonusLock, grantFirstDepositBonus } from '../services/rewards';

const r = Router();

export const CURRENCY_LABELS: Record<string, { name: string; network: string }> = {
  btc: { name: 'Bitcoin', network: 'BTC' },
  eth: { name: 'Ethereum', network: 'ERC20' },
  usdttrc20: { name: 'Tether USDT', network: 'TRC20' },
  usdterc20: { name: 'Tether USDT', network: 'ERC20' },
  ltc: { name: 'Litecoin', network: 'LTC' },
  sol: { name: 'Solana', network: 'SOL' },
  trx: { name: 'TRON', network: 'TRC20' },
  usdc: { name: 'USD Coin', network: 'ERC20' },
  doge: { name: 'Dogecoin', network: 'DOGE' },
  bnbbsc: { name: 'BNB', network: 'BEP20' },
};

async function assertCanTransact(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (u.selfExcludedUntil && u.selfExcludedUntil > new Date())
    throw new HttpError(403, `You are self-excluded until ${u.selfExcludedUntil.toISOString().slice(0, 10)}`);
  if (!u.emailVerified) throw new HttpError(403, 'Verify your e-mail first', 'EMAIL_UNVERIFIED');
  return u;
}

const label = (c: string) => CURRENCY_LABELS[c] ?? { name: c.toUpperCase(), network: c.toUpperCase() };
/** Coins offered: in manual mode, the ones you configured a wallet for. */
const coins = () => (config.paymentMode === 'manual' ? Object.keys(config.manualWallets) : config.cryptoCurrencies);

/* Secret payment code: constant-time compare + lockout after repeated wrong tries */
const WINDOW = 15 * 60_000;
const codeFails = new Map<string, { n: number; first: number; lockedUntil: number }>();
function checkPaymentCode(userId: string, code: unknown) {
  if (!config.paymentCode) return;
  const now = Date.now();
  let f = codeFails.get(userId);
  if (f && f.lockedUntil > now) throw new HttpError(429, 'Too many wrong codes — try again in 15 minutes');
  const a = Buffer.from(String(code ?? '').trim());
  const b = Buffer.from(config.paymentCode);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    if (!f || now - f.first > WINDOW) f = { n: 0, first: now, lockedUntil: 0 };
    f.n++;
    if (f.n >= 5) f.lockedUntil = now + WINDOW;
    codeFails.set(userId, f);
    throw new HttpError(403, f.n >= 5 ? 'Too many wrong codes — try again in 15 minutes' : 'Wrong secret code', 'BAD_CODE');
  }
  codeFails.delete(userId);
}

r.get('/currencies', (_req, res) => {
  res.json({
    mode: config.paymentMode,
    requiresCode: !!config.paymentCode,
    currencies: coins().map((c) => ({
      code: c,
      ...label(c),
      ...(config.paymentMode === 'manual' ? { address: config.manualWallets[c], memo: config.manualWalletMemos[c] ?? null } : {}),
    })),
    minDeposit: config.minDeposit,
    minWithdrawal: config.minWithdrawal,
  });
});

/* ------------------------------- Deposits -------------------------------- */

r.post(
  '/deposit',
  requireAuth,
  asyncH(async (req, res) => {
    const { amount, currency, txHash, code } = z
      .object({
        amount: z.number().min(config.minDeposit, `Minimum deposit is $${config.minDeposit}`).max(100_000),
        currency: z.string(),
        txHash: z.string().trim().max(200).optional(),
        code: z.string().max(100).optional(),
      })
      .parse(req.body);
    if (!coins().includes(currency)) throw new HttpError(400, 'Unsupported currency');
    const user = await assertCanTransact(req.user!.id);
    checkPaymentCode(user.id, code);

    if (user.dailyDepositLimit) {
      const since = new Date(Date.now() - 86400_000);
      const agg = await prisma.transaction.aggregate({
        where: { userId: user.id, type: 'DEPOSIT', status: { in: ['COMPLETED', 'PENDING'] }, createdAt: { gte: since } },
        _sum: { amount: true },
      });
      const used = Number(agg._sum.amount ?? 0);
      if (used + amount > Number(user.dailyDepositLimit))
        throw new HttpError(400, `This exceeds your daily deposit limit ($${Number(user.dailyDepositLimit).toFixed(2)})`);
    }

    /* Manual mode: user already sent crypto to our wallet and gives us the tx hash; admin approves. */
    if (config.paymentMode === 'manual') {
      if (!txHash || txHash.length < 10) throw new HttpError(400, 'Paste the transaction hash (TXID) of your payment');
      const dup = await prisma.transaction.findFirst({ where: { type: 'DEPOSIT', txHash, status: { in: ['PENDING', 'COMPLETED'] } } });
      if (dup) throw new HttpError(409, 'This transaction hash was already submitted');
      const open = await prisma.transaction.count({ where: { userId: user.id, type: 'DEPOSIT', status: 'PENDING' } });
      if (open >= 3) throw new HttpError(400, 'You already have 3 deposits waiting for approval');
      const tx = await prisma.transaction.create({
        data: {
          userId: user.id, type: 'DEPOSIT', status: 'PENDING', amount: money(amount), cryptoCurrency: currency,
          address: config.manualWallets[currency], txHash, note: 'Manual deposit — awaiting confirmation',
        },
      });
      return res.status(201).json({ deposit: { id: tx.id, amount: String(tx.amount), currency, status: 'awaiting_approval', manual: true } });
    }

    const pending = await prisma.transaction.create({
      data: { userId: user.id, type: 'DEPOSIT', status: 'PENDING', amount: money(amount), cryptoCurrency: currency },
    });
    try {
      const p = await nowpayments.createPayment({
        price_amount: amount,
        pay_currency: currency,
        order_id: pending.id,
        order_description: `WavyBet deposit ${user.username}`,
      });
      const tx = await prisma.transaction.update({
        where: { id: pending.id },
        data: {
          providerId: String(p.payment_id),
          address: p.pay_address,
          cryptoAmount: String(p.pay_amount),
          note: p.payin_extra_id ? `Memo/Tag: ${p.payin_extra_id}` : null,
        },
      });
      res.status(201).json({
        deposit: {
          id: tx.id,
          amount: String(tx.amount),
          currency,
          address: p.pay_address,
          payAmount: p.pay_amount,
          extraId: p.payin_extra_id ?? null,
          status: p.payment_status,
          expiresAt: p.expiration_estimate_date ?? null,
        },
      });
    } catch (e) {
      await prisma.transaction.update({ where: { id: pending.id }, data: { status: 'FAILED', note: 'Provider error' } });
      throw e;
    }
  })
);

r.get(
  '/deposit/:id',
  requireAuth,
  asyncH(async (req, res) => {
    const tx = await prisma.transaction.findFirst({ where: { id: req.params.id, userId: req.user!.id, type: 'DEPOSIT' } });
    if (!tx) throw new HttpError(404, 'Deposit not found');
    let providerStatus: string | null = null;
    if (tx.status === 'PENDING' && tx.providerId) {
      try {
        const p = await nowpayments.getPayment(tx.providerId);
        providerStatus = p.payment_status;
        await handlePaymentUpdate(p as unknown as IpnPayment); // self-heal if an IPN was missed
      } catch {
        /* ignore */
      }
    }
    const fresh = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    res.json({ deposit: { id: fresh.id, status: fresh.status, providerStatus, amount: String(fresh.amount) } });
  })
);

interface IpnPayment {
  payment_id: string | number;
  payment_status: string;
  order_id: string;
  price_amount: number;
  pay_amount: number;
  actually_paid?: number;
  outcome_amount?: number;
  payin_hash?: string;
}

async function handlePaymentUpdate(p: IpnPayment) {
  const tx = await prisma.transaction.findFirst({
    where: { OR: [{ providerId: String(p.payment_id) }, { id: p.order_id }], type: 'DEPOSIT' },
  });
  if (!tx || tx.status !== 'PENDING') return;

  const status = p.payment_status;
  if (status === 'finished' || status === 'partially_paid') {
    let credit = D(tx.amount);
    if (status === 'partially_paid' && p.pay_amount > 0 && p.actually_paid != null) {
      credit = money(D(tx.amount).mul(p.actually_paid).div(p.pay_amount));
    }
    await prisma.$transaction(async (db) => {
      // idempotency: flip PENDING -> COMPLETED exactly once
      const flipped = await db.transaction.updateMany({
        where: { id: tx.id, status: 'PENDING' },
        data: { status: 'COMPLETED', amount: credit, txHash: p.payin_hash ?? null, note: status === 'partially_paid' ? 'Partially paid' : tx.note },
      });
      if (flipped.count !== 1) return;
      const u = await db.user.update({ where: { id: tx.userId }, data: { balance: { increment: credit } } });
      await db.transaction.update({ where: { id: tx.id }, data: { balanceAfter: u.balance } });
      await grantFirstDepositBonus(db, tx.userId, credit);
    });
  } else if (['failed', 'expired', 'refunded'].includes(status)) {
    await prisma.transaction.updateMany({ where: { id: tx.id, status: 'PENDING' }, data: { status: status === 'expired' ? 'CANCELLED' : 'FAILED' } });
  }
}

/** NOWPayments deposit IPN webhook */
r.post(
  '/ipn',
  asyncH(async (req, res) => {
    if (!nowpayments.verifyIpn(req.body, req.headers['x-nowpayments-sig'] as string | undefined)) {
      throw new HttpError(401, 'Bad signature');
    }
    await handlePaymentUpdate(req.body as IpnPayment);
    res.json({ ok: true });
  })
);

/** NOWPayments payout IPN webhook */
r.post(
  '/ipn-payout',
  asyncH(async (req, res) => {
    if (!nowpayments.verifyIpn(req.body, req.headers['x-nowpayments-sig'] as string | undefined)) {
      throw new HttpError(401, 'Bad signature');
    }
    const b = req.body as { id: string; status: string; hash?: string };
    const tx = await prisma.transaction.findFirst({ where: { providerId: String(b.id), type: 'WITHDRAWAL' } });
    if (tx && tx.status === 'PENDING') {
      const s = b.status?.toUpperCase();
      if (s === 'FINISHED') {
        await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'COMPLETED', txHash: b.hash ?? null } });
      } else if (s === 'FAILED' || s === 'REJECTED') {
        await refundWithdrawal(tx.id, `Payout ${s.toLowerCase()}`);
      }
    }
    res.json({ ok: true });
  })
);

/* ------------------------------ Withdrawals ------------------------------ */

r.post(
  '/withdraw',
  requireAuth,
  asyncH(async (req, res) => {
    const body = z
      .object({
        amount: z.number().min(config.minWithdrawal, `Minimum withdrawal is $${config.minWithdrawal}`).max(1_000_000),
        currency: z.string(),
        address: z.string().min(20, 'Invalid wallet address').max(120),
        extraId: z.string().max(64).optional(),
        code: z.string().max(100).optional(),
      })
      .parse(req.body);
    if (!coins().includes(body.currency)) throw new HttpError(400, 'Unsupported currency');
    await assertCanTransact(req.user!.id);
    await assertNoBonusLock(req.user!.id);
    checkPaymentCode(req.user!.id, body.code);

    const open = await prisma.transaction.count({ where: { userId: req.user!.id, type: 'WITHDRAWAL', status: 'PENDING' } });
    if (open >= 3) throw new HttpError(400, 'You already have 3 pending withdrawals');

    const tx = await prisma.$transaction((db) =>
      applyBalanceChange(db, {
        userId: req.user!.id,
        amount: money(body.amount).negated(),
        type: 'WITHDRAWAL',
        status: 'PENDING',
        extra: { cryptoCurrency: body.currency, address: body.address.trim(), note: body.extraId ? `Memo/Tag: ${body.extraId}` : undefined },
      })
    );
    res.status(201).json({ withdrawal: { id: tx.id, status: tx.status, amount: String(tx.amount) } });
  })
);

export async function refundWithdrawal(txId: string, reason: string) {
  await prisma.$transaction(async (db) => {
    const flipped = await db.transaction.updateMany({
      where: { id: txId, status: 'PENDING', type: 'WITHDRAWAL' },
      data: { status: 'CANCELLED', note: reason },
    });
    if (flipped.count !== 1) return;
    const tx = await db.transaction.findUniqueOrThrow({ where: { id: txId } });
    await applyBalanceChange(db, {
      userId: tx.userId,
      amount: D(tx.amount).abs(),
      type: 'ADJUSTMENT',
      note: `Withdrawal refund: ${reason}`,
    });
  });
}

r.post(
  '/withdraw/:id/cancel',
  requireAuth,
  asyncH(async (req, res) => {
    const tx = await prisma.transaction.findFirst({
      where: { id: req.params.id, userId: req.user!.id, type: 'WITHDRAWAL', status: 'PENDING', providerId: null },
    });
    if (!tx) throw new HttpError(400, 'This withdrawal can no longer be cancelled');
    await refundWithdrawal(tx.id, 'Cancelled by user');
    res.json({ ok: true });
  })
);

/* ------------------------------ History ---------------------------------- */

r.get(
  '/transactions',
  requireAuth,
  asyncH(async (req, res) => {
    const q = z
      .object({ type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'BET_STAKE', 'BET_PAYOUT', 'BET_REFUND', 'ADJUSTMENT', 'CASINO_BET', 'CASINO_WIN']).optional(), cursor: z.string().optional() })
      .parse(req.query);
    const items = await prisma.transaction.findMany({
      where: { userId: req.user!.id, ...(q.type ? { type: q.type } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 31,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > 30;
    res.json({
      items: items.slice(0, 30).map((t) => ({ ...t, amount: String(t.amount), balanceAfter: t.balanceAfter ? String(t.balanceAfter) : null })),
      nextCursor: hasMore ? items[29].id : null,
    });
  })
);

r.get(
  '/balance',
  requireAuth,
  asyncH(async (req, res) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { balance: true } });
    res.json({ balance: String(u.balance) });
  })
);

export default r;
