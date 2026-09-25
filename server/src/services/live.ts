import { config } from '../config';
import { D, prisma } from '../lib/prisma';
import { af } from './apifootball';
import { broadcastEvents } from './stream';

/**
 * In-play engine.
 * Polls API-Football /odds/live for every fixture in play, reprices our live markets and
 * decides when betting must be suspended — the same rules a real trading desk applies:
 *   • feed says blocked / stopped / finished      → all markets locked
 *   • a single price flagged suspended             → that selection locked
 *   • goal detected                                → everything locked for LIVE_GOAL_COOLDOWN_MS
 *   • no fresh feed for LIVE_STALE_MS              → everything locked
 *   • minute ≥ LIVE_CUTOFF_MINUTE                  → everything locked
 * Bets on live markets are additionally held for LIVE_BET_DELAY_MS and re-validated.
 */

interface LiveValue {
  value: string;
  odd: string;
  handicap?: string | null;
  main?: boolean | null;
  suspended?: boolean;
}
interface LiveItem {
  fixture: { id: number; status?: { long?: string; elapsed?: number | null; seconds?: string | null } };
  teams?: { home?: { goals?: number | null }; away?: { goals?: number | null } };
  status?: { stopped?: boolean; blocked?: boolean; finished?: boolean };
  odds: { id: number; name: string; values: LiveValue[] }[];
}

type LiveOutcome = { code: string; name: string; price: number; point?: number; suspended: boolean };
type LiveMarket = { key: string; outcomes: LiveOutcome[] };

const seenBetNames = new Set<string>();
const livePrice = (odd: string) => {
  const p = parseFloat(odd);
  if (!Number.isFinite(p) || p <= 1) return null;
  return Math.max(1.01, Math.round(p * (1 - config.liveMargin) * 100) / 100);
};

function buildLiveMarkets(item: LiveItem, home: string, away: string): LiveMarket[] {
  const out: LiveMarket[] = [];
  for (const bet of item.odds ?? []) {
    const n = bet.name.trim().toLowerCase();
    if (seenBetNames.size < 400 && !seenBetNames.has(n)) {
      seenBetNames.add(n);
      console.log(`[live] bet type seen: "${bet.name}" (id ${bet.id}) values: ${bet.values.slice(0, 4).map((v) => `${v.value}${v.handicap ? ` ${v.handicap}` : ''}`).join(', ')}`);
    }
  }
  const find = (re: RegExp, exclude = /half|corner|card|team|home|away|1st|2nd|asian|exact|minute|range/) =>
    (item.odds ?? []).find((b) => re.test(b.name.toLowerCase()) && !exclude.test(b.name.toLowerCase()));

  // 1X2
  const ft = find(/^(fulltime result|full time result|match winner|1x2)$/);
  if (ft) {
    const pick = (...labels: string[]) => ft.values.find((v) => labels.includes(String(v.value).toLowerCase()));
    const h = pick('home', '1'), d = pick('draw', 'x'), a = pick('away', '2');
    const hp = h && livePrice(h.odd), dp = d && livePrice(d.odd), ap = a && livePrice(a.odd);
    if (h && a && hp && ap) {
      out.push({
        key: 'h2h',
        outcomes: [
          { code: 'home', name: home, price: hp, suspended: !!h.suspended },
          ...(d && dp ? [{ code: 'draw', name: 'Draw', price: dp, suspended: !!d.suspended }] : []),
          { code: 'away', name: away, price: ap, suspended: !!a.suspended },
        ],
      });
    }
  }

  // Total goals — pick the main line (flagged main, else the most balanced line)
  const ou = find(/over\/under|total goals|goals over/);
  if (ou) {
    const lines = new Map<number, { over?: LiveValue; under?: LiveValue; main: boolean }>();
    for (const v of ou.values) {
      const m = String(v.value).match(/^(over|under)\s*([\d.]+)?$/i);
      if (!m) continue;
      const line = Number(v.handicap ?? m[2]);
      // only whole (push = void) and half lines; quarter lines (x.25/x.75) need split settlement
      if (!Number.isFinite(line) || !Number.isInteger(line * 2)) continue;
      const slot = lines.get(line) ?? { main: false };
      if (m[1].toLowerCase() === 'over') slot.over = v;
      else slot.under = v;
      if (v.main) slot.main = true;
      lines.set(line, slot);
    }
    const valid = [...lines.entries()].filter(([, s]) => s.over && s.under && livePrice(s.over.odd) && livePrice(s.under.odd));
    const main =
      valid.find(([, s]) => s.main) ??
      valid.sort((a, b) => Math.abs(+a[1].over!.odd - +a[1].under!.odd) - Math.abs(+b[1].over!.odd - +b[1].under!.odd))[0];
    if (main) {
      const [line, s] = main;
      out.push({
        key: 'totals',
        outcomes: [
          // line-specific codes so a pick on an old line can never silently move to a new one
          { code: `over_${line}`, name: `Over ${line}`, price: livePrice(s.over!.odd)!, point: line, suspended: !!s.over!.suspended },
          { code: `under_${line}`, name: `Under ${line}`, price: livePrice(s.under!.odd)!, point: line, suspended: !!s.under!.suspended },
        ],
      });
    }
  }

  // Both teams to score
  const bt = find(/both teams (to )?score/);
  if (bt) {
    const y = bt.values.find((v) => String(v.value).toLowerCase() === 'yes');
    const no = bt.values.find((v) => String(v.value).toLowerCase() === 'no');
    const yp = y && livePrice(y.odd), np = no && livePrice(no.odd);
    if (y && no && yp && np) {
      out.push({ key: 'btts', outcomes: [ { code: 'yes', name: 'Yes', price: yp, suspended: !!y.suspended }, { code: 'no', name: 'No', price: np, suspended: !!no.suspended } ] });
    }
  }
  return out;
}

