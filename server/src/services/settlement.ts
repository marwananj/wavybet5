import { BetStatus } from '@prisma/client';
import { config } from '../config';
import { D, money, prisma } from '../lib/prisma';
import { applyBalanceChange } from './wallet';
import { addWager } from './rewards';

interface Final {
  homeScore: number;
  awayScore: number;
  htHome: number | null;
  htAway: number | null;
  cornersHome: number | null;
  cornersAway: number | null;
}

const overUnder = (code: string, total: number, point: unknown): BetStatus => {
  const line = Number(point);
  if (!Number.isFinite(line)) return 'VOID';
  if (total === line) return 'VOID'; // whole line landed exactly: stake back
  return code.startsWith('over') === total > line ? 'WON' : 'LOST';
};
const threeWay = (code: string, h: number, a: number): BetStatus => {
  const r = h > a ? 'home' : h < a ? 'away' : 'draw';
  return code === r ? 'WON' : 'LOST';
};

export function resultFor(sel: { marketKey: string; outcomeCode: string; point: unknown }, ev: Final): BetStatus {
  const hs = ev.homeScore, as = ev.awayScore;
  switch (sel.marketKey) {
    case 'h2h':
      return threeWay(sel.outcomeCode, hs, as);
    case 'totals':
      return overUnder(sel.outcomeCode, hs + as, sel.point);
    case 'btts':
      return (sel.outcomeCode === 'yes') === (hs > 0 && as > 0) ? 'WON' : 'LOST';
    case 'double_chance': {
      const ok =
        (sel.outcomeCode === 'home_draw' && hs >= as) ||
        (sel.outcomeCode === 'home_away' && hs !== as) ||
        (sel.outcomeCode === 'draw_away' && hs <= as);
      return ok ? 'WON' : 'LOST';
    }
    case 'correct_score': {
      const m = sel.outcomeCode.match(/^cs_(\d+)_(\d+)$/);
      if (!m) return 'VOID';
      return Number(m[1]) === hs && Number(m[2]) === as ? 'WON' : 'LOST';
    }
    case 'ht_h2h':
      return ev.htHome == null || ev.htAway == null ? 'VOID' : threeWay(sel.outcomeCode, ev.htHome, ev.htAway);
    case 'ht_totals':
      return ev.htHome == null || ev.htAway == null ? 'VOID' : overUnder(sel.outcomeCode, ev.htHome + ev.htAway, sel.point);
    case 'corners_totals':
      return ev.cornersHome == null || ev.cornersAway == null ? 'VOID' : overUnder(sel.outcomeCode, ev.cornersHome + ev.cornersAway, sel.point);
    case 'corners_h2h':
      return ev.cornersHome == null || ev.cornersAway == null ? 'VOID' : threeWay(sel.outcomeCode, ev.cornersHome, ev.cornersAway);
  }
  return 'VOID';
}

/** Grade every open selection of a completed event, then re-evaluate affected bets. Returns bets settled. */
export async function settleEvent(eventId: string) {
  const ev = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  if (ev.homeScore == null || ev.awayScore == null) return 0;
  const fin: Final = {
    homeScore: ev.homeScore, awayScore: ev.awayScore,
    htHome: ev.htHome ?? null, htAway: ev.htAway ?? null, cornersHome: ev.cornersHome ?? null, cornersAway: ev.cornersAway ?? null,
  };

  const sels = await prisma.betSelection.findMany({ where: { eventId, status: 'OPEN' } });
  let hasDraw: boolean | null = null;
  for (const s of sels) {
    let status = resultFor(s, fin);
    // Tie in a two-way moneyline (no draw price offered) -> void
    if (s.marketKey === 'h2h' && fin.homeScore === fin.awayScore && s.outcomeCode !== 'draw') {
      hasDraw ??= (await prisma.outcome.count({ where: { market: { eventId, key: 'h2h' }, code: 'draw' } })) > 0;
      if (!hasDraw) status = 'VOID';
    }
    await prisma.betSelection.update({ where: { id: s.id }, data: { status } });
  }
  return evaluateBets([...new Set<string>(sels.map((s) => s.betId))]);
}

/**
 * Early payout: a pre-match 1X2 pick is paid as a winner the moment its team goes 2 goals ahead,
 * whatever the final result. Parlay legs are marked won (the rest of the parlay carries on).
 * Bet Builder legs are excluded (their price already accounts for the combination).
 */
