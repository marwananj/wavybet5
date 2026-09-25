import { config } from '../config';
import { D, prisma } from '../lib/prisma';
import { applyEarlyPayout, settleEvent, voidEvent } from './settlement';
import { classifyBet, dcCode, forgetEvent, invalidateMarkets, noteBetType, parseLine, parseScore, saveMarket, side3, type MarketKey, type OutcomeIn } from './markets';

/**
 * API-Football (api-sports.io) feed: leagues, fixtures, pre-match odds and results.
 * Soccer only. Event ids are prefixed "af_" + fixture id.
 */

export interface AfEnvelope<T> {
  errors: unknown;
  results: number;
  paging?: { current: number; total: number };
  response: T[];
}
interface AfLeague {
  league: { id: number; name: string; type: string; logo: string };
  country: { name: string; code: string | null; flag: string | null };
  seasons: { year: number; current: boolean; coverage?: { odds?: boolean } }[];
}
interface AfFixture {
  fixture: { id: number; date: string; timestamp: number; status: { short: string; elapsed: number | null } };
  league: { id: number; name: string; country: string; season: number; round?: string };
  teams: { home: { id: number; name: string; logo: string }; away: { id: number; name: string; logo: string } };
  goals: { home: number | null; away: number | null };
  score: { halftime?: { home: number | null; away: number | null }; fulltime: { home: number | null; away: number | null } };
  statistics?: { team: { id: number }; statistics: { type: string; value: number | string | null }[] }[];
}

