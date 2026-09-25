import { useEffect, useMemo, useState } from 'react';
import { LuRadio, LuSearch } from 'react-icons/lu';
import { api } from '../lib/api';
import { mergeEvents, useLiveUpdates } from '../lib/live';
import { kickoff, leagueParts, dateTime } from '../lib/format';
import { Link, useRouter } from '../lib/router';
import type { Sport, SportEvent } from '../lib/types';
import { EventCard } from '../components/EventCard';
import { BackBar } from '../components/Layout';
import { Empty, OddsButton, Skeleton, SportIcon, TeamBadge } from '../components/ui';

function useEvents(qs: string, every = 60_000, liveList = false) {
  const [events, setEvents] = useState<SportEvent[] | null>(null);
  // instant pushes from the server; polling below is only a safety net
  useLiveUpdates((incoming) => setEvents((cur) => mergeEvents(cur, incoming, liveList)));
  useEffect(() => {
    setEvents(null);
    let alive = true;
    const load = () =>
      api<{ events: SportEvent[] }>(`/events?${qs}`)
        .then((d) => alive && setEvents(d.events))
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
  return (
    <div className="page">
      <BackBar title="Live" />
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

export function EventPage({ id }: { id: string }) {
  const [ev, setEv] = useState<SportEvent | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ event: SportEvent }>(`/events/${id}`)
        .then((d) => alive && setEv(d.event))
        .catch(() => alive && setEv(null));
    load();
    return () => {
      alive = false;
    };
  }, [id]);
  // instant pushes for this match
  useLiveUpdates((incoming) => {
    const mine = incoming.find((e) => e.id === id);
    if (mine) setEv(mine);
  });
  // safety-net refresh
  const isLive = ev?.status === 'LIVE';
  useEffect(() => {
    const t = setInterval(() => {
      api<{ event: SportEvent }>(`/events/${id}`).then((d) => setEv(d.event)).catch(() => {});
    }, isLive ? 15_000 : 30_000);
    return () => clearInterval(t);
  }, [id, isLive]);

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
  const ORDER = ['h2h', 'double_chance', 'totals', 'btts'];
  const markets = [...ev.markets].sort((a, b) => (ORDER.indexOf(a.key) + 99) % 99 - (ORDER.indexOf(b.key) + 99) % 99);
  const title = (key: string, point?: number | null) =>
    key === 'h2h' ? (isSoccer ? 'Full time result (1X2)' : 'Match winner')
    : key === 'totals' ? `Total ${isSoccer ? 'goals' : 'points'} — ${point ?? ''}`
    : key === 'btts' ? 'Both teams to score'
    : key === 'double_chance' ? 'Double chance'
    : key;
  const label = (key: string, code: string, name: string) =>
    key === 'h2h' ? (code === 'home' ? `1 · ${name}` : code === 'away' ? `2 · ${name}` : 'X · Draw') : name;

  return (
    <div className="page">
      <BackBar title={ev.sportTitle} />
      <section className="match-hero">
        <div className="match-league">
          <SportIcon sportKey={ev.sportKey} size={15} /> {groupTitle} · {ev.sportTitle}
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

      {!open && <div className="notice">Betting is closed for this match. Open bets settle automatically when the final result is in.</div>}
      {ev.status === 'LIVE' && ev.lockReason && ev.markets.length > 0 && (
        <div className={`live-banner lb-${ev.lockReason}`}>
          {ev.lockReason === 'goal' ? '⚽ Goal! Markets reopen in a few seconds' : ev.lockReason === 'blocked' ? 'Markets suspended — dangerous attack, VAR or stoppage' : 'Waiting for live prices…'}
        </div>
      )}

      {open &&
        markets.map((m) => (
          <section key={m.id} className="market">
            <h3>{title(m.key, m.outcomes[0]?.point)}</h3>
            <div className={`odds-row${m.outcomes.length === 2 ? ' two' : ''}`}>
              {m.outcomes.map((o) => (
                <OddsButton key={o.id} ev={ev} marketKey={m.key} o={o} label={label(m.key, o.code, o.name)} locked={m.suspended} />
              ))}
            </div>
          </section>
        ))}
      {open && markets.length === 0 && (ev.status === 'LIVE'
        ? <Empty title="No in-play betting for this match" text="Our data provider doesn't offer live odds for this match. The live score keeps updating here." />
        : <Empty title="Odds open soon" text="Bookmakers publish prices about two weeks before kick-off. This page updates automatically." />)}
    </div>
  );
}
