import { useEffect, useMemo, useRef, useState } from 'react';
import { LuChartLine, LuDices, LuFlame, LuTarget, LuTrophy } from 'react-icons/lu';
import { api } from '../lib/api';
import { usd } from '../lib/format';
import { useAuth } from '../lib/state';
import { BackBar } from '../components/Layout';
import { Empty, Skeleton } from '../components/ui';
import { GAMES } from '../casino/meta';

interface Row {
  name: string;
  bets: number;
  staked: number;
  profit: number;
}
interface Stats {
  days: number;
  sports: {
    bets: number;
    won: number;
    lost: number;
    staked: number;
    returned: number;
    profit: number;
    roi: number;
    winRate: number;
    biggestWin: number;
    bestOdds: number;
    bestStreak: number;
    open: { bets: number; staked: number; potential: number };
    curve: { day: string; pl: number; cum: number }[];
    bySport: Row[];
    byType: Row[];
  };
  casino: { rounds: number; staked: number; profit: number; games: { game: string; rounds: number; staked: number; profit: number; best: number }[] };
}

const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${usd(Math.abs(x))}`;

/** cumulative profit line with a crosshair tooltip */
function ProfitChart({ curve }: { curve: Stats['sports']['curve'] }) {
  const box = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const pad = { l: 8, r: 8, t: 14, b: 22 };
  const pts = curve.length === 1 ? [{ day: curve[0].day, pl: 0, cum: 0 }, ...curve] : curve;
  const ys = pts.map((p) => p.cum);
  const min = Math.min(0, ...ys);
  const max = Math.max(0, ...ys);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i / Math.max(1, pts.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.cum).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1)} ${y(0)} L${x(0)} ${y(0)}Z`;
  const last = pts[pts.length - 1]?.cum ?? 0;
  const up = last >= 0;
  const onMove = (e: { clientX: number }) => {
    const r = box.current!.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(x(i) - fx) < Math.abs(x(best) - fx)) best = i;
    setHover(best);
  };
  const hp = hover != null ? pts[hover] : null;
  return (
    <div className="st-chart">
      <svg ref={box} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`Cumulative profit, ending at ${signed(last)}`}>
        <defs>
          <linearGradient id="stFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={up ? '#22c55e' : '#ef4444'} stopOpacity=".28" />
            <stop offset="1" stopColor={up ? '#22c55e' : '#ef4444'} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} className="st-grid" />
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="st-zero" />
        <path d={area} fill="url(#stFill)" />
        <path d={line} fill="none" stroke={up ? '#22c55e' : '#ef4444'} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hp && (
          <>
            <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={H - pad.b} className="st-cross" vectorEffect="non-scaling-stroke" />
            <circle cx={x(hover!)} cy={y(hp.cum)} r="4.5" fill={hp.cum >= 0 ? '#22c55e' : '#ef4444'} stroke="#0f1330" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {hp && (
        <div className="st-tip" style={{ left: `${(x(hover!) / W) * 100}%` }}>
          <small>{hp.day}</small>
          <b>{signed(hp.cum)}</b>
          <span>day {signed(hp.pl)}</span>
        </div>
      )}
      <div className="st-axis">
        <span>{pts[0]?.day}</span>
        <span>{pts[pts.length - 1]?.day}</span>
      </div>
    </div>
  );
}