/** corner kicks from a fixture's statistics block (only present on /fixtures?id|ids) */
export function cornersOf(f: AfFixture): [number, number] | null {
  const st = f.statistics;
  if (!st || st.length < 2) return null;
  const get = (teamId: number) => {
    const t = st.find((x) => x.team.id === teamId);
    const v = t?.statistics.find((x) => x.type.toLowerCase() === 'corner kicks')?.value;
    return v == null ? null : Number(v);
  };
  const h = get(f.teams.home.id), a = get(f.teams.away.id);
  return h == null || a == null || !Number.isFinite(h) || !Number.isFinite(a) ? null : [h, a];
}
interface AfOdds {
  fixture: { id: number };
  bookmakers: { id: number; name: string; bets: { id: number; name: string; values: { value: string; odd: string }[] }[] }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

export async function af<T>(path: string, params: Record<string, string | number>): Promise<AfEnvelope<T>> {
  if (!config.afKey) throw new Error('APIFOOTBALL_KEY not set');
  // stay well under the per-minute cap and avoid firewall blocks
  const wait = 200 - (Date.now() - lastCall); // ≤300/min, under the Ultra per-minute cap
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();

  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${config.afBase}${path}?${qs}`, { headers: { 'x-apisports-key': config.afKey } });
  const remaining = res.headers.get('x-ratelimit-requests-remaining');
  if (remaining) {
    await prisma.setting.upsert({
      where: { key: 'odds_quota_remaining' },
      create: { key: 'odds_quota_remaining', value: remaining },
      update: { value: remaining },
    });
  }
  if (res.status === 429) throw new Error('API-Football rate limit hit (429)');
  if (!res.ok) throw new Error(`API-Football ${path} -> HTTP ${res.status}`);
  const body = (await res.json()) as AfEnvelope<T>;
  const errs = body.errors;
  const hasErr = Array.isArray(errs) ? errs.length > 0 : errs && typeof errs === 'object' && Object.keys(errs).length > 0;
  if (hasErr) throw new Error(`API-Football ${path} error: ${JSON.stringify(errs)}`);
  return body;
}

export async function afStatus() {
  const res = await fetch(`${config.afBase}/status`, { headers: { 'x-apisports-key': config.afKey } });
  return res.json();
}

const sportKey = (leagueId: number | string) => `soccer_af_${leagueId}`;
const eventId = (fixtureId: number) => `af_${fixtureId}`;
const leagueTitle = (country: string | null | undefined, name: string) =>
  country && country !== 'World' ? `${country} · ${name}` : name;

const LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
const DONE = new Set(['FT', 'AET', 'PEN']);
const DEAD = new Set(['CANC', 'ABD', 'AWD', 'WO']);

/* --------------------------------- Leagues -------------------------------- */

async function upsertLeague(l: AfLeague) {
  const id = l.league.id;
  const season = l.seasons.find((s) => s.current) ?? l.seasons[l.seasons.length - 1];
  const title = leagueTitle(l.country.name, l.league.name);
  await prisma.sport.upsert({
    where: { key: sportKey(id) },
    create: {
      key: sportKey(id), group: 'Soccer', title, provider: 'apifootball', season: season?.year ?? null,
      country: l.country.name, logo: l.league.logo, active: !!season?.current, enabled: true,
    },
    update: { title, provider: 'apifootball', season: season?.year ?? null, country: l.country.name, logo: l.league.logo, active: !!season?.current },
  });
}

/** Auto mode: one request lists every current competition; keep those with odds, popular first. */
async function afSyncSportsAuto() {
  const d = await af<AfLeague>('/leagues', { current: 'true' });
  const rank = new Map(config.afPriority.map((id, i) => [Number(id), i]));
  // Priority competitions are always kept while in season (API coverage flags can lag for big
  // competitions early in a season); everything else needs odds coverage.
  const withOdds = d.response.filter((l) => {
    const cur = l.seasons.find((s) => s.current);
    return cur && (rank.has(l.league.id) || cur.coverage?.odds !== false);
  });
  // Fill order after the priority list: top divisions first, then lower tiers, youth/reserve/amateur last
  const tier = (l: AfLeague) => {
    const n = `${l.league.name}`.toLowerCase();
    if (/u1\d|u2\d|youth|junior|reserve|primavera|academy|amateur|regional|non league|npl|division - |group [a-z]\b|3\.|4\.|women|femin|frauen|dames|serie c|serie d|ligue 3|primera c|federal|derde|tweede/.test(n)) return 3;
    if (/2\.|second|segunda|serie b|ligue 2|championship|1\. (division|deild|lig)|first league|primera b|liga 2|league one|superettan|challenger|challenge/.test(n)) return 2;
    return l.league.type === 'Cup' ? 1.5 : 1;
  };
  withOdds.sort((a, b) => {
    const ra = rank.get(a.league.id) ?? 1e6;
    const rb = rank.get(b.league.id) ?? 1e6;
    if (ra !== rb) return ra - rb;
    const ta = tier(a), tb = tier(b);
    if (ta !== tb) return ta - tb;
    return a.league.id - b.league.id;
  });
  const chosen = withOdds.slice(0, config.afMaxLeagues);
  for (const l of chosen) await upsertLeague(l);
  // competitions that dropped out of the selection stop syncing (admin toggles are kept)
  await prisma.sport.updateMany({
    where: { provider: 'apifootball', key: { notIn: chosen.map((l) => sportKey(l.league.id)) } },
    data: { active: false },
  });
  console.log(`[api-football] auto leagues: ${chosen.length} selected of ${withOdds.length} with odds`);
  return chosen.length;
}

export async function afSyncSports() {
  if (config.afLeagues.length === 1 && config.afLeagues[0].toLowerCase() === 'auto') return afSyncSportsAuto();
  let n = 0;
  for (const id of config.afLeagues) {
    try {
      const d = await af<AfLeague>('/leagues', { id });
      const l = d.response[0];
      if (!l) continue;
      await upsertLeague(l);
      n++;
    } catch (e) {
      console.error('[api-football] league', id, (e as Error).message);
    }
  }
  return n;
}

/* ----------------------------- Fixtures + odds ---------------------------- */

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const price = (xs: number[]) => Math.max(1.01, Math.round(median(xs) * (1 - config.houseMargin) * 100) / 100);

type BuiltMarket = { key: MarketKey; outcomes: OutcomeIn[] };

function buildMarkets(odds: AfOdds, home: string, away: string): BuiltMarket[] {
  // market -> value label -> prices across bookmakers
  const pool: Partial<Record<MarketKey, Record<string, number[]>>> = {};
  for (const b of odds.bookmakers) {
    for (const bet of b.bets) {
      noteBetType('prematch', bet.name, bet.values.slice(0, 4).map((v) => v.value).join(', '));
      const key = classifyBet(bet.name);
      if (!key) continue;
      for (const v of bet.values) {
        const p = parseFloat(v.odd);
        if (!Number.isFinite(p) || p <= 1) continue;
        ((pool[key] ??= {})[String(v.value).trim()] ??= []).push(p);
      }
    }
  }
  const out: BuiltMarket[] = [];
  const three = (key: MarketKey, homeName = home, awayName = away) => {
    const m = pool[key];
    if (!m) return;
    const got: Partial<Record<'home' | 'draw' | 'away', number[]>> = {};
    for (const [label, prices] of Object.entries(m)) {
      const s3 = side3(label);
      if (s3) got[s3] = [...(got[s3] ?? []), ...prices];
    }
    if (!got.home || !got.away) return;
    out.push({
      key,
      outcomes: [
        { code: 'home', name: homeName, price: price(got.home) },
        ...(got.draw ? [{ code: 'draw', name: 'Draw', price: price(got.draw) }] : []),
        { code: 'away', name: awayName, price: price(got.away) },
      ],
    });
  };
  const lines = (key: MarketKey, max: number, halfOnly: boolean) => {
    const m = pool[key];
    if (!m) return;
    const by = new Map<number, { over?: number[]; under?: number[] }>();
    for (const [label, prices] of Object.entries(m)) {
      const l = parseLine(label);
      if (!l) continue;
      if (!Number.isInteger(l.line * 2)) continue; // quarter (Asian) lines need split settlement
      if (halfOnly && Number.isInteger(l.line)) continue;
      const slot = by.get(l.line) ?? {};
      slot[l.side] = prices;
      by.set(l.line, slot);
    }
    const valid = [...by.entries()].filter(([, v]) => v.over?.length && v.under?.length).sort((a, b) => a[0] - b[0]);
    if (!valid.length) return;
    // keep the lines closest to an even book
    const chosen = [...valid]
      .sort((a, b) => Math.abs(median(a[1].over!) - median(a[1].under!)) - Math.abs(median(b[1].over!) - median(b[1].under!)))
      .slice(0, max)
      .sort((a, b) => a[0] - b[0]);
    const outcomes: OutcomeIn[] = [];
    for (const [line, v] of chosen) {
      outcomes.push({ code: `over_${line}`, name: `Over ${line}`, price: price(v.over!), point: line });
      outcomes.push({ code: `under_${line}`, name: `Under ${line}`, price: price(v.under!), point: line });
    }
    out.push({ key, outcomes });
  };

  three('h2h');
  const dc = pool.double_chance;
  if (dc) {
    const names = { home_draw: `${home} or Draw`, home_away: `${home} or ${away}`, draw_away: `Draw or ${away}` } as const;
    const o: OutcomeIn[] = [];
    for (const [label, prices] of Object.entries(dc)) {
      const c = dcCode(label);
      if (c && !o.some((x) => x.code === c)) o.push({ code: c, name: names[c], price: price(prices) });
    }
    if (o.length >= 2) out.push({ key: 'double_chance', outcomes: o });
  }
  lines('totals', 6, false);
  const bt = pool.btts;
  if (bt?.Yes && bt?.No) out.push({ key: 'btts', outcomes: [{ code: 'yes', name: 'Yes', price: price(bt.Yes) }, { code: 'no', name: 'No', price: price(bt.No) }] });
  three('ht_h2h');
  lines('ht_totals', 3, false);
  const cs = pool.correct_score;
  if (cs) {
    const o: OutcomeIn[] = [];
    for (const [label, prices] of Object.entries(cs)) {
      const sc = parseScore(label);
      if (!sc || sc[0] > 6 || sc[1] > 6) continue;
      o.push({ code: `cs_${sc[0]}_${sc[1]}`, name: `${sc[0]}-${sc[1]}`, price: price(prices) });
    }
    if (o.length >= 6) out.push({ key: 'correct_score', outcomes: o });
  }
  lines('corners_totals', 4, true);
  three('corners_h2h');
  return out;
}

async function saveMarkets(evId: string, markets: BuiltMarket[]) {
  for (const m of markets) await saveMarket(evId, m.key, m.outcomes, false);
}

/** "UEFA Nations League · League A" etc. from the fixture's round ("League A - 3"). */
function fixtureTitle(f: AfFixture, base: string) {
  const m = f.league.round?.match(/^League ([A-D])\b/i);
  return m ? `${base} · League ${m[1].toUpperCase()}` : base;
}

async function upsertFixture(f: AfFixture, baseTitle: string, sport: string) {
  const id = eventId(f.fixture.id);
  const sportTitle = fixtureTitle(f, baseTitle);
  const st = f.fixture.status.short;
  const status = DONE.has(st) ? 'COMPLETED' : LIVE.has(st) ? 'LIVE' : DEAD.has(st) ? 'CANCELLED' : 'UPCOMING';
  const existing = await prisma.event.findUnique({ where: { id }, select: { status: true } });
  // never move an event backwards once it is settled
  if (existing && (existing.status === 'COMPLETED' || existing.status === 'CANCELLED')) return existing.status;
  await prisma.event.upsert({
    where: { id },
    create: {
      id, sportKey: sport, sportTitle, commenceTime: new Date(f.fixture.date),
      homeTeam: f.teams.home.name, awayTeam: f.teams.away.name, homeLogo: f.teams.home.logo, awayLogo: f.teams.away.logo,
      status: status === 'COMPLETED' || status === 'CANCELLED' ? 'LIVE' : status, // results are applied by the scores job
      homeScore: f.goals.home, awayScore: f.goals.away,
    },
    update: {
      sportTitle,
      commenceTime: new Date(f.fixture.date), homeTeam: f.teams.home.name, awayTeam: f.teams.away.name,
      homeLogo: f.teams.home.logo, awayLogo: f.teams.away.logo,
      ...(status === 'UPCOMING' || status === 'LIVE' ? { status } : {}),
    },
  });
  return status;
}

export async function afSyncOdds() {
  const sports = await prisma.sport.findMany({ where: { provider: 'apifootball', enabled: true, active: true, season: { not: null } } });
  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = new Date(Date.now() + config.afDaysAhead * 86400_000).toISOString().slice(0, 10);
  let priced = 0;

  for (const s of sports) {
    try {
      // 1) fixtures in the window
      const fx = await af<AfFixture>('/fixtures', { league: s.key.replace('soccer_af_', ''), season: s.season!, from, to, timezone: 'UTC' });
      const upcoming = new Map<number, AfFixture>();
      for (const f of fx.response) {
        const st = await upsertFixture(f, s.title, s.key);
        if (st === 'UPCOMING' && new Date(f.fixture.date) > new Date()) upcoming.set(f.fixture.id, f);
      }
      if (!upcoming.size) continue;

      // 2) odds for the league (paged, 10 per page)
      let page = 1;
      let total = 1;
      do {
        const od = await af<AfOdds>('/odds', { league: s.key.replace('soccer_af_', ''), season: s.season!, page });
        total = od.paging?.total ?? 1;
        for (const o of od.response) {
          const f = upcoming.get(o.fixture.id);
          if (!f) continue;
          const markets = buildMarkets(o, f.teams.home.name, f.teams.away.name);
          if (!markets.length) continue;
          await saveMarkets(eventId(o.fixture.id), markets);
          await prisma.event.update({ where: { id: eventId(o.fixture.id) }, data: { lastOddsUpdate: new Date() } });
          priced++;
        }
        page++;
      } while (page <= total && page <= 10);
    } catch (e) {
      console.error('[api-football] odds', s.key, (e as Error).message);
    }
  }
  return priced;
}

/* ------------------------------ Live + results ---------------------------- */

export async function afSyncScores() {
  const now = new Date();
  // kick-off passed -> live + suspend markets (pre-match book)
  await prisma.event.updateMany({ where: { id: { startsWith: 'af_' }, status: 'UPCOMING', commenceTime: { lte: now } }, data: { status: 'LIVE' } });
  // pre-match prices lock at kick-off until live prices arrive (the live engine owns them after that)
  await prisma.market.updateMany({ where: { event: { status: 'LIVE', liveUpdatedAt: null }, suspended: false }, data: { suspended: true } });
  invalidateMarkets();

  // 1 request: everything currently in play in our leagues
  const sports = await prisma.sport.findMany({ where: { provider: 'apifootball', enabled: true } });
  if (sports.length) {
    try {
      const live = await af<AfFixture>('/fixtures', { live: sports.map((s) => s.key.replace('soccer_af_', '')).join('-'), timezone: 'UTC' });
      for (const f of live.response) {
        const s = sports.find((x) => x.key === sportKey(f.league.id));
        if (s) await upsertFixture(f, s.title, s.key);
      }
    } catch (e) {
      console.error('[api-football] live', (e as Error).message);
    }
  }

  const watch = await prisma.event.findMany({
    where: { id: { startsWith: 'af_' }, status: 'LIVE', commenceTime: { gte: new Date(Date.now() - 7 * 86400_000) } },
    select: { id: true, commenceTime: true },
  });
  let settled = 0;
  for (let i = 0; i < watch.length; i += 20) {
    const chunk = watch.slice(i, i + 20);
    let fx: AfEnvelope<AfFixture>;
    try {
      fx = await af<AfFixture>('/fixtures', { ids: chunk.map((e) => e.id.slice(3)).join('-'), timezone: 'UTC' });
    } catch (e) {
      console.error('[api-football] scores', (e as Error).message);
      continue;
    }
    for (const f of fx.response) {
      const id = eventId(f.fixture.id);
      const st = f.fixture.status.short;
      if (DONE.has(st)) {
        // Settle on the 90-minute result (incl. stoppage time), standard sportsbook rule
        const hs = f.score.fulltime.home ?? f.goals.home;
        const as = f.score.fulltime.away ?? f.goals.away;
        if (hs == null || as == null) continue;
        const corners = cornersOf(f);
        await prisma.event.update({
          where: { id },
          data: {
            status: 'COMPLETED', homeScore: hs, awayScore: as, lastScoreSync: now,
            htHome: f.score.halftime?.home ?? null, htAway: f.score.halftime?.away ?? null,
            ...(corners ? { cornersHome: corners[0], cornersAway: corners[1] } : {}),
          },
        });
        settled += await settleEvent(id);
        forgetEvent(id);
      } else if (DEAD.has(st)) {
        settled += await voidEvent(id);
      } else if (st === 'PST' || st === 'TBD' || st === 'NS') {
        const kickoff = new Date(f.fixture.date);
        if (kickoff > now) {
          // rescheduled: reopen as upcoming with the new time
          await prisma.event.update({ where: { id }, data: { status: 'UPCOMING', commenceTime: kickoff, lastScoreSync: now } });
          await prisma.market.updateMany({ where: { eventId: id }, data: { suspended: false } });
          invalidateMarkets([id]);
        } else if (st === 'PST' && now.getTime() - kickoff.getTime() > 48 * 3600_000) {
          settled += await voidEvent(id); // postponed with no new date for 48h
        }
      } else {
        const corners = cornersOf(f);
        const ht = f.score.halftime;
        if (corners || (ht && ht.home != null)) {
          await prisma.event.update({
            where: { id },
            data: {
              ...(corners ? { cornersHome: corners[0], cornersAway: corners[1] } : {}),
              ...(ht && ht.home != null && st !== '1H' ? { htHome: ht.home, htAway: ht.away } : {}),
            },
          });
        }
        // while live odds are flowing, the live engine owns the score (it needs it for goal detection)
        const ev = await prisma.event.findUnique({ where: { id }, select: { lastScoreSync: true } });
        const liveJobFresh = config.liveBetting && ev?.lastScoreSync && now.getTime() - ev.lastScoreSync.getTime() < 60_000;
        if (!liveJobFresh) {
          await prisma.event.update({
            where: { id },
            data: { homeScore: f.goals.home, awayScore: f.goals.away, liveElapsed: f.fixture.status.elapsed, lastScoreSync: now },
          });
          if (f.goals.home != null && f.goals.away != null) settled += await applyEarlyPayout(id, f.goals.home, f.goals.away);
        }
      }
    }
  }
  return settled;
}
