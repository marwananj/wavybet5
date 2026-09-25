import { BetStatus } from '@prisma/client';
import { config } from '../config';
import { D, money, prisma } from '../lib/prisma';
import { applyBalanceChange } from './wallet';

function resultFor(sel: { marketKey: string; outcomeCode: string; point: unknown }, hs: number, as: number): BetStatus {
  if (sel.marketKey === 'h2h') {
    const winner = hs > as ? 'home' : hs < as ? 'away' : 'draw';
    if (winner === 'draw' && sel.outcomeCode !== 'draw') {
      // two-way markets (no draw outcome offered) are void on a tie
      return 'LOST';
    }
    return sel.outcomeCode === winner ? 'WON' : 'LOST';
  }
  if (sel.marketKey === 'totals') {
    const total = hs + as;
    const line = Number(sel.point);
    if (total === line) return 'VOID';
    const over = total > line;
    return sel.outcomeCode.startsWith('over') === over ? 'WON' : 'LOST';
  }
  if (sel.marketKey === 'btts') {
    const both = hs > 0 && as > 0;
    return (sel.outcomeCode === 'yes') === both ? 'WON' : 'LOST';
  }
  if (sel.marketKey === 'double_chance') {
    const ok =
      (sel.outcomeCode === 'home_draw' && hs >= as) ||
      (sel.outcomeCode === 'home_away' && hs !== as) ||
      (sel.outcomeCode === 'draw_away' && hs <= as);
    return ok ? 'WON' : 'LOST';
  }
  return 'VOID';
}

/** Grade every open selection of a completed event, then re-evaluate affected bets. Returns bets settled. */
export async function settleEvent(eventId: string) {
  const ev = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  if (ev.homeScore == null || ev.awayScore == null) return 0;

  const sels = await prisma.betSelection.findMany({ where: { eventId, status: 'OPEN' } });
  for (const s of sels) {
    let status = resultFor(s, ev.homeScore, ev.awayScore);
    // Tie in a two-way moneyline (e.g. NFL/NHL regulation tie with no draw market) -> void
    if (s.marketKey === 'h2h' && ev.homeScore === ev.awayScore && s.outcomeCode !== 'draw') {
      const hasDraw = await prisma.outcome.count({ where: { market: { eventId, key: 'h2h' }, code: 'draw' } });
      if (!hasDraw) status = 'VOID';
    }
    await prisma.betSelection.update({ where: { id: s.id }, data: { status } });
  }
  return evaluateBets([...new Set<string>(sels.map((s) => s.betId))]);
}

/** Void every open selection of an event (postponed/cancelled). */
export async function voidEvent(eventId: string) {
  await prisma.event.update({ where: { id: eventId }, data: { status: 'CANCELLED' } });
  const sels = await prisma.betSelection.findMany({ where: { eventId, status: 'OPEN' } });
  await prisma.betSelection.updateMany({ where: { eventId, status: 'OPEN' }, data: { status: 'VOID' } });
  return evaluateBets([...new Set<string>(sels.map((s) => s.betId))]);
}

export async function evaluateBets(betIds: string[]) {
  let settled = 0;
  for (const id of betIds) {
    const bet = await prisma.bet.findUnique({ where: { id }, include: { selections: true } });
    if (!bet || bet.status !== 'OPEN') continue;
    const st = bet.selections.map((s) => s.status);
    let final: BetStatus | null = null;
    let payout = D(0);

    if (st.includes('LOST')) final = 'LOST';
    else if (st.includes('OPEN')) final = null;
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
        data: { status: final!, payout, settledAt: new Date() },
      });
      if (flipped.count !== 1) return;
      if (payout.gt(0)) {
        await applyBalanceChange(db, {
          userId: bet.userId,
          amount: payout,
          type: final === 'VOID' ? 'BET_REFUND' : 'BET_PAYOUT',
          betId: bet.id,
          note: final === 'VOID' ? 'Bet void — stake returned' : `Bet won @ ${bet.totalOdds}`,
        });
      }
    });
    settled++;
  }
  return settled;
}
