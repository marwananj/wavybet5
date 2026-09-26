import { useEffect, useRef, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuFlame, LuUsers } from 'react-icons/lu';
import { api } from '../lib/api';
import { marketLabel, odds as fmtOdds } from '../lib/format';
import { Link } from '../lib/router';
import { useSlip } from '../lib/state';
import type { Outcome, SportEvent } from '../lib/types';

interface TrendPick {
  outcomeId: string;
  eventId: string;
  eventLabel: string;
  homeTeam: string;
  awayTeam: string;
  sportTitle: string;
  commenceTime: string;
  live: boolean;
  marketKey: string;
  outcomeName: string;
  odds: number;
  bets: number;
}

/** "Trending now" — the selections most players are backing in the last 24h */
export function Trending() {
  const slip = useSlip();
  const [picks, setPicks] = useState<TrendPick[] | null>(null);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const load = () => api<{ picks: TrendPick[] }>('/trending').then((d) => setPicks(d.picks)).catch(() => setPicks([]));
    load();
    const t = setInterval(load, 90_000);
    return () => clearInterval(t);
  }, []);
  if (!picks || picks.length === 0) return null;
  const max = Math.max(...picks.map((p) => p.bets));
  const add = (p: TrendPick) =>
    slip.toggle(
      { id: p.eventId, homeTeam: p.homeTeam, awayTeam: p.awayTeam, sportTitle: p.sportTitle, status: p.live ? 'LIVE' : 'UPCOMING' } as unknown as SportEvent,
      p.marketKey,
      { id: p.outcomeId, name: p.outcomeName, price: p.odds, code: '', point: null } as Outcome
    );
  const scroll = (d: number) => row.current?.scrollBy({ left: d * row.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <section className="trending">
      <div className="section-head">
        <h3>
          <LuFlame size={18} className="flame" /> Trending bets
        </h3>
        <div className="carousel-arrows show hide-xs">
          <button className="icon-btn" onClick={() => scroll(-1)} aria-label="Previous">
            <LuChevronLeft size={18} />
          </button>
          <button className="icon-btn" onClick={() => scroll(1)} aria-label="Next">
            <LuChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="trend-row" ref={row}>
        {picks.map((p, i) => {
          const on = slip.has(p.outcomeId);
          return (
            <div key={p.outcomeId} className={`trend-card ${on ? 'on' : ''}`}>
              <div className="trend-top">
                <span className="trend-rank">#{i + 1}</span>
                {p.live && <span className="live-tag">LIVE</span>}
                <small className="ellipsis">{p.sportTitle}</small>
              </div>
              <Link to={`/event/${p.eventId}`} className="trend-event ellipsis">
                {p.eventLabel}
              </Link>
              <div className="trend-pick">
                <div>
                  <b className="ellipsis">{p.outcomeName}</b>
                  <small>{marketLabel(p.marketKey)}</small>
                </div>
                <button type="button" className={`odds-btn trend-odds ${on ? 'selected' : ''}`} onClick={() => add(p)}>
                  {fmtOdds(p.odds)}
                </button>
              </div>
              <div className="trend-heat">
                <i style={{ width: `${Math.max(8, (p.bets / max) * 100)}%` }} />
              </div>
              <small className="trend-count">
                <LuUsers size={11} /> {p.bets} player{p.bets > 1 ? 's' : ''} backed this today
              </small>
            </div>
          );
        })}
      </div>
    </section>
  );
}
