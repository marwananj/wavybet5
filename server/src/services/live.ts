import { config } from '../config';
import { D, prisma } from '../lib/prisma';
import { af, afCheckFixtures } from './apifootball';
import { broadcastEvents } from './stream';
import { classifyBet, dcCode, invalidateMarkets, noteBetType, parseLine, parseScore, saveMarket, side3, type MarketKey, type OutcomeIn } from './markets';
import { applyEarlyPayout } from './settlement';
import { modelFirstHalf } from './liveModel';

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

type LiveMarket = { key: MarketKey; outcomes: OutcomeIn[] };

const livePrice = (odd: string) => {
  const p = parseFloat(odd);
  if (!Number.isFinite(p) || p <= 1) return null;
  return Math.max(1.01, Math.round(p * (1 - config.liveMargin) * 100) / 100);
};

function buildLiveMarkets(item: LiveItem, home: string, away: string, minute: number | null, score: [number, number] | null = null): LiveMarket[] {
  // group the feed's bets by our market key (a feed can list the same market under two names)
  const byKey = new Map<MarketKey, LiveValue[]>();
  for (const bet of item.odds ?? []) {
    noteBetType('live', bet.name, bet.values.slice(0, 4).map((v) => `${v.value}${v.handicap ? ` ${v.handicap}` : ''}`).join(', '));
    const key = classifyBet(bet.name);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, bet.values); // first listing wins
  }
  const out: LiveMarket[] = [];

  const three = (key: MarketKey) => {
    const vals = byKey.get(key);
    if (!vals) return;
    const o: OutcomeIn[] = [];
    for (const v of vals) {
      const c = side3(v.value);
      const p = livePrice(v.odd);
      if (!c || !p || o.some((x) => x.code === c)) continue;
      o.push({ code: c, name: c === 'home' ? home : c === 'away' ? away : 'Draw', price: p, suspended: !!v.suspended });
    }
    if (o.some((x) => x.code === 'home') && o.some((x) => x.code === 'away')) {
      o.sort((a, b) => ['home', 'draw', 'away'].indexOf(a.code) - ['home', 'draw', 'away'].indexOf(b.code));
      out.push({ key, outcomes: o });
    }
  };
  const lines = (key: MarketKey, max: number, halfOnly: boolean) => {
    const vals = byKey.get(key);
    if (!vals) return;
    const by = new Map<number, { over?: LiveValue; under?: LiveValue; main: boolean }>();
    for (const v of vals) {
      const l = parseLine(v.value, v.handicap);
      if (!l || !Number.isInteger(l.line * 2)) continue; // no quarter lines
      if (halfOnly && Number.isInteger(l.line)) continue;
      const slot = by.get(l.line) ?? { main: false };
      slot[l.side] = v;
      if (v.main) slot.main = true;
      by.set(l.line, slot);
    }
    const valid = [...by.entries()].filter(([, s]) => s.over && s.under && livePrice(s.over.odd) && livePrice(s.under.odd));
    if (!valid.length) return;
    const balance = (s: { over?: LiveValue; under?: LiveValue }) => Math.abs(+s.over!.odd - +s.under!.odd);
    const main = valid.find(([, s]) => s.main) ?? [...valid].sort((a, b) => balance(a[1]) - balance(b[1]))[0];
    // main line plus the nearest lines either side
    const chosen = [...valid].sort((a, b) => Math.abs(a[0] - main[0]) - Math.abs(b[0] - main[0])).slice(0, max).sort((a, b) => a[0] - b[0]);
    const outcomes: OutcomeIn[] = [];
    for (const [line, st] of chosen) {
      outcomes.push({ code: `over_${line}`, name: `Over ${line}`, price: livePrice(st.over!.odd)!, point: line, suspended: !!st.over!.suspended });
      outcomes.push({ code: `under_${line}`, name: `Under ${line}`, price: livePrice(st.under!.odd)!, point: line, suspended: !!st.under!.suspended });
    }
    out.push({ key, outcomes });
  };

  three('h2h');
  const dc = byKey.get('double_chance');
  if (dc) {
    const names = { home_draw: `${home} or Draw`, home_away: `${home} or ${away}`, draw_away: `Draw or ${away}` } as const;
    const o: OutcomeIn[] = [];
    for (const v of dc) {
      const c = dcCode(v.value);
      const p = livePrice(v.odd);
      if (c && p && !o.some((x) => x.code === c)) o.push({ code: c, name: names[c], price: p, suspended: !!v.suspended });
    }
    if (o.length >= 2) out.push({ key: 'double_chance', outcomes: o });
  }
  lines('totals', 5, false);
  const bt = byKey.get('btts');
  if (bt) {
    const y = bt.find((v) => String(v.value).trim().toLowerCase() === 'yes');
    const n = bt.find((v) => String(v.value).trim().toLowerCase() === 'no');
    const yp = y && livePrice(y.odd), np = n && livePrice(n.odd);
    if (y && n && yp && np) out.push({ key: 'btts', outcomes: [{ code: 'yes', name: 'Yes', price: yp, suspended: !!y.suspended }, { code: 'no', name: 'No', price: np, suspended: !!n.suspended }] });
  }
  // 1st-half markets only until half-time
  if (minute == null || minute < 44) {
    three('ht_h2h');
    lines('ht_totals', 3, false);
  }
  const cs = byKey.get('correct_score');
  if (cs) {
    const o: OutcomeIn[] = [];
    for (const v of cs) {
      const sc = parseScore(v.value);
      const p = livePrice(v.odd);
      if (!sc || !p || sc[0] > 9 || sc[1] > 9) continue;
      const code = `cs_${sc[0]}_${sc[1]}`;
      if (!o.some((x) => x.code === code)) o.push({ code, name: `${sc[0]}-${sc[1]}`, price: p, suspended: !!v.suspended });
    }
    if (o.length >= 3) out.push({ key: 'correct_score', outcomes: o });
  }
  lines('corners_totals', 3, true);
  three('corners_h2h');

  // 1st-half markets stay open all through the first half: if the feed doesn't price them, model them
  // from the live match-result + goals prices (they close at 43', same as the feed's own).
  if (minute != null && minute < 43 && score && !out.some((m) => m.key === 'ht_h2h')) {
    const h2h = out.find((m) => m.key === 'h2h');
    const hp = h2h?.outcomes.find((o) => o.code === 'home')?.price;
    const dp = h2h?.outcomes.find((o) => o.code === 'draw')?.price;
    const ap = h2h?.outcomes.find((o) => o.code === 'away')?.price;
    if (hp && dp && ap) {
      const tot = out.find((m) => m.key === 'totals');
      let totals: { line: number; over: number; under: number } | undefined;
      if (tot) {
        const lines = [...new Set(tot.outcomes.map((o) => o.point).filter((p): p is number => p != null))];
        const pick = lines
          .map((l) => ({ l, o: tot.outcomes.find((x) => x.code === `over_${l}`)?.price, u: tot.outcomes.find((x) => x.code === `under_${l}`)?.price }))
          .filter((x) => x.o && x.u)
          .sort((a, b) => Math.abs(a.o! - a.u!) - Math.abs(b.o! - b.u!))[0];
        if (pick) totals = { line: pick.l, over: pick.o!, under: pick.u! };
      }
      const m = modelFirstHalf({ minute, home, away, score, h2h: { home: hp, draw: dp, away: ap }, totals });
      if (m) {
        out.push({ key: 'ht_h2h', outcomes: m.ht_h2h });
        if (m.ht_totals.length) out.push({ key: 'ht_totals', outcomes: m.ht_totals });
      }
    }
  }
  return out;
}

