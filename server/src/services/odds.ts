import { config } from '../config';
import { D, prisma } from '../lib/prisma';
import { settleEvent } from './settlement';

interface ApiSport { key: string; group: string; title: string; description?: string; active: boolean; has_outrights: boolean }
interface ApiOutcome { name: string; price: number; point?: number }
interface ApiMarket { key: string; outcomes: ApiOutcome[] }
interface ApiEvent {
  id: string; sport_key: string; sport_title: string; commence_time: string; home_team: string; away_team: string;
  bookmakers?: { key: string; markets: ApiMarket[] }[];
}
interface ApiScore {
  id: string; sport_key: string; commence_time: string; completed: boolean; home_team: string; away_team: string;
  scores: { name: string; score: string }[] | null;
}

async function api<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!config.oddsApiKey) throw new Error('ODDS_API_KEY not set');
  const qs = new URLSearchParams({ apiKey: config.oddsApiKey, ...params });
  const res = await fetch(`${config.oddsApiBase}${path}?${qs}`);
  const remaining = res.headers.get('x-requests-remaining');
  if (remaining) {
    await prisma.setting.upsert({ where: { key: 'odds_quota_remaining' }, create: { key: 'odds_quota_remaining', value: remaining }, update: { value: remaining } });
  }
  if (!res.ok) throw new Error(`Odds API ${path} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Consensus price across bookmakers with the house margin applied. */
const price = (xs: number[]) => Math.max(1.01, Math.round(median(xs) * (1 - config.houseMargin) * 100) / 100);

export async function syncSports() {
  const sports = await api<ApiSport[]>('/sports', { all: 'false' });
  for (const s of sports) {
    if (s.has_outrights) continue; // outrights (futures) not supported in this version
    await prisma.sport.upsert({
      where: { key: s.key },
      create: { key: s.key, group: s.group, title: s.title, description: s.description, active: s.active, enabled: config.oddsSports.includes(s.key) },
      update: { group: s.group, title: s.title, description: s.description, active: s.active },
    });
  }
  // sports that disappeared from the feed are out of season
  await prisma.sport.updateMany({ where: { key: { notIn: sports.map((s) => s.key) } }, data: { active: false } });
  return sports.length;
}

function buildMarkets(ev: ApiEvent) {
  const books = ev.bookmakers ?? [];
  const out: { key: string; outcomes: { code: string; name: string; price: number; point?: number }[] }[] = [];

  // 1X2 / moneyline
  const h2h: Record<string, number[]> = {};
  for (const b of books) for (const m of b.markets) if (m.key === 'h2h') for (const o of m.outcomes) (h2h[o.name] ??= []).push(o.price);
  if (h2h[ev.home_team] && h2h[ev.away_team]) {
    const outcomes = [
      { code: 'home', name: ev.home_team, price: price(h2h[ev.home_team]) },
      ...(h2h['Draw'] ? [{ code: 'draw', name: 'Draw', price: price(h2h['Draw']) }] : []),
      { code: 'away', name: ev.away_team, price: price(h2h[ev.away_team]) },
    ];
    out.push({ key: 'h2h', outcomes });
  }

  // Totals: use the line most bookmakers offer (main line)
  const byPoint: Record<string, { over: number[]; under: number[] }> = {};
  for (const b of books)
    for (const m of b.markets)
      if (m.key === 'totals')
        for (const o of m.outcomes) {
          if (o.point == null) continue;
          const slot = (byPoint[o.point] ??= { over: [], under: [] });
          (o.name === 'Over' ? slot.over : slot.under).push(o.price);
        }
  const main = Object.entries(byPoint)
    .filter(([, v]) => v.over.length && v.under.length)
    .sort((a, b) => b[1].over.length - a[1].over.length)[0];
  if (main) {
    const point = Number(main[0]);
    out.push({
      key: 'totals',
      outcomes: [
        { code: 'over', name: `Over ${point}`, price: price(main[1].over), point },
        { code: 'under', name: `Under ${point}`, price: price(main[1].under), point },
      ],
    });
  }
  return out;
}

export async function syncOdds() {
  const sports = await prisma.sport.findMany({ where: { enabled: true, active: true } });
  let count = 0;
  for (const sport of sports) {
    let events: ApiEvent[];
    try {
      events = await api<ApiEvent[]>(`/sports/${sport.key}/odds`, {
        regions: config.oddsRegions,
        markets: 'h2h,totals',
        oddsFormat: 'decimal',
      });
    } catch (e) {
      console.error('[odds]', sport.key, (e as Error).message);
      continue;
    }
    for (const ev of events) {
      const commence = new Date(ev.commence_time);
      const started = commence <= new Date();
      await prisma.event.upsert({
        where: { id: ev.id },
        create: {
          id: ev.id, sportKey: sport.key, sportTitle: ev.sport_title, commenceTime: commence,
          homeTeam: ev.home_team, awayTeam: ev.away_team, status: started ? 'LIVE' : 'UPCOMING', lastOddsUpdate: new Date(),
        },
        update: { commenceTime: commence, homeTeam: ev.home_team, awayTeam: ev.away_team, lastOddsUpdate: new Date() },
      });
      if (started) continue; // pre-match only: never reprice started events

      for (const m of buildMarkets(ev)) {
        const market = await prisma.market.upsert({
          where: { eventId_key: { eventId: ev.id, key: m.key } },
          create: { eventId: ev.id, key: m.key },
          update: { suspended: false },
        });
        for (const o of m.outcomes) {
          await prisma.outcome.upsert({
            where: { marketId_code: { marketId: market.id, code: o.code } },
            create: { marketId: market.id, code: o.code, name: o.name, price: D(o.price), point: o.point != null ? D(o.point) : null },
            update: { name: o.name, price: D(o.price), point: o.point != null ? D(o.point) : null, active: true },
          });
        }
        await prisma.outcome.updateMany({
          where: { marketId: market.id, code: { notIn: m.outcomes.map((o) => o.code) } },
          data: { active: false },
        });
      }
      count++;
    }
  }
  return count;
}

/** Pull scores for sports with events in play/just finished, update statuses, and settle bets. */
export async function syncScores() {
  const now = new Date();
  await prisma.event.updateMany({ where: { status: 'UPCOMING', commenceTime: { lte: now } }, data: { status: 'LIVE' } });
  await prisma.market.updateMany({ where: { event: { status: 'LIVE' }, suspended: false }, data: { suspended: true } });

  const liveSports = await prisma.event.groupBy({
    by: ['sportKey'],
    where: { status: 'LIVE', commenceTime: { gte: new Date(Date.now() - 3 * 86400_000) } },
  });
  let settled = 0;
  for (const { sportKey } of liveSports) {
    let scores: ApiScore[];
    try {
      scores = await api<ApiScore[]>(`/sports/${sportKey}/scores`, { daysFrom: '3', dateFormat: 'iso' });
    } catch (e) {
      console.error('[scores]', sportKey, (e as Error).message);
      continue;
    }
    for (const s of scores) {
      const ev = await prisma.event.findUnique({ where: { id: s.id } });
      if (!ev || ev.status === 'COMPLETED' || ev.status === 'CANCELLED') continue;
      const home = s.scores?.find((x) => x.name === s.home_team)?.score;
      const away = s.scores?.find((x) => x.name === s.away_team)?.score;
      const hs = home != null ? parseInt(home, 10) : null;
      const as = away != null ? parseInt(away, 10) : null;
      await prisma.event.update({
        where: { id: s.id },
        data: {
          homeScore: Number.isFinite(hs) ? hs : null,
          awayScore: Number.isFinite(as) ? as : null,
          status: s.completed ? 'COMPLETED' : new Date(s.commence_time) <= now ? 'LIVE' : 'UPCOMING',
          lastScoreSync: new Date(),
        },
      });
      if (s.completed && hs != null && as != null && Number.isFinite(hs) && Number.isFinite(as)) {
        settled += await settleEvent(s.id);
      }
    }
  }
  return settled;
}
