import { Prisma } from '@prisma/client';
import { config } from '../config';
import { HttpError } from '../lib/http';
import { D, money, prisma } from '../lib/prisma';
import { applyBalanceChange } from './wallet';

type Tx = Prisma.TransactionClient;

/* ───────────────────────────── VIP tiers ─────────────────────────────
 * Tier by lifetime wagered (casino stakes + settled sports stakes). The booster pays
 * WAGER_REWARD_AMOUNT (default $20) of real balance for every WAGER_REWARD_STEP (default $5,000) wagered,
 * claimable from the VIP page at any time. */
export const TIERS = [
  { id: 'bronze', name: 'Bronze', from: 0, color: '#cd7f32' },
  { id: 'silver', name: 'Silver', from: 5_000, color: '#c0c7d4' },
  { id: 'gold', name: 'Gold', from: 25_000, color: '#f5c542' },
  { id: 'platinum', name: 'Platinum', from: 100_000, color: '#7dd3fc' },
  { id: 'diamond', name: 'Diamond', from: 500_000, color: '#a78bfa' },
  { id: 'wavy', name: 'Wavy Elite', from: 2_000_000, color: '#3ad0ff' },
] as const;

export function tierOf(wagered: number) {
  let i = 0;
  for (let k = 0; k < TIERS.length; k++) if (wagered >= TIERS[k].from) i = k;
  const cur = TIERS[i];
  const next = TIERS[i + 1] ?? null;
  return { tier: cur, next, progress: next ? (wagered - cur.from) / (next.from - cur.from) : 1 };
}

/** Count stake towards VIP + first-deposit wagering (call inside the betting transaction). */
export async function addWager(db: Tx, userId: string, amount: Prisma.Decimal | number) {
  const a = D(amount);
  if (!a.gt(0)) return;
  const u = await db.user.update({ where: { id: userId }, data: { wagered: { increment: a } }, select: { bonusWagerLeft: true } });
  if (D(u.bonusWagerLeft).gt(0)) {
    const left = D(u.bonusWagerLeft).sub(a);
    await db.user.update({ where: { id: userId }, data: { bonusWagerLeft: left.gt(0) ? money(left) : D(0) } });
  }
}

export async function vipStatus(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { wagered: true, rewardChunksClaimed: true } });
  const wagered = Number(u.wagered);
  const earned = Math.floor(wagered / config.wagerRewardStep);
  const claimable = Math.max(0, earned - u.rewardChunksClaimed);
  const t = tierOf(wagered);
  return {
    wagered,
    tier: t.tier,
    next: t.next,
    progress: t.progress,
    tiers: TIERS,
    step: config.wagerRewardStep,
    reward: config.wagerRewardAmount,
    claimableChunks: claimable,
    claimable: claimable * config.wagerRewardAmount,
    claimedTotal: u.rewardChunksClaimed * config.wagerRewardAmount,
    toNextReward: config.wagerRewardStep - (wagered % config.wagerRewardStep),
  };
}

export async function claimVip(userId: string) {
  return prisma.$transaction(async (db) => {
    const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { wagered: true, rewardChunksClaimed: true } });
    const earned = Math.floor(Number(u.wagered) / config.wagerRewardStep);
    const chunks = earned - u.rewardChunksClaimed;
    if (chunks <= 0) throw new HttpError(400, `Wager $${config.wagerRewardStep.toLocaleString()} to unlock your next $${config.wagerRewardAmount} reward`);
    // optimistic guard against double claims
    const flipped = await db.user.updateMany({ where: { id: userId, rewardChunksClaimed: u.rewardChunksClaimed }, data: { rewardChunksClaimed: earned } });
    if (flipped.count !== 1) throw new HttpError(409, 'Already claimed');
    const amount = money(chunks * config.wagerRewardAmount);
    await applyBalanceChange(db, { userId, amount, type: 'BONUS', note: `VIP booster — ${chunks} × $${config.wagerRewardAmount}` });
    return amount;
  });
}

/* ─────────────────────── first deposit gift ─────────────────────── */

/** Call inside the deposit-crediting transaction. Pays once, on the first deposit ≥ FIRST_DEPOSIT_MIN. */
export async function grantFirstDepositBonus(db: Tx, userId: string, deposit: Prisma.Decimal) {
  if (!(config.firstDepositBonus > 0) || D(deposit).lt(config.firstDepositMin)) return null;
  const flipped = await db.user.updateMany({
    where: { id: userId, firstDepositBonusAt: null },
    data: { firstDepositBonusAt: new Date(), bonusWagerLeft: money(config.firstDepositBonus * config.firstDepositWagerX) },
  });
  if (flipped.count !== 1) return null;
  const amount = money(config.firstDepositBonus);
  await applyBalanceChange(db, { userId, amount, type: 'BONUS', note: 'First deposit gift 🎁' });
  return amount;
}

export async function assertNoBonusLock(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { bonusWagerLeft: true } });
  if (D(u.bonusWagerLeft).gt(0))
    throw new HttpError(400, `Wager $${Number(u.bonusWagerLeft).toFixed(2)} more to unlock withdrawals (first deposit gift terms)`, 'BONUS_WAGER');
}
