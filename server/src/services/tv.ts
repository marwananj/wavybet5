import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { config } from '../config';
import { HttpError } from '../lib/http';
import { D, money, prisma } from '../lib/prisma';
import { addWager } from './rewards';
import { applyBalanceChange } from './wallet';

/**
 * Wavy TV — live-draw games on a fixed schedule. Every PERIOD a new round starts; bets are taken
 * for BET_WINDOW, then the result is drawn and shown to everyone at the same moment.
 *
 * Provably fair: each UTC day has a secret seed (stored in Setting). Its SHA-256 hash is public
 * during the day and the seed itself is revealed the next day. A round's result is
 *   HMAC_SHA256(daySeed, `${game}:${round}`) → floats → dice / cards.
 */
export const PERIOD = 40_000;
export const BET_WINDOW = 27_000;

type Market = { id: string; label: string; odds: number; group: string };

export interface DiceResult {
  red: number;
  blue: number;
}
export interface WarResult {
  player: { rank: number; suit: number };
  dealer: { rank: number; suit: number };
}

export const TV_GAMES: Record<string, { name: string; markets: Market[] }> = {
  'tv-dice': {
    name: 'Dice Duel',
    markets: [
      { id: 'red', label: 'Red wins', odds: 2.32, group: 'Winner' },
      { id: 'draw', label: 'Draw', odds: 5.8, group: 'Winner' },
      { id: 'blue', label: 'Blue wins', odds: 2.32, group: 'Winner' },
      { id: 'under7', label: 'Total under 7', odds: 2.32, group: 'Total' },
      { id: 'seven', label: 'Total exactly 7', odds: 5.8, group: 'Total' },
      { id: 'over7', label: 'Total over 7', odds: 2.32, group: 'Total' },
      { id: 'double', label: 'Any double', odds: 5.8, group: 'Specials' },
      { id: 'red6', label: 'Red rolls 6', odds: 5.8, group: 'Specials' },
      { id: 'blue6', label: 'Blue rolls 6', odds: 5.8, group: 'Specials' },
    ],
  },
  'tv-war': {
    name: 'Card War',
    markets: [
      { id: 'player', label: 'Player wins', odds: 2.08, group: 'Winner' },
      { id: 'war', label: 'War (tie)', odds: 12.5, group: 'Winner' },
      { id: 'dealer', label: 'Dealer wins', odds: 2.08, group: 'Winner' },
      { id: 'p_red', label: 'Player card red', odds: 1.92, group: 'Player card' },
      { id: 'p_black', label: 'Player card black', odds: 1.92, group: 'Player card' },
      { id: 'p_high', label: 'Player card 8 or higher', odds: 1.78, group: 'Player card' },
      { id: 'p_face', label: 'Player card J, Q, K, A', odds: 3.12, group: 'Player card' },
    ],
  },
};

/* ───────────────────────────── seeds & results ───────────────────────────── */

const dayOf = (round: number) => new Date(round * PERIOD).toISOString().slice(0, 10);
const seedCache = new Map<string, string>();

async function daySeed(day: string) {
  const c = seedCache.get(day);
  if (c) return c;
  const key = `tv:seed:${day}`;
  let s = await prisma.setting.findUnique({ where: { key } });
  if (!s) {
    try {
      s = await prisma.setting.create({ data: { key, value: crypto.randomBytes(32).toString('hex') } });
    } catch {
      s = await prisma.setting.findUniqueOrThrow({ where: { key } }); // created by another instance
    }
  }
  seedCache.set(day, s.value);
  if (seedCache.size > 5) seedCache.delete(seedCache.keys().next().value!);
  return s.value;
}

function floats(seed: string, game: string, round: number) {
  const h = crypto.createHmac('sha256', seed).update(`${game}:${round}`).digest();
  return Array.from({ length: 8 }, (_, i) => h.readUInt32BE(i * 4) / 2 ** 32);
}

export async function resultOf(game: string, round: number): Promise<DiceResult | WarResult> {
  const f = floats(await daySeed(dayOf(round)), game, round);
  if (game === 'tv-dice') return { red: 1 + Math.floor(f[0] * 6), blue: 1 + Math.floor(f[1] * 6) };
  // infinite-deck war: ranks 2..14 (A high), suits 0..3
  return {
    player: { rank: 2 + Math.floor(f[0] * 13), suit: Math.floor(f[1] * 4) },
    dealer: { rank: 2 + Math.floor(f[2] * 13), suit: Math.floor(f[3] * 4) },
  };
}

export function wins(game: string, market: string, r: DiceResult | WarResult): boolean {
  if (game === 'tv-dice') {
    const { red, blue } = r as DiceResult;
    const t = red + blue;
    switch (market) {
      case 'red':
        return red > blue;
      case 'blue':
        return blue > red;
      case 'draw':
        return red === blue;
      case 'under7':
        return t < 7;
      case 'over7':
        return t > 7;
      case 'seven':
        return t === 7;
      case 'double':
        return red === blue;
      case 'red6':
        return red === 6;
      case 'blue6':
        return blue === 6;
    }
    return false;
  }
  const { player, dealer } = r as WarResult;
  switch (market) {
    case 'player':
      return player.rank > dealer.rank;
    case 'dealer':
      return dealer.rank > player.rank;
    case 'war':
      return player.rank === dealer.rank;
    case 'p_red':
      return player.suit === 1 || player.suit === 2;
    case 'p_black':
      return player.suit === 0 || player.suit === 3;
    case 'p_high':
      return player.rank >= 8;
    case 'p_face':
      return player.rank >= 11;
  }
  return false;
}

