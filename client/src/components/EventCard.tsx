import { useEffect, useState } from 'react';
import { LuRadio, LuStar } from 'react-icons/lu';
import { useFavs } from '../lib/favs';
import { onGoal } from '../lib/goals';
import { Link } from '../lib/router';
import { kickoff, leagueParts } from '../lib/format';
import type { SportEvent } from '../lib/types';
import { OddsButton, SportIcon, TeamBadge } from './ui';

const h2hOf = (ev: SportEvent) => ev.markets.find((m) => m.key === 'h2h');

function H2HRow({ ev }: { ev: SportEvent }) {
  const m = h2hOf(ev);
  const by = (c: string) => m?.outcomes.find((o) => o.code === c);
  const hasDraw = !!by('draw');
  const locked = !!m?.suspended;
  return (
    <div className={`odds-row${hasDraw ? '' : ' two'}`}>
      <OddsButton ev={ev} marketKey="h2h" o={by('home')} label="1" locked={locked} />
      {hasDraw && <OddsButton ev={ev} marketKey="h2h" o={by('draw')} label="X" locked={locked} />}
      <OddsButton ev={ev} marketKey="h2h" o={by('away')} label="2" locked={locked} />
    </div>
  );
}

function LiveOrTime({ ev }: { ev: SportEvent }) {
  if (ev.status === 'LIVE')
    return (
      <span className="live-pill">
        <LuRadio size={12} /> {ev.liveMinute != null ? `${ev.liveMinute}'` : 'Live'}
      </span>
    );
  return <span className="ev-time">{kickoff(ev.commenceTime)}</span>;
}

/** ☆ star a match: goal alerts + "My matches" */
export function FavStar({ id, size = 15 }: { id: string; size?: number }) {
  const favs = useFavs('events');
  const on = favs.has(id);
  return (
    <button
      type="button"
      className={`fav-star${on ? ' on' : ''}`}
      aria-label={on ? 'Remove from my matches' : 'Add to my matches'}
      aria-pressed={on}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        favs.toggle(id);
      }}
    >
      <LuStar size={size} />
    </button>
  );
}

/** Big featured card for the lobby carousel */
export function FeaturedCard({ ev }: { ev: SportEvent }) {
  const { groupTitle } = leagueParts(ev.sportKey, ev.sportTitle);
  return (
    <Link to={`/event/${ev.id}`} className="feat-card">
      <div className="feat-glow" />
      <div className="feat-head">
        <span className="feat-league">
          <SportIcon sportKey={ev.sportKey} size={14} />
          <span className="ellipsis">{ev.sportKey.startsWith('soccer_af_') ? ev.sportTitle : `${groupTitle} · ${ev.sportTitle}`}</span>
        </span>
        <span className="feat-right">
          <LiveOrTime ev={ev} />
          <FavStar id={ev.id} />
        </span>
      </div>
      <div className="feat-teams">
        <div className="feat-team">
          <TeamBadge name={ev.homeTeam} logo={ev.homeLogo} size={44} />
          <span className="ellipsis">{ev.homeTeam}</span>
        </div>
        <div className="feat-vs">
          {ev.status === 'LIVE' && ev.homeScore != null ? (
            <span className="score-big">
              {ev.homeScore} : {ev.awayScore}
            </span>
          ) : (
            <span>VS</span>
          )}
        </div>
        <div className="feat-team">
          <TeamBadge name={ev.awayTeam} logo={ev.awayLogo} size={44} />
          <span className="ellipsis">{ev.awayTeam}</span>
        </div>
      </div>
      <div className="feat-market">1x2</div>
      <H2HRow ev={ev} />
    </Link>
  );
}

/** Standard match card used in grids */
/** flashes "GOAL" on a card for a few seconds when its match scores */
function useGoalFlash(id: string) {
  const [side, setSide] = useState<'home' | 'away' | null>(null);
  useEffect(() => onGoal((g) => g.id === id && setSide(g.side)), [id]);
  useEffect(() => {
    if (!side) return;
    const t = setTimeout(() => setSide(null), 7000);
    return () => clearTimeout(t);
  }, [side]);
  return side;
}

export function EventCard({ ev }: { ev: SportEvent }) {
  const { groupTitle } = leagueParts(ev.sportKey, ev.sportTitle);
  const extra = ev.marketCount ?? ev.markets.reduce((n, m) => n + m.outcomes.length, 0);
  const goal = useGoalFlash(ev.id);
  return (
    <Link to={`/event/${ev.id}`} className={`ev-card${goal ? ' goal-flash' : ''}`}>
      {goal && <span className={`goal-badge ${goal}`}>⚽ GOAL!</span>}
      <div className="ev-league">
        <SportIcon sportKey={ev.sportKey} size={13} />
        <span className="ellipsis">{ev.sportKey.startsWith('soccer_af_') ? ev.sportTitle : `${groupTitle} · ${ev.sportTitle}`}</span>
      </div>
      <div className="ev-meta">
        <LiveOrTime ev={ev} />
        <FavStar id={ev.id} />
      </div>
      <div className="ev-teams">
        <div className="ev-team">
          <TeamBadge name={ev.homeTeam} logo={ev.homeLogo} size={20} />
          <span className="ellipsis">{ev.homeTeam}</span>
          {ev.homeScore != null && ev.status === 'LIVE' && <b className={`ev-score${goal === 'home' ? ' bump' : ''}`}>{ev.homeScore}</b>}
        </div>
        <div className="ev-team">
          <TeamBadge name={ev.awayTeam} logo={ev.awayLogo} size={20} />
          <span className="ellipsis">{ev.awayTeam}</span>
          {ev.awayScore != null && ev.status === 'LIVE' && <b className={`ev-score${goal === 'away' ? ' bump' : ''}`}>{ev.awayScore}</b>}
        </div>
      </div>
      <div className="ev-market-row">
        <span className="ev-market">1x2</span>
        {ev.status === 'UPCOMING' && ev.sportKey.startsWith('soccer') && h2hOf(ev) && <span className="twoup mini" title="Early payout if your team goes 2 goals ahead">2UP</span>}
        {extra > 3 && <span className="ev-more">+{extra - 3}</span>}
      </div>
      {!h2hOf(ev) ? (
        ev.status === 'LIVE' ? (
          <div className="odds-locked">Live score only — no in-play betting for this match</div>
        ) : (
        <div className="odds-locked">Odds open soon — bookmakers price matches ~2 weeks before kick-off</div>
        )
      ) : (
        <H2HRow ev={ev} />
      )}
    </Link>
  );
}