function Bars({ rows }: { rows: Row[] }) {
  const m = Math.max(1, ...rows.map((r) => Math.abs(r.profit)));
  return (
    <div className="st-bars">
      {rows.map((r) => (
        <div key={r.name} className="st-bar">
          <span className="ellipsis" title={r.name}>
            {r.name}
          </span>
          <div className="st-track">
            <i className={r.profit >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(r.profit) / m) * 100}%` }} />
          </div>
          <b className={r.profit >= 0 ? 'win' : 'loss'}>{signed(r.profit)}</b>
          <small>
            {r.bets} bet{r.bets === 1 ? '' : 's'} · {usd(r.staked)}
          </small>
        </div>
      ))}
    </div>
  );
}

export function StatsPage() {
  const { user, openAuth } = useAuth();
  const [days, setDays] = useState(30);
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    if (!user) return;
    setS(null);
    api<Stats>(`/bets/stats?days=${days}`).then(setS).catch(() => {});
  }, [user?.id, days]); // eslint-disable-line react-hooks/exhaustive-deps
  const gameName = useMemo(() => new Map(GAMES.map((g) => [g.id, g.name])), []);

  if (!user)
    return (
      <div className="page">
        <BackBar title="My stats" />
        <Empty icon={<LuChartLine size={34} />} title="Log in to see your stats" action={<button className="btn btn-primary" onClick={() => openAuth('login')}>Log in</button>} />
      </div>
    );

  const sp = s?.sports;
  return (
    <div className="page stats-page">
      <BackBar title="My stats" />
      <div className="seg st-range">
        {[
          [7, '7 days'],
          [30, '30 days'],
          [90, '90 days'],
          [0, 'All time'],
        ].map(([d, l]) => (
          <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d as number)}>
            {l}
          </button>
        ))}
      </div>
      {!s || !sp ? (
        <Skeleton h={120} count={3} />
      ) : (
        <>
          <section className="st-kpis">
            <div className={`st-kpi hero ${sp.profit >= 0 ? 'pos' : 'neg'}`}>
              <small>Sports profit</small>
              <b>{signed(sp.profit)}</b>
              <em>ROI {sp.roi > 0 ? '+' : ''}{sp.roi}%</em>
            </div>
            <div className="st-kpi">
              <small>
                <LuTarget size={13} /> Win rate
              </small>
              <b>{sp.winRate}%</b>
              <em>
                {sp.won}W · {sp.lost}L
              </em>
            </div>
            <div className="st-kpi">
              <small>Staked</small>
              <b>{usd(sp.staked)}</b>
              <em>{sp.bets} settled bets</em>
            </div>
            <div className="st-kpi">
              <small>
                <LuTrophy size={13} /> Biggest win
              </small>
              <b>{usd(sp.biggestWin)}</b>
              <em>best odds {sp.bestOdds ? sp.bestOdds.toFixed(2) : '—'}</em>
            </div>
            <div className="st-kpi">
              <small>
                <LuFlame size={13} /> Best streak
              </small>
              <b>{sp.bestStreak}</b>
              <em>wins in a row</em>
            </div>
            <div className="st-kpi">
              <small>Open bets</small>
              <b>{sp.open.bets}</b>
              <em>
                {usd(sp.open.staked)} → {usd(sp.open.potential)}
              </em>
            </div>
          </section>

          <section className="st-card">
            <h3>Profit over time</h3>
            {sp.curve.length ? <ProfitChart curve={sp.curve} /> : <p className="muted">No settled bets in this period yet.</p>}
          </section>

          <div className="st-two">
            <section className="st-card">
              <h3>By sport</h3>
              {sp.bySport.length ? <Bars rows={sp.bySport} /> : <p className="muted">—</p>}
            </section>
            <section className="st-card">
              <h3>By bet type</h3>
              {sp.byType.length ? <Bars rows={sp.byType.map((r) => ({ ...r, name: r.name === 'PARLAY' ? 'Parlays' : r.name === 'BUILDER' ? 'Bet Builder' : 'Singles' }))} /> : <p className="muted">—</p>}
            </section>
          </div>

          <section className="st-card">
            <h3>
              <LuDices size={16} /> Wavy Originals
            </h3>
            <div className="st-casino-sum">
              <span>
                {s.casino.rounds.toLocaleString()} rounds · {usd(s.casino.staked)} wagered
              </span>
              <b className={s.casino.profit >= 0 ? 'win' : 'loss'}>{signed(s.casino.profit)}</b>
            </div>
            {s.casino.games.length ? (
              <div className="st-table">
                <div className="st-tr head">
                  <span>Game</span>
                  <span>Rounds</span>
                  <span>Wagered</span>
                  <span>Best</span>
                  <span>Profit</span>
                </div>
                {s.casino.games.map((g) => (
                  <div key={g.game} className="st-tr">
                    <span className="ellipsis">{gameName.get(g.game) ?? g.game}</span>
                    <span>{g.rounds}</span>
                    <span>{usd(g.staked)}</span>
                    <span>{g.best ? `${g.best.toFixed(2)}×` : '—'}</span>
                    <span className={g.profit >= 0 ? 'win' : 'loss'}>{signed(g.profit)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No Originals rounds in this period.</p>
            )}
          </section>
          <small className="muted">Stats cover settled bets only. Gambling should be fun — set limits in Settings if you need them.</small>
        </>
      )}
    </div>
  );
}