async function saveLiveMarkets(eventId: string, markets: LiveMarket[], lockAll: boolean) {
  const keys: string[] = [];
  for (const m of markets) {
    keys.push(m.key);
    const market = await prisma.market.upsert({
      where: { eventId_key: { eventId, key: m.key } },
      create: { eventId, key: m.key, suspended: lockAll },
      update: { suspended: lockAll },
    });
    for (const o of m.outcomes) {
      await prisma.outcome.upsert({
        where: { marketId_code: { marketId: market.id, code: o.code } },
        create: { marketId: market.id, code: o.code, name: o.name, price: D(o.price), point: o.point != null ? D(o.point) : null, suspended: o.suspended },
        update: { name: o.name, price: D(o.price), point: o.point != null ? D(o.point) : null, active: true, suspended: o.suspended },
      });
    }
    await prisma.outcome.updateMany({ where: { marketId: market.id, code: { notIn: m.outcomes.map((o) => o.code) } }, data: { active: false } });
  }
  // markets the live feed no longer offers (e.g. pre-match double chance) stay locked
  await prisma.market.updateMany({ where: { eventId, key: { notIn: keys }, suspended: false }, data: { suspended: true } });
}

let running = false;
export async function syncLiveOdds() {
  if (running) return 0;
  running = true;
  try {
    const now = new Date();
    const liveEvents = await prisma.event.findMany({
      where: {
        id: { startsWith: 'af_' },
        OR: [{ status: 'LIVE' }, { status: 'UPCOMING', commenceTime: { lte: new Date(now.getTime() + 5 * 60_000) } }],
      },
    });
    if (!liveEvents.length) return 0; // nothing in play: spend no requests

    const d = await af<LiveItem>('/odds/live', {});
    const byId = new Map(liveEvents.map((e) => [e.id, e]));
    const fed = new Set<string>();
    let priced = 0;

    for (const item of d.response) {
      const id = `af_${item.fixture.id}`;
      const ev = byId.get(id);
      if (!ev) continue;
      fed.add(id);

      // Score + minute are owned by the fixtures feed (syncLiveScores). The odds feed's goals are only a
      // second signal: if it already shows a different score, a goal just happened → lock.
      const oh = item.teams?.home?.goals, oa = item.teams?.away?.goals;
      const feedGoal = ev.homeScore != null && ev.awayScore != null && oh != null && oa != null && (oh > ev.homeScore || oa > ev.awayScore);
      let cooldownUntil = ev.liveSuspendedUntil;
      if (feedGoal && !(cooldownUntil && cooldownUntil > now)) cooldownUntil = new Date(now.getTime() + config.liveGoalCooldownMs);
      const inCooldown = !!cooldownUntil && cooldownUntil > now;
      const elapsed = ev.liveElapsed;
      const blocked = !!(item.status?.blocked || item.status?.stopped || item.status?.finished) || (elapsed != null && elapsed >= config.liveCutoffMinute);

      await prisma.event.update({
        where: { id },
        data: { status: 'LIVE', liveUpdatedAt: now, liveSuspendedUntil: cooldownUntil, liveBlocked: blocked },
      });
      const markets = buildLiveMarkets(item, ev.homeTeam, ev.awayTeam);
      await saveLiveMarkets(id, markets, blocked || inCooldown);
      if (markets.length) priced++;
    }

    // in play but missing from the feed -> lock
    const missing = liveEvents.filter((e) => e.status === 'LIVE' && !fed.has(e.id)).map((e) => e.id);
    if (missing.length) await prisma.market.updateMany({ where: { eventId: { in: missing }, suspended: false }, data: { suspended: true } });
    await broadcastEvents([...fed, ...missing]);
    return priced;
  } finally {
    running = false;
  }
}

