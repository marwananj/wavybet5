import { Prisma, TxStatus, TxType } from '@prisma/client';
import { HttpError } from '../lib/http';

type Tx = Prisma.TransactionClient;

/**
 * Atomically change a user's balance and write a ledger row.
 * Debits use a conditional update so the balance can never go negative,
 * even with concurrent requests.
 */
export async function applyBalanceChange(
  tx: Tx,
  opts: {
    userId: string;
    amount: Prisma.Decimal; // signed
    type: TxType;
    status?: TxStatus;
    betId?: string;
    note?: string;
    extra?: Partial<Prisma.TransactionUncheckedCreateInput>;
  }
) {
  const { userId, amount } = opts;
  if (amount.isNegative()) {
    const res = await tx.user.updateMany({
      where: { id: userId, balance: { gte: amount.abs() } },
      data: { balance: { decrement: amount.abs() } },
    });
    if (res.count === 0) throw new HttpError(400, 'Insufficient balance', 'INSUFFICIENT_BALANCE');
  } else if (amount.isPositive()) {
    await tx.user.update({ where: { id: userId }, data: { balance: { increment: amount } } });
  }
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } });
  return tx.transaction.create({
    data: {
      userId,
      amount,
      type: opts.type,
      status: opts.status ?? 'COMPLETED',
      balanceAfter: user.balance,
      betId: opts.betId,
      note: opts.note,
      ...opts.extra,
    },
  });
}
