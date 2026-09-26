import { FavStar } from '../components/EventCard';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LuChevronDown, LuRadio, LuSearch, LuVolume2, LuVolumeX } from 'react-icons/lu';
import { api } from '../lib/api';
import { mergeEvents, useLiveUpdates } from '../lib/live';
import { kickoff, leagueParts, dateTime } from '../lib/format';
import { Link, useRouter } from '../lib/router';
import type { Sport, SportEvent } from '../lib/types';
import { EventCard } from '../components/EventCard';
import { BackBar } from '../components/Layout';
import { Empty, OddsButton, Skeleton, SportIcon, TeamBadge } from '../components/ui';
import { MatchTracker } from '../components/MatchTracker';
import { BetBuilder } from '../components/BetBuilder';
import { useMuted } from '../casino/sound';
import { primeScore, watchEvent } from '../lib/goals';

function useEvents(qs: string, every = 60_000, liveList = false) {
  const [events, setEvents] = useState<SportEvent[] | null>(null);
  // instant pushes from the server; polling below is only a safety net
  useLiveUpdates((incoming) => setEvents((cur) => mergeEvents(cur, incoming, liveList)));
  useEffect(() => {
    setEvents(null);
    let alive = true;
    const load = () =>
      api<{ events: SportEvent[] }>(`/events?${qs}`)
        .then((d) => {
          d.events.forEach(primeScore);
          if (alive) setEvents(d.events);
        })
        .catch(() => alive && setEvents([]));
    load();
    const t = setInterval(load, every);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [qs, every]);
  return events;
}

/** Events grouped by league with dates */
function EventList({ events }: { events: SportEvent[] }) {
  const byLeague = useMemo(() => {
    const m = new Map<string, SportEvent[]>();
    for (const e of events) (m.get(e.sportTitle) ?? m.set(e.sportTitle, []).get(e.sportTitle)!).push(e);
    return [...m.entries()];
  }, [events]);
  return (
    <>
      {byLeague.map(([league, list]) => (
        <section key={league} className="league-block">
          <h3 className="league-title">
            <SportIcon sportKey={list[0].sportKey} size={16} />
            {league}
            <em>{list.length}</em>
          </h3>
          <div className="grid-events">
            {list.map((e) => (
              <EventCard key={e.id} ev={e} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export function SportPage({ sportKey, group, sports }: { sportKey?: string; group?: string; sports: Sport[] }) {
  const qs = new URLSearchParams({ status: 'upcoming', limit: '120', ...(sportKey ? { sport: sportKey } : {}), ...(group ? { group } : {}) }).toString();
  const events = useEvents(qs);
  const title = sportKey ? sports.find((s) => s.key === sportKey)?.title ?? 'Matches' : group ?? 'Matches';
  const leagues = group ? sports.filter((s) => s.group === group) : [];
  return (
    <div className="page">
      <BackBar title={title} />
      {leagues.length > 1 && (
        <div className="chips">
          {leagues.map((l) => (
            <Link key={l.key} to={`/sport/${l.key}`} className="chip">
              {l.title} <em>{l.count}</em>
            </Link>
          ))}
        </div>
      )}
      {events === null ? (
        <div className="grid-events">
          <Skeleton h={170} count={6} />
        </div>
      ) : events.length === 0 ? (
        <Empty title="No upcoming matches" text="This competition has no open markets right now." />
      ) : (
        <EventList events={events} />
      )}
    </div>
  );
}

export function LivePage() {
  const raw = useEvents('status=live&limit=120', 20_000, true);
  // matches you can bet on first, score-only matches after
  const events = raw && [...raw].sort((a, b) => Number(b.markets.length > 0) - Number(a.markets.length > 0));
  const [muted, setMuted] = useMuted();
  return (
    <div className="page">
      <BackBar title="Live" />
      <div className="live-tools">
        <span>
          <i className="live-dot" /> {raw ? raw.length : 0} matches in play
        </span>
        <button type="button" className={`btn btn-ghost btn-sm ${muted ? 'off' : ''}`} onClick={() => setMuted(!muted)}>
          {muted ? <LuVolumeX size={15} /> : <LuVolume2 size={15} />} Goal sounds {muted ? 'off' : 'on'}
        </button>
      </div>
      {events === null ? (
        <div className="grid-events">
          <Skeleton h={170} count={4} />
        </div>
      ) : events.length === 0 ? (
        <Empty icon={<LuRadio size={34} />} title="No live matches right now" text="Live scores appear here as soon as games kick off." />
      ) : (
        <EventList events={events} />
      )}
    </div>
  );
}

export function SearchPage() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const [events, setEvents] = useState<SportEvent[] | null>([]);
  useEffect(() => {
    if (debounced.length < 2) return setEvents([]);
    setEvents(null);
    api<{ events: SportEvent[] }>(`/events?status=all&limit=60&q=${encodeURIComponent(debounced)}`)
      .then((d) => setEvents(d.events))
      .catch(() => setEvents([]));
  }, [debounced]);
  return (
    <div className="page">
      <BackBar title="Search" />
      <label className="search-box">
        <LuSearch size={18} />
        <input autoFocus placeholder="Search teams or leagues" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {events === null ? (
        <div className="grid-events">
          <Skeleton h={170} count={4} />
        </div>
      ) : events.length === 0 ? (
        debounced.length >= 2 && <Empty title="No results" text={`Nothing matches “${debounced}”.`} />
      ) : (
        <div className="grid-events">
          {events.map((e) => (
            <EventCard key={e.id} ev={e} />
          ))}
        </div>
      )}
    </div>
  );
}

type TabId = 'popular' | 'goals' | 'half' | 'corners' | 'score' | 'builder' | 'all';
const TABS: { id: TabId; label: string; keys: string[] }[] = [
  { id: 'popular', label: 'Popular', keys: ['h2h', 'double_chance', 'totals', 'btts'] },
  { id: 'goals', label: 'Goals', keys: ['totals', 'btts'] },
  { id: 'half', label: '1st Half', keys: ['ht_h2h', 'ht_totals'] },
  { id: 'score', label: 'Correct Score', keys: ['correct_score'] },
  { id: 'corners', label: 'Corners', keys: ['corners_totals', 'corners_h2h'] },
  { id: 'builder', label: 'Bet Builder', keys: [] },
  { id: 'all', label: 'All', keys: ['h2h', 'double_chance', 'totals', 'btts', 'ht_h2h', 'ht_totals', 'correct_score', 'corners_totals', 'corners_h2h'] },
];

function MarketBlock({ ev, m, title, badge }: { ev: SportEvent; m: SportEvent['markets'][number]; title: string; badge?: ReactNode }) {
  const label = (code: string, name: string) =>
    m.key === 'h2h' || m.key === 'ht_h2h' || m.key === 'corners_h2h' ? (code === 'home' ? `1 · ${name}` : code === 'away' ? `2 · ${name}` : 'X · Draw') : name;
  const lines = m.outcomes.some((o) => o.point != null);
  const [collapsed, setCollapsed] = useState(false);
  let body: ReactNode;
  if (m.key === 'correct_score') {
    const cs = (o: (typeof m.outcomes)[number]) => o.code.match(/^cs_(\d+)_(\d+)$/);
    const col = (f: (h: number, a: number) => boolean) =>
      m.outcomes.filter((o) => {
        const x = cs(o);
        return x && f(Number(x[1]), Number(x[2]));
      });
    body = (
      <div className="cs-grid">
        {([
          [ev.homeTeam, col((h, a) => h > a)],
          ['Draw', col((h, a) => h === a)],
          [ev.awayTeam, col((h, a) => h < a)],
        ] as const).map(([t, list]) => (
          <div key={t} className="cs-col">
            <span className="cs-head ellipsis">{t}</span>
            {list.map((o) => (
              <OddsButton key={o.id} ev={ev} marketKey={m.key} o={o} label={o.name} locked={m.suspended} />
            ))}
          </div>
        ))}
      </div>
    );
  } else if (lines) {
    const pts = [...new Set(m.outcomes.map((o) => o.point))];
    body = (
      <div className="line-table">
        {pts.map((p) => (
          <div key={String(p)} className="odds-row two">
            {m.outcomes
              .filter((o) => o.point === p)
              .map((o) => (
                <OddsButton key={o.id} ev={ev} marketKey={m.key} o={o} label={o.name} locked={m.suspended} />
              ))}
          </div>
        ))}
      </div>
    );
  } else {
    body = (
      <div className={`odds-row${m.outcomes.length === 2 ? ' two' : ''}`}>
        {m.outcomes.map((o) => (
          <OddsButton key={o.id} ev={ev} marketKey={m.key} o={o} label={label(o.code, o.name)} locked={m.suspended} />
        ))}
      </div>
    );
  }
  return (
    <section className={`market ${collapsed ? 'collapsed' : ''}`}>
      <h3 onClick={() => setCollapsed((c) => !c)}>
        <span>{title}</span>
        {badge}
        <LuChevronDown size={16} className="mk-chev" />
      </h3>
      {!collapsed && body}
    </section>
  );
}

export function EventPage({ id }: { id: string }) {
  const [ev, setEv] = useState<SportEvent | null | undefined>(undefined);
  const [tab, setTab] = useState<TabId>('popular');
  const [muted, setMuted] = useMuted();
  const refetchAt = useRef(0);
  const refetch = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(
    () =>
      api<{ event: SportEvent }>(`/events/${id}`)
        .then((d) => {
          primeScore(d.event);
          setEv(d.event);
        })
        .catch(() => setEv((x) => (x === undefined ? null : x))),
    [id]
  );
  useEffect(() => {
    setEv(undefined);
    load();
    return watchEvent(id);
  }, [id, load]);
  // instant pushes carry the score/lock state + 1X2; pull the full book right after (throttled)
  useLiveUpdates((incoming) => {
    const mine = incoming.find((e) => e.id === id);
    if (!mine) return;
    setEv((cur) => (cur ? { ...cur, ...mine, markets: cur.markets.map((m) => (m.key === 'h2h' ? mine.markets.find((x) => x.key === 'h2h') ?? m : { ...m, suspended: m.suspended || mine.bettingOpen === false })) } : cur));
    if (refetch.current) return;
    const wait = Math.max(300, 2500 - (Date.now() - refetchAt.current));
    refetch.current = setTimeout(() => {
      refetch.current = null;
      refetchAt.current = Date.now();
      load();
    }, wait);
  });
  useEffect(() => () => void (refetch.current && clearTimeout(refetch.current)), []);
  // safety-net refresh
  const isLive = ev?.status === 'LIVE';
  useEffect(() => {
    const t = setInterval(load, isLive ? 15_000 : 30_000);
    return () => clearInterval(t);
  }, [load, isLive]);

  if (ev === undefined)
    return (
      <div className="page">
        <Skeleton h={220} count={1} />
        <Skeleton h={120} count={2} />
      </div>
    );
  if (ev === null)
    return (
      <div className="page">
        <Empty title="Match not found" action={<Link to="/" className="btn btn-primary">Back to lobby</Link>} />
      </div>
    );

  const { groupTitle } = leagueParts(ev.sportKey, ev.sportTitle);
  const open = ev.status === 'UPCOMING' || ev.status === 'LIVE';
  const isSoccer = ev.sportKey.startsWith('soccer');
  const has = (k: string) => ev.markets.some((m) => m.key === k);
  const tabs = TABS.filter((t) => (t.id === 'builder' ? ev.status === 'UPCOMING' && has('h2h') && isSoccer : t.keys.some(has)));
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];
  const title = (key: string, point?: number | null) =>
    key === 'h2h' ? (isSoccer ? 'Full time result (1X2)' : 'Match winner')
    : key === 'totals' ? `Total ${isSoccer ? 'goals' : 'points'}`
    : key === 'btts' ? 'Both teams to score'
    : key === 'double_chance' ? 'Double chance'
    : key === 'ht_h2h' ? '1st half result'
    : key === 'ht_totals' ? '1st half goals'
    : key === 'correct_score' ? 'Correct score'
    : key === 'corners_totals' ? 'Total corners'
    : key === 'corners_h2h' ? 'Most corners (1X2)'
    : `${key}${point != null ? ` ${point}` : ''}`;
  const shown = active && active.id !== 'builder' ? active.keys.map((k) => ev.markets.find((m) => m.key === k)).filter((m): m is SportEvent['markets'][number] => !!m) : [];
  const twoUp = isSoccer && ev.status === 'UPCOMING' && (
    <span className="twoup" title="Pre-match 1X2 bets are paid out as winners as soon as your team goes 2 goals ahead">
      2UP · Early payout
    </span>
  );

  return (
    <div className="page">
      <BackBar title={ev.sportTitle} />
      <section className="match-hero">
        <div className="match-league">
          <SportIcon sportKey={ev.sportKey} size={15} /> {groupTitle} · {ev.sportTitle}
          <FavStar id={ev.id} size={17} />
          <button type="button" className={`icon-btn sound-btn sm ${muted ? 'off' : ''}`} onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute goal sounds' : 'Mute goal sounds'}>
            {muted ? <LuVolumeX size={16} /> : <LuVolume2 size={16} />}
          </button>
        </div>
        <div className="match-teams">
          <div className="match-team">
            <TeamBadge name={ev.homeTeam} logo={ev.homeLogo} size={64} />
            <b>{ev.homeTeam}</b>
            <small>Home</small>
          </div>
          <div className="match-center">
            {ev.status === 'LIVE' || ev.status === 'COMPLETED' ? (
              <>
                <span className="score-big">
                  {ev.homeScore ?? 0} : {ev.awayScore ?? 0}
                </span>
                <span className={ev.status === 'LIVE' ? 'live-pill' : 'ft-pill'}>
                  {ev.status === 'LIVE' ? (ev.liveMinute != null ? `Live ${ev.liveMinute}'` : 'Live') : 'Full time'}
                </span>
                {ev.htHome != null && ev.htAway != null && (
                  <small className="ht-score">
                    HT {ev.htHome}-{ev.htAway}
                    {ev.cornersHome != null ? ` · Corners ${ev.cornersHome}-${ev.cornersAway}` : ''}
                  </small>
                )}
              </>
            ) : (
              <>
                <span className="match-time">{kickoff(ev.commenceTime)}</span>
                <small>{dateTime(ev.commenceTime)}</small>
              </>
            )}
          </div>
          <div className="match-team">
            <TeamBadge name={ev.awayTeam} logo={ev.awayLogo} size={64} />
            <b>{ev.awayTeam}</b>
            <small>Away</small>
          </div>
        </div>
      </section>

      {isSoccer && ev.id.startsWith('af_') && <MatchTracker ev={ev} />}

      {!open && <div className="notice">Betting is closed for this match. Open bets settle automatically when the final result is in.</div>}
      {ev.status === 'LIVE' && ev.lockReason && ev.markets.length > 0 && (
        <div className={`live-banner lb-${ev.lockReason}`}>
          {ev.lockReason === 'goal' ? '⚽ Goal! Markets reopen in a few seconds' : ev.lockReason === 'blocked' ? 'Markets suspended — dangerous attack, VAR or stoppage' : 'Waiting for live prices…'}
        </div>
      )}

      {open && tabs.length > 0 && (
        <div className="mk-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" className={active?.id === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {open && active?.id === 'builder' && <BetBuilder ev={ev} />}
      {open &&
        shown.map((m) => <MarketBlock key={m.id} ev={ev} m={m} title={title(m.key)} badge={m.key === 'h2h' ? twoUp : undefined} />)}
      {open && ev.markets.length === 0 && (ev.status === 'LIVE'
        ? <Empty title="No in-play betting for this match" text="Our data provider doesn't offer live odds for this match. The live score keeps updating here." />
        : <Empty title="Odds open soon" text="Bookmakers publish prices about two weeks before kick-off. This page updates automatically." />)}
    </div>
  );
}
