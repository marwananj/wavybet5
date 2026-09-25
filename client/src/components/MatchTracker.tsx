import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { onGoal } from '../lib/goals';
import { kickoff } from '../lib/format';
import type { SportEvent } from '../lib/types';

/**
 * Stadium match tracker.
 * Everything shown comes from the official match feed: goals, cards, subs and VAR (events), and the
 * live statistics (possession, shots, shots on target, corners…). The pitch state is derived from them:
 *   • Goal / Shot on target / Shot / Corner / Card — the moment the feed reports it
 *   • Dangerous attack — the team that produced a shot or corner in the last ~90 seconds
 *   • Attack — the team with clearly more of the ball (possession)
 *   • Ball safe — neither
 */

interface TEvent {
  minute: number;
  extra: number | null;
  team: 'home' | 'away';
  type: string;
  detail: string;
  player: string | null;
  assist: string | null;
}
interface Tracker {
  available: boolean;
  status: string;
  statusLong?: string;
  elapsed?: number | null;
  score?: [number | null, number | null];
  venue?: string | null;
  referee?: string | null;
  formations?: [string | null, string | null];
  events: TEvent[];
  stats: Record<string, [number | null, number | null]> | null;
}
type Side = 'home' | 'away';
interface Moment {
  kind: 'goal' | 'shot_on' | 'shot' | 'corner' | 'card' | 'red' | 'sub' | 'var';
  team: Side;
  text: string;
  at: number; // client time
}

const HOME = '#3ad0ff';
const AWAY = '#ff8a3d';
const W = 600;
const H = 340;

const num = (v: number | null | undefined) => (v == null ? 0 : v);