export const currentRound = (now = Date.now()) => Math.floor(now / PERIOD);
export const drawTime = (round: number) => round * PERIOD + BET_WINDOW;

/* ───────────────────────────── betting ───────────────────────────── */

export async function placeTvBet(userId: string, game: string, market: string, stakeNum: number) {
  const g = TV_GAMES[game];
  if (!g) throw new HttpError(404, 'Unknown game');
  const m = g.markets.find((x) => x.id === market);
  if (!m) throw new HttpError(400, 'Unknown market');
  if (!config.casinoEnabled) throw new HttpError(503, 'Casino is temporarily closed');
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { selfExcludedUntil: true, emailVerified: true } });
  if (u.selfExcludedUntil && u.selfExcludedUntil > new Date()) throw new HttpError(403, 'You are self-excluded');
  if (!u.emailVerified) throw new HttpError(403, 'Verify your e-mail to start playing', 'EMAIL_UNVERIFIED');
  if (!(stakeNum >= config.casinoMinStake)) throw new HttpError(400, `Minimum bet is $${config.casinoMinStake}`);
  if (stakeNum > config.casinoMaxStake) throw new HttpError(400, `Maximum bet is $${config.casinoMaxStake}`);
  const now = Date.now();
  const round = currentRound(now);
  if (now >= drawTime(round) - 500) throw new HttpError(400, 'Betting is closed for this draw — next round starts soon');
  const stake = money(stakeNum);
  if (stake.mul(m.odds).gt(config.casinoMaxPayout)) throw new HttpError(400, `Maximum payout is $${config.casinoMaxPayout}`);
  return prisma.$transaction(async (db) => {
    await applyBalanceChange(db, { userId, amount: stake.negated(), type: 'CASINO_BET', note: `Wavy TV · ${g.name} #${round} · ${m.label}` });
    await addWager(db, userId, stake);
    const bet = await db.tvBet.create({ data: { userId, game, round, market, stake, odds: D(m.odds) } });
    const bal = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } });
    return { bet: serializeTv(bet), balance: String(bal.balance) };
  });
}

export const serializeTv = (b: { id: string; game: string; round: number; market: string; stake: Prisma.Decimal; odds: Prisma.Decimal; status: string; payout: Prisma.Decimal; createdAt: Date }) => ({
  id: b.id,
  game: b.game,
  round: b.round,
  market: b.market,
  label: TV_GAMES[b.game]?.markets.find((m) => m.id === b.market)?.label ?? b.market,
  stake: String(b.stake),
  odds: Number(b.odds),
  status: b.status,
  payout: String(b.payout),
  createdAt: b.createdAt,
});

/** settle every open bet whose draw time has passed (idempotent) */
let settling = false;
export async function settleTv() {
  if (settling) return;
  settling = true;
  try {
    const due = await prisma.tvBet.findMany({ where: { status: 'OPEN', round: { lt: currentRound() + 1 } }, take: 500, orderBy: { round: 'asc' } });
    const now = Date.now();
    for (const b of due) {
      if (drawTime(b.round) > now) continue;
      const r = await resultOf(b.game, b.round);
      const won = wins(b.game, b.market, r);
      const payout = won ? money(D(b.stake).mul(b.odds)) : D(0);
      await prisma.$transaction(async (db) => {
        const upd = await db.tvBet.updateMany({ where: { id: b.id, status: 'OPEN' }, data: { status: won ? 'WON' : 'LOST', payout, settledAt: new Date() } });
        if (upd.count !== 1) return;
        if (won) await applyBalanceChange(db, { userId: b.userId, amount: payout, type: 'CASINO_WIN', note: `Wavy TV · ${TV_GAMES[b.game]?.name} #${b.round} win` });
      });
    }
  } catch (e) {
    console.error('[tv] settle failed', e);
  } finally {
    settling = false;
  }
}

export function startTv() {
  setInterval(() => void settleTv(), 2000);
}

export async function tvFairness() {
  const today = new Date().toISOString().slice(0, 10);
  const yday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const seed = await daySeed(today);
  const prev = await prisma.setting.findUnique({ where: { key: `tv:seed:${yday}` } });
  return {
    today: { day: today, hash: crypto.createHash('sha256').update(seed).digest('hex') },
    yesterday: prev ? { day: yday, seed: prev.value, hash: crypto.createHash('sha256').update(prev.value).digest('hex') } : null,
    formula: 'HMAC_SHA256(daySeed, `${game}:${round}`) → 4-byte floats; dice = 1+floor(f×6); war rank = 2+floor(f×13)',
  };
}