export { eventOpen, outcomeOpen } from './open';

/* ----------------- Official live score + minute (fixtures feed) ----------------- */

interface LiveFixture {
  fixture: { id: number; date: string; status: { short: string; elapsed: number | null; extra?: number | null } };
  league: { id: number; round?: string };
  teams: { home: { name: string; logo: string }; away: { name: string; logo: string } };
  goals: { home: number | null; away: number | null };
}
const IN_PLAY = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);

let scoresRunning = false;
export async function syncLiveScores() {
  if (scoresRunning) return 0;
  scoresRunning = true;
  try {
    const now = new Date();
    const d = await af<LiveFixture>('/fixtures', { live: 'all', timezone: 'UTC' });
    const ids = d.response.map((f) => `af_${f.fixture.id}`);
    if (!ids.length) return 0;
    const known = await prisma.event.findMany({ where: { id: { in: ids } } });
    const byId = new Map(known.map((e) => [e.id, e]));
    let n = 0;
    const changed: string[] = [];
    for (const f of d.response) {
      const ev = byId.get(`af_${f.fixture.id}`);
      if (!ev || ev.status === 'COMPLETED' || ev.status === 'CANCELLED') continue;
      if (!IN_PLAY.has(f.fixture.status.short)) continue;
      const hs = f.goals.home, as = f.goals.away;
      const goal = ev.homeScore != null && ev.awayScore != null && hs != null && as != null && (hs !== ev.homeScore || as !== ev.awayScore);
      const minute = f.fixture.status.short === 'HT' ? 45 : f.fixture.status.elapsed != null ? f.fixture.status.elapsed + (f.fixture.status.extra ?? 0) : ev.liveElapsed;
      const data: Record<string, unknown> = { status: 'LIVE', homeScore: hs, awayScore: as, liveElapsed: minute, lastScoreSync: now };
      if (goal) {
        data.liveSuspendedUntil = new Date(now.getTime() + config.liveGoalCooldownMs);
        console.log(`[live] goal ${ev.homeTeam} ${hs}-${as} ${ev.awayTeam} — markets locked ${config.liveGoalCooldownMs / 1000}s`);
      }
      if (minute != null && minute >= config.liveCutoffMinute) data.liveBlocked = true;
      await prisma.event.update({ where: { id: ev.id }, data });
      if (goal) await prisma.market.updateMany({ where: { eventId: ev.id }, data: { suspended: true } });
      if (goal || hs !== ev.homeScore || as !== ev.awayScore || minute !== ev.liveElapsed) changed.push(ev.id);
      n++;
    }
    await broadcastEvents(changed);
    return n;
  } finally {
    scoresRunning = false;
  }
}

export function startLiveJob() {
  if (!config.liveBetting || config.provider !== 'apifootball' || !config.afKey) return;
  console.log(`[live] in-play odds every ${config.liveOddsIntervalMs / 1000}s · goal lock ${config.liveGoalCooldownMs / 1000}s · bet delay ${config.liveBetDelayMs / 1000}s`);
  setInterval(() => {
    syncLiveOdds().catch((e) => console.error('[live] odds sync failed', (e as Error).message));
  }, config.liveOddsIntervalMs);
  setInterval(() => {
    syncLiveScores().catch((e) => console.error('[live] score sync failed', (e as Error).message));
  }, config.liveScoreIntervalMs);
}