function Pitch({ focus, moment, home, away }: { focus: { team: Side | null; level: 'safe' | 'attack' | 'danger' }; moment: Moment | null; home: string; away: string }) {
  // ball target from the state (home attacks to the right)
  const [ball, setBall] = useState({ x: W / 2, y: H / 2 });
  useEffect(() => {
    const place = () => {
      const r = () => Math.random() - 0.5;
      let x = W / 2 + r() * 60;
      let y = H / 2 + r() * 120;
      const t = moment && Date.now() - moment.at < 12_000 ? moment : null;
      const dir = (s: Side) => (s === 'home' ? 1 : -1);
      if (t) {
        const d = dir(t.team);
        if (t.kind === 'goal') [x, y] = [W / 2 + d * (W / 2 - 14), H / 2 + r() * 20];
        else if (t.kind === 'corner') [x, y] = [W / 2 + d * (W / 2 - 12), Math.random() < 0.5 ? 14 : H - 14];
        else if (t.kind === 'shot_on' || t.kind === 'shot') [x, y] = [W / 2 + d * (W / 2 - 70 + r() * 30), H / 2 + r() * 90];
      } else if (focus.team && focus.level !== 'safe') {
        const d = dir(focus.team);
        const depth = focus.level === 'danger' ? W / 2 - 95 : W / 2 - 200;
        x = W / 2 + d * (depth + r() * 60);
        y = H / 2 + r() * (focus.level === 'danger' ? 150 : 200);
      }
      setBall({ x, y });
    };
    place();
    const t = setInterval(place, 2200);
    return () => clearInterval(t);
  }, [focus.team, focus.level, moment]);

  const zoneSide = moment && Date.now() - moment.at < 12_000 ? moment.team : focus.level !== 'safe' ? focus.team : null;
  const zoneColor = zoneSide === 'home' ? HOME : AWAY;
  const zoneLevel = moment && Date.now() - moment.at < 12_000 ? 'danger' : focus.level;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-pitch" aria-hidden>
      <defs>
        <linearGradient id="mt-zone-r" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={zoneColor} stopOpacity="0" />
          <stop offset="1" stopColor={zoneColor} stopOpacity={zoneLevel === 'danger' ? 0.55 : 0.3} />
        </linearGradient>
        <linearGradient id="mt-zone-l" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor={zoneColor} stopOpacity="0" />
          <stop offset="1" stopColor={zoneColor} stopOpacity={zoneLevel === 'danger' ? 0.55 : 0.3} />
        </linearGradient>
        <radialGradient id="mt-ball" cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#c9d1e4" />
        </radialGradient>
      </defs>
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={(W / 12) * i} y="0" width={W / 12} height={H} fill={i % 2 ? '#2f8f46' : '#34994c'} />
      ))}
      {zoneSide && (
        <rect
          className="mt-zone"
          x={zoneSide === 'home' ? W / 2 : 0}
          y="0"
          width={W / 2}
          height={H}
          fill={`url(#mt-zone-${zoneSide === 'home' ? 'r' : 'l'})`}
        />
      )}
      <g fill="none" stroke="rgba(255,255,255,.75)" strokeWidth="2">
        <rect x="8" y="8" width={W - 16} height={H - 16} />
        <line x1={W / 2} y1="8" x2={W / 2} y2={H - 8} />
        <circle cx={W / 2} cy={H / 2} r="44" />
        <rect x="8" y={H / 2 - 82} width="84" height="164" />
        <rect x={W - 92} y={H / 2 - 82} width="84" height="164" />
        <rect x="8" y={H / 2 - 38} width="30" height="76" />
        <rect x={W - 38} y={H / 2 - 38} width="30" height="76" />
        <path d={`M92 ${H / 2 - 34} A44 44 0 0 1 92 ${H / 2 + 34}`} />
        <path d={`M${W - 92} ${H / 2 - 34} A44 44 0 0 0 ${W - 92} ${H / 2 + 34}`} />
      </g>
      <circle cx={W / 2} cy={H / 2} r="3" fill="#fff" />
      <rect x="0" y={H / 2 - 22} width="8" height="44" fill="rgba(255,255,255,.85)" />
      <rect x={W - 8} y={H / 2 - 22} width="8" height="44" fill="rgba(255,255,255,.85)" />
      <text x="24" y={H - 18} className="mt-side" fill={HOME}>
        {home} →
      </text>
      <text x={W - 24} y={H - 18} className="mt-side" textAnchor="end" fill={AWAY}>
        ← {away}
      </text>
      <g className="mt-ball" style={{ transform: `translate(${ball.x}px, ${ball.y}px)` }}>
        <circle r="13" fill={zoneSide ? zoneColor : '#fff'} opacity=".25" className="mt-ball-pulse" />
        <circle r="6.5" fill="url(#mt-ball)" stroke="#1f2937" strokeWidth=".8" />
      </g>
    </svg>
  );
}

const ICON: Record<string, string> = { goal: '⚽', shot_on: '🎯', shot: '💨', corner: '⛳', card: '🟨', red: '🟥', sub: '🔁', var: '📺' };