export async function applyEarlyPayout(eventId: string, hs: number, as: number) {
  if (Math.abs(hs - as) < 2) return 0;
  const leader = hs > as ? 'home' : 'away';
  const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { commenceTime: true } });
  if (!ev) return 0;
  const sels = await prisma.betSelection.findMany({
    where: { eventId, status: 'OPEN', marketKey: 'h2h', outcomeCode: leader, bet: { type: { not: 'BUILDER' }, createdAt: { lt: ev.commenceTime } } },
    select: { id: true, betId: true },
  });
  if (!sels.length) return 0;
  await prisma.betSelection.updateMany({ where: { id: { in: sels.map((s) => s.id) }, status: 'OPEN' }, data: { status: 'WON', early: true } });
  console.log(`[early payout] ${eventId} ${hs}-${as}: ${sels.length} selection(s) paid early`);
  return evaluateBets([...new Set<string>(sels.map((s: { betId: string }) => s.betId))]);
}

/** Void every open selection of an event (postponed/cancelled). */
export async function voidEvent(eventId: string) {
  await prisma.event.update({ where: { id: eventId }, data: { status: 'CANCELLED' } });
  const sels = await prisma.betSelection.findMany({ where: { eventId, status: 'OPEN' } });
  await prisma.betSelection.updateMany({ where: { eventId, status: 'OPEN' }, data: { status: 'VOID' } });
  return evaluateBets([...new Set<string>(sels.map((s) => s.betId))]);
}

/** parlays that qualify for Acca Insurance */
export function accaInsured(bet: { type: string; selections: { odds: unknown }[] }) {
  return (
    bet.type === 'PARLAY' && config.accaInsMax > 0 && bet.selections.length >= config.accaInsMinLegs && bet.selections.every((x) => Number(x.odds) >= config.accaInsMinOdds)
  );
}

export async function evaluateBets(betIds: string[]) {
  let settled = 0;
  for (const id of betIds) {
    const bet = await prisma.bet.findUnique({ where: { id }, include: { selections: true } });
    if (!bet || bet.status !== 'OPEN') continue;
    const st = bet.selections.map((s) => s.status);
    let final: BetStatus | null = null;
    let payout = D(0);
    let insurance: ReturnType<typeof D> | null = null;

    if (bet.type === 'BUILDER') {
      // one combined price: every leg must win; any void leg voids the whole builder
      if (st.includes('LOST')) final = 'LOST';
      else if (st.includes('OPEN')) final = null;
      else if (st.includes('VOID')) {
        final = 'VOID';
        payout = D(bet.stake);
      } else {
        final = 'WON';
        payout = money(D(bet.stake).mul(bet.totalOdds));
        if (payout.gt(config.maxPayout)) payout = D(config.maxPayout);
      }
    } else if (st.includes('LOST')) {
      // Acca Insurance: one losing leg on an insured parlay waits for the other legs
      const lost = st.filter((x) => x === 'LOST').length;
      if (lost === 1 && accaInsured(bet) && st.includes('OPEN')) final = null;
      else {
        final = 'LOST';
        if (lost === 1 && accaInsured(bet) && st.filter((x) => x === 'WON').length === st.length - 1) {
          insurance = money(D(bet.stake).gt(config.accaInsMax) ? D(config.accaInsMax) : D(bet.stake));
        }
      }
    } else if (st.includes('OPEN')) final = null;
    else if (st.every((s) => s === 'VOID')) {
      final = 'VOID';
      payout = D(bet.stake);
    } else {
      final = 'WON';
      const odds = bet.selections.filter((s) => s.status === 'WON').reduce((acc, s) => acc.mul(s.odds), D(1));
      payout = money(D(bet.stake).mul(odds));
      if (payout.gt(config.maxPayout)) payout = D(config.maxPayout);
    }
    if (!final) continue;

    await prisma.$transaction(async (db) => {
      const flipped = await db.bet.updateMany({
        where: { id: bet.id, status: 'OPEN' },
        data: { status: final!, payout, settledAt: new Date(), ...(insurance ? { insurancePaid: insurance } : {}) },
      });
      if (flipped.count !== 1) return;
      if (insurance) {
        await applyBalanceChange(db, { userId: bet.userId, amount: insurance, type: 'BONUS', betId: bet.id, note: `Acca Insurance — ${bet.selections.length}-leg parlay lost by one leg` });
        await db.user.update({ where: { id: bet.userId }, data: { bonusWagerLeft: { increment: insurance } } });
      }
      if (final !== 'VOID') await addWager(db, bet.userId, D(bet.stake)); // VIP + bonus wagering
      if (payout.gt(0)) {
        await applyBalanceChange(db, {
          userId: bet.userId,
          amount: payout,
          type: final === 'VOID' ? 'BET_REFUND' : 'BET_PAYOUT',
          betId: bet.id,
          note: final === 'VOID' ? 'Bet void — stake returned' : `${bet.type === 'BUILDER' ? 'Bet Builder' : 'Bet'} won @ ${bet.totalOdds}${bet.selections.some((x) => x.early) ? ' (early payout)' : ''}`,
        });
      }
    });
    settled++;
  }
  return settled;
}