async function saveLiveMarkets(eventId: string, markets: LiveMarket[], lockAll: boolean, previousKeys: string[]) {
  for (const m of markets) await saveMarket(eventId, m.key, m.outcomes, lockAll);
  // markets the live feed no longer offers (e.g. 1st half after the break) stay visible but locked
  const keys = markets.map((m) => m.key as string);
  const gone = previousKeys.filter((k) => !keys.includes(k));
  if (gone.length) {
    await prisma.market.updateMany({ where: { eventId, key: { in: gone }, suspended: false }, data: { suspended: true } });
    invalidateMarkets([eventId]);
  }
}

/** after a goal lock, fetch fresh prices the moment the lock ends so markets reopen right away */
let reopenTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleReopen() {
  if (reopenTimer) return;
  reopenTimer = setTimeout(() => {
    reopenTimer = null;
    syncLiveOdds().catch((e) => console.error('[live] reopen sync failed', (e as Error).message));
  }, config.liveGoalCooldownMs + 400);
}

const keysByEvent = new Map<string, string[]>();
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
      if (feedGoal && !(cooldownUntil && cooldownUntil > now)) {
        cooldownUntil = new Date(now.getTime() + config.liveGoalCooldownMs);
        scheduleReopen();
      }
      const inCooldown = !!cooldownUntil && cooldownUntil > now;
      const elapsed = ev.liveElapsed;
      const blocked = !!(item.status?.blocked || item.status?.stopped || item.status?.finished) || (elapsed != null && elapsed >= config.liveCutoffMinute);

      await prisma.event.update({
        where: { id },
        data: { status: 'LIVE', liveUpdatedAt: now, liveSuspendedUntil: cooldownUntil, liveBlocked: blocked },
      });
      const markets = buildLiveMarkets(item, ev.homeTeam, ev.awayTeam, elapsed, ev.homeScore != null && ev.awayScore != null ? [ev.homeScore, ev.awayScore] : null);
      const existing = keysByEvent.get(id) ?? (await prisma.market.findMany({ where: { eventId: id }, select: { key: true } })).map((m) => m.key);
      await saveLiveMarkets(id, markets, blocked || inCooldown, existing);
      keysByEvent.set(id, [...new Set([...existing, ...markets.map((m) => m.key)])]);
      if (markets.length) priced++;
    }

    // in play but missing from the feed -> lock
    const missing = liveEvents.filter((e) => e.status === 'LIVE' && !fed.has(e.id)).map((e) => e.id);
    if (missing.length) {
      await prisma.market.updateMany({ where: { eventId: { in: missing }, suspended: false }, data: { suspended: true } });
      invalidateMarkets(missing);
    }
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
const lastGoneCheck = new Map<string, number>();
export async function syncLiveScores() {
  if (scoresRunning) return 0;
  scoresRunning = true;
  try {
    const now = new Date();
    const d = await af<LiveFixture>('/fixtures', { live: 'all', timezone: 'UTC' });
    const ids = d.response.map((f) => `af_${f.fixture.id}`);
    // matches we show as live that dropped out of the in-play list → finished / abandoned: settle within seconds
    const inPlay = new Set(d.response.filter((f) => IN_PLAY.has(f.fixture.status.short)).map((f) => `af_${f.fixture.id}`));
    const ours = await prisma.event.findMany({ where: { id: { startsWith: 'af_' }, status: 'LIVE' }, select: { id: true } });
    const gone = ours.map((e) => e.id).filter((id) => !inPlay.has(id) && Date.now() - (lastGoneCheck.get(id) ?? 0) > 45_000);
    if (gone.length) {
      gone.forEach((id) => lastGoneCheck.set(id, Date.now()));
      if (lastGoneCheck.size > 2000) lastGoneCheck.clear();
      afCheckFixtures(gone)
        .then(async (n) => {
          if (n) console.log(`[live] ${gone.length} match(es) left play — settled ${n} bet(s)`);
          await prisma.market.updateMany({ where: { eventId: { in: gone }, event: { status: { not: 'LIVE' } } }, data: { suspended: true } });
          invalidateMarkets(gone);
          await broadcastEvents(gone);
        })
        .catch((e) => console.error('[live] finish check failed', (e as Error).message));
    }
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
      if (goal) {
        await prisma.market.updateMany({ where: { eventId: ev.id }, data: { suspended: true } });
        invalidateMarkets([ev.id]);
        scheduleReopen();
      }
      if (goal && hs != null && as != null) await applyEarlyPayout(ev.id, hs, as);
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