export function MatchTracker({ ev }: { ev: SportEvent }) {
  const [data, setData] = useState<Tracker | null>(null);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [goalFlash, setGoalFlash] = useState<{ side: Side; key: number } | null>(null);
  const [, tick] = useState(0);
  const prev = useRef<Tracker | null>(null);
  const lastDanger = useRef<{ team: Side; at: number } | null>(null);
  const live = ev.status === 'LIVE';

  // poll the tracker feed
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Tracker>(`/events/${ev.id}/tracker`)
        .then((d) => {
          if (!alive) return;
          const p = prev.current;
          const add: Moment[] = [];
          const now = Date.now();
          if (p && d.stats && p.stats) {
            const inc = (k: string, i: 0 | 1) => num(d.stats![k]?.[i]) - num(p.stats![k]?.[i]);
            ([0, 1] as const).forEach((i) => {
              const team: Side = i === 0 ? 'home' : 'away';
              const name = i === 0 ? ev.homeTeam : ev.awayTeam;
              if (inc('shotsOn', i) > 0) add.push({ kind: 'shot_on', team, text: `Shot on target — ${name}`, at: now });
              else if (inc('shots', i) > 0) add.push({ kind: 'shot', team, text: `Shot — ${name}`, at: now });
              if (inc('corners', i) > 0) add.push({ kind: 'corner', team, text: `Corner — ${name}`, at: now });
            });
          }
          if (p) {
            const seen = new Set(p.events.map((e) => `${e.minute}|${e.type}|${e.detail}|${e.player}`));
            for (const e of d.events) {
              if (seen.has(`${e.minute}|${e.type}|${e.detail}|${e.player}`)) continue;
              const name = e.team === 'home' ? ev.homeTeam : ev.awayTeam;
              const t = e.type.toLowerCase();
              if (t === 'goal') add.push({ kind: 'goal', team: e.team, text: `GOAL! ${e.player ?? name} (${e.minute}')`, at: now });
              else if (t === 'card') add.push({ kind: /red/i.test(e.detail) ? 'red' : 'card', team: e.team, text: `${e.detail} — ${e.player ?? name}`, at: now });
              else if (t === 'subst') add.push({ kind: 'sub', team: e.team, text: `Substitution — ${name}`, at: now });
              else if (t === 'var') add.push({ kind: 'var', team: e.team, text: `VAR: ${e.detail}`, at: now });
            }
          }
          const danger = [...add].reverse().find((m) => m.kind === 'shot_on' || m.kind === 'shot' || m.kind === 'corner' || m.kind === 'goal');
          if (danger) lastDanger.current = { team: danger.team, at: now };
          if (add.length) setMoments((m) => [...add, ...m].slice(0, 30));
          prev.current = d;
          setData(d);
        })
        .catch(() => alive && setData((x) => x ?? { available: false, status: ev.status, events: [], stats: null }));
    load();
    if (!live) return () => void (alive = false);
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [ev.id, live]); // eslint-disable-line react-hooks/exhaustive-deps

  // instant goal from the score push (faster than the stats feed)
  useEffect(
    () =>
      onGoal((g) => {
        if (g.id !== ev.id) return;
        setGoalFlash({ side: g.side, key: Date.now() });
        lastDanger.current = { team: g.side, at: Date.now() };
        setMoments((m) => [{ kind: 'goal' as const, team: g.side, text: `GOAL! ${g.side === 'home' ? g.homeTeam : g.awayTeam} · ${g.homeScore}-${g.awayScore}`, at: Date.now() }, ...m].slice(0, 30));
      }),
    [ev.id]
  );
  useEffect(() => {
    if (!goalFlash) return;
    const t = setTimeout(() => setGoalFlash(null), 6000);
    return () => clearTimeout(t);
  }, [goalFlash]);
  // re-evaluate the "last 90 seconds" window
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((x) => x + 1), 3000);
    return () => clearInterval(t);
  }, [live]);

  const poss = data?.stats?.possession;
  const focus = useMemo(() => {
    const d = lastDanger.current;
    if (live && d && Date.now() - d.at < 90_000) return { team: d.team, level: 'danger' as const };
    if (live && poss && poss[0] != null && poss[1] != null && Math.abs(poss[0] - poss[1]) >= 8) return { team: (poss[0] > poss[1] ? 'home' : 'away') as Side, level: 'attack' as const };
    return { team: null, level: 'safe' as const };
  }, [live, poss, moments, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const latest = moments[0] && Date.now() - moments[0].at < 12_000 ? moments[0] : null;

  const stateLabel = !live
    ? ev.status === 'UPCOMING'
      ? `Kick-off ${kickoff(ev.commenceTime)}`
      : ev.status === 'COMPLETED'
        ? 'Full time'
        : ''
    : data?.status === 'HT'
      ? 'Half-time'
      : latest
        ? latest.text
        : focus.level === 'danger'
          ? `Dangerous attack — ${focus.team === 'home' ? ev.homeTeam : ev.awayTeam}`
          : focus.level === 'attack'
            ? `Attack — ${focus.team === 'home' ? ev.homeTeam : ev.awayTeam}`
            : 'Ball safe';
  const stateTeam: Side | null = latest?.team ?? focus.team;

  const rows: [string, string, boolean?][] = [
    ['possession', 'Possession', true],
    ['shots', 'Shots'],
    ['shotsOn', 'On target'],
    ['corners', 'Corners'],
    ['xg', 'xG'],
    ['yellow', 'Yellow cards'],
    ['red', 'Red cards'],
    ['fouls', 'Fouls'],
    ['offsides', 'Offsides'],
  ];
  const feed = data?.events?.slice().reverse() ?? [];

  return (
    <section className={`tracker ${live ? 'is-live' : ''}`}>
      <div className="mt-stage">
        <Pitch focus={focus} moment={latest} home={ev.homeTeam} away={ev.awayTeam} />
        <div className={`mt-state ${stateTeam ?? 'neutral'} ${latest?.kind ?? focus.level}`} key={stateLabel}>
          {latest && <span className="mt-ico">{ICON[latest.kind]}</span>}
          {stateLabel}
        </div>
        {live && data?.elapsed != null && <div className="mt-clock">{data.status === 'HT' ? 'HT' : `${data.elapsed}'`}</div>}
        {goalFlash && (
          <div key={goalFlash.key} className={`mt-goal ${goalFlash.side}`}>
            <b>GOAL!</b>
            <span>{goalFlash.side === 'home' ? ev.homeTeam : ev.awayTeam}</span>
          </div>
        )}
        {!live && ev.status === 'UPCOMING' && (
          <div className="mt-pre">
            <b>{ev.homeTeam}</b>
            <span>vs</span>
            <b>{ev.awayTeam}</b>
            {data?.venue && <small>{data.venue}</small>}
          </div>
        )}
      </div>

      {data?.stats && (
        <div className="mt-stats">
          {rows
            .filter(([k]) => data.stats![k] && (data.stats![k][0] != null || data.stats![k][1] != null))
            .map(([k, label, pct]) => {
              const [h, a] = data.stats![k].map((v) => num(v));
              const tot = h + a || 1;
              return (
                <div key={k} className="mt-row">
                  <b className="h">{pct ? `${h}%` : h}</b>
                  <div className="mt-bar">
                    <span>{label}</span>
                    <i className="h" style={{ width: `${(h / tot) * 100}%` }} />
                    <i className="a" style={{ width: `${(a / tot) * 100}%` }} />
                  </div>
                  <b className="a">{pct ? `${a}%` : a}</b>
                </div>
              );
            })}
        </div>
      )}

      {(moments.length > 0 || feed.length > 0) && (
        <div className="mt-feed">
          {moments.slice(0, 4).map((m, i) => (
            <div key={`m${m.at}-${i}`} className={`mt-item ${m.team} now`}>
              <span>{ICON[m.kind]}</span>
              <p>{m.text}</p>
              <small>live</small>
            </div>
          ))}
          {feed.slice(0, 12).map((e, i) => {
            const t = e.type.toLowerCase();
            const ico = t === 'goal' ? (/own/i.test(e.detail) ? '⚽ OG' : /penalty/i.test(e.detail) ? '⚽ P' : '⚽') : t === 'card' ? (/red/i.test(e.detail) ? '🟥' : '🟨') : t === 'subst' ? '🔁' : '📺';
            return (
              <div key={`e${i}`} className={`mt-item ${e.team}`}>
                <span>{ico}</span>
                <p>
                  <b>{e.player ?? (e.team === 'home' ? ev.homeTeam : ev.awayTeam)}</b>
                  {t === 'goal' && e.assist ? <small> · assist {e.assist}</small> : t === 'subst' && e.assist ? <small> ⇄ {e.assist}</small> : <small> · {e.detail}</small>}
                </p>
                <small>
                  {e.minute}
                  {e.extra ? `+${e.extra}` : ''}'
                </small>
              </div>
            );
          })}
        </div>
      )}
      {live && data && !data.available && <p className="muted mt-note">Detailed match data isn't available for this competition — live score only.</p>}
    </section>
  );
}
