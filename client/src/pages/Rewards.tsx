import { useEffect, useMemo, useRef, useState } from 'react';
import { LuCheck, LuClock, LuGift, LuRotateCcw, LuTarget, LuTrophy, LuUsers } from 'react-icons/lu';
import { api, type ApiError } from '../lib/api';
import { usd } from '../lib/format';
import { Link } from '../lib/router';
import { useAuth, useToast } from '../lib/state';
import { BackBar } from '../components/Layout';
import { Skeleton, Spinner } from '../components/ui';
import { sfx } from '../casino/sound';

/* ───────────────────────────── helpers ───────────────────────────── */

export function useCountdown(iso: string | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!iso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [iso]);
  if (!iso) return null;
  const ms = Math.max(0, new Date(iso).getTime() - now);
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const d = Math.floor(h / 24);
  return { ms, text: d >= 1 ? `${d}d ${h % 24}h ${m}m` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` };
}

/* ───────────────────────────── daily wheel ───────────────────────────── */

interface SpinStatus {
  prizes: number[];
  nextAt: string | null;
  ready: boolean;
  reasons: string[];
  weekWager: number;
}
/** wheel layout: 12 equal slices; the prize table's odds live on the server */
const SLICES = [0.1, 1, 0.25, 5, 0.5, 0.1, 2, 0.25, 25, 0.5, 0.1, 1];
const SLICE_COLORS = ['#1e5bff', '#7c3aed', '#0ea5e9', '#f59e0b', '#16a34a', '#1e5bff', '#db2777', '#0ea5e9', '#eab308', '#16a34a', '#1e5bff', '#7c3aed'];

function DailyWheel() {
  const { user, setBalance, openAuth } = useAuth();
  const toast = useToast();
  const [st, setSt] = useState<SpinStatus | null>(null);
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [won, setWon] = useState<number | null>(null);
  const wheel = useRef<SVGGElement>(null);
  const cd = useCountdown(st?.nextAt);

  const load = () => api<SpinStatus>('/rewards/spin').then(setSt).catch(() => {});
  useEffect(() => {
    if (user) load();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (cd && cd.ms === 0 && st?.nextAt) load();
  }, [cd?.ms === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const spin = async () => {
    if (!user) return openAuth('login');
    setSpinning(true);
    setWon(null);
    sfx.bet();
    try {
      const d = await api<{ index: number; prize: number; balance: string; nextAt: string }>('/rewards/spin', { method: 'POST' });
      const choices = SLICES.map((p, i) => [p, i] as const).filter(([p]) => p === d.prize);
      const slice = choices[Math.floor(Math.random() * choices.length)][1];
      const seg = 360 / SLICES.length;
      // pointer at the top: rotate so the chosen slice's centre lands under it
      const target = 360 * 6 + (360 - (slice * seg + seg / 2)) + (Math.random() - 0.5) * seg * 0.6;
      const base = angle - (angle % 360);
      setAngle(base + target);
      const ticks = setInterval(() => sfx.tick(), 90);
      setTimeout(() => clearInterval(ticks), 3600);
      setTimeout(() => {
        setWon(d.prize);
        setBalance(d.balance);
        d.prize >= 5 ? sfx.bigWin() : sfx.win();
        toast('ok', `You won ${usd(d.prize)} on the daily wheel!`);
        setSt((s) => (s ? { ...s, ready: false, nextAt: d.nextAt } : s));
        setSpinning(false);
      }, 4300);
    } catch (e) {
      toast('err', (e as ApiError).message);
      setSpinning(false);
      load();
    }
  };

  const seg = 360 / SLICES.length;
  const arc = (i: number) => {
    const a0 = ((i * seg - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * seg - 90) * Math.PI) / 180;
    return `M100 100 L${100 + 96 * Math.cos(a0)} ${100 + 96 * Math.sin(a0)} A96 96 0 0 1 ${100 + 96 * Math.cos(a1)} ${100 + 96 * Math.sin(a1)}Z`;
  };

  return (
    <section className="rw-card rw-wheel">
      <header>
        <LuRotateCcw size={18} />
        <div>
          <b>Daily reward wheel</b>
          <small>One free spin every 24 hours · up to {usd(25)}</small>
        </div>
      </header>
      <div className="dw">
        <div className="dw-pointer" />
        <svg viewBox="0 0 200 200" className="dw-svg">
          <circle cx="100" cy="100" r="99" fill="#0b0f1f" stroke="#ffd24a" strokeWidth="2" />
          <g ref={wheel} style={{ transform: `rotate(${angle}deg)`, transformOrigin: '100px 100px', transition: spinning ? 'transform 4.2s cubic-bezier(0.12, 0.8, 0.12, 1)' : 'none' }}>
            {SLICES.map((p, i) => {
              const mid = ((i + 0.5) * seg - 90) * (Math.PI / 180);
              const tx = 100 + 66 * Math.cos(mid);
              const ty = 100 + 66 * Math.sin(mid);
              return (
                <g key={i}>
                  <path d={arc(i)} fill={SLICE_COLORS[i]} opacity={won != null && p === won ? 1 : 0.88} stroke="rgba(0,0,0,.35)" strokeWidth="1" />
                  <text x={tx} y={ty} fill="#fff" fontSize={p >= 5 ? 13 : 11} fontWeight="900" textAnchor="middle" dominantBaseline="central" transform={`rotate(${(i + 0.5) * seg} ${tx} ${ty})`}>
                    ${p < 1 ? p.toFixed(2).replace(/^0/, '') : p}
                  </text>
                </g>
              );
            })}
            {Array.from({ length: SLICES.length }, (_, i) => {
              const a = ((i * seg - 90) * Math.PI) / 180;
              return <circle key={i} cx={100 + 94 * Math.cos(a)} cy={100 + 94 * Math.sin(a)} r="2.4" fill="#ffe28a" />;
            })}
          </g>
          <circle cx="100" cy="100" r="22" fill="url(#dwHub)" stroke="#ffd24a" strokeWidth="2" />
          <defs>
            <radialGradient id="dwHub" cx="40%" cy="35%">
              <stop offset="0" stopColor="#3b82ff" />
              <stop offset="1" stopColor="#0a1a6b" />
            </radialGradient>
          </defs>
          <text x="100" y="101" textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize="10" fontWeight="900">
            WAVY
          </text>
        </svg>
      </div>
      {won != null && <div className="dw-won">🎉 {usd(won)} added to your balance</div>}
      {!user ? (
        <button className="btn btn-primary btn-block" onClick={() => openAuth('login')}>
          Log in to spin
        </button>
      ) : !st ? (
        <Skeleton h={44} />
      ) : st.nextAt ? (
        <button className="btn btn-ghost btn-block" disabled>
          <LuClock size={16} /> Next spin in {cd?.text}
        </button>
      ) : st.reasons.length ? (
        <div className="rw-reasons">
          <b>Unlock your daily spin</b>
          {st.reasons.map((r) => (
            <span key={r}>• {r}</span>
          ))}
          <Link to="/wallet" className="btn btn-primary btn-sm">
            Go to wallet
          </Link>
        </div>
      ) : (
        <button className="btn btn-primary btn-block rw-glow" disabled={spinning} onClick={spin}>
          {spinning ? <Spinner /> : 'Spin the wheel'}
        </button>
      )}
      <small className="muted">Prizes are credited as bonus balance with a 1× wagering requirement.</small>
    </section>
  );
}

/* ───────────────────────────── weekly cashback ───────────────────────────── */

interface Cashback {
  rate: number;
  minLoss: number;
  max: number;
  week: string;
  lastWeekLoss: number;
  amount: number;
  claimed: boolean;
  claimable: boolean;
  thisWeekLoss: number;
  thisWeekEstimate: number;
  nextWeekStarts: string;
}

function CashbackCard() {
  const { user, setBalance } = useAuth();
  const toast = useToast();
  const [c, setC] = useState<Cashback | null>(null);
  const [busy, setBusy] = useState(false);
  const cd = useCountdown(c?.nextWeekStarts);
  useEffect(() => {
    if (user) api<Cashback>('/rewards/cashback').then(setC).catch(() => {});
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const claim = async () => {
    setBusy(true);
    try {
      const d = await api<{ claimed: number; balance: string }>('/rewards/cashback/claim', { method: 'POST' });
      setBalance(d.balance);
      sfx.cashout();
      toast('ok', `Cashback of ${usd(d.claimed)} credited`);
      setC((x) => (x ? { ...x, claimed: true, claimable: false } : x));
    } catch (e) {
      toast('err', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rw-card rw-cash">
      <header>
        <LuGift size={18} />
        <div>
          <b>Weekly cashback · {c ? Math.round(c.rate * 100) : 5}%</b>
          <small>Every Monday you get back a share of last week's net losses — no wagering.</small>
        </div>
      </header>
      {!user ? (
        <p className="muted">Log in to see your cashback.</p>
      ) : !c ? (
        <Skeleton h={90} />
      ) : (
        <>
          <div className="rw-cash-grid">
            <div>
              <small>Last week ({c.week})</small>
              <b>{usd(c.amount)}</b>
              <em>net loss {usd(c.lastWeekLoss)}</em>
            </div>
            <div>
              <small>This week so far</small>
              <b>{usd(c.thisWeekEstimate)}</b>
              <em>net loss {usd(c.thisWeekLoss)} · resets in {cd?.text}</em>
            </div>
          </div>
          <button className="btn btn-primary btn-block" disabled={!c.claimable || busy} onClick={claim}>
            {busy ? <Spinner /> : c.claimed ? (
              <>
                <LuCheck size={16} /> Claimed
              </>
            ) : c.claimable ? (
              `Claim ${usd(c.amount)}`
            ) : (
              `Needs a net loss of ${usd(c.minLoss)}+`
            )}
          </button>
          <small className="muted">
            Up to {usd(c.max)} per week. Net loss = stakes − winnings on settled bets and Originals rounds.
          </small>
        </>
      )}
    </section>
  );
}

/* ───────────────────────────── daily missions ───────────────────────────── */

interface Mission {
  id: string;
  title: string;
  goal: number;
  reward: number;
  unit: '$' | '';
  progress: number;
  complete: boolean;
  claimed: boolean;
}

export function Missions({ compact }: { compact?: boolean }) {
  const { user, setBalance } = useAuth();
  const toast = useToast();
  const [d, setD] = useState<{ day: string; resetsAt: string; missions: Mission[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const cd = useCountdown(d?.resetsAt);
  const load = () => api<{ day: string; resetsAt: string; missions: Mission[] }>('/rewards/missions').then(setD).catch(() => {});
  useEffect(() => {
    if (user) load();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const claim = async (id: string) => {
    setBusy(id);
    try {
      const r = await api<{ claimed: number; balance: string }>(`/rewards/missions/${id}/claim`, { method: 'POST' });
      setBalance(r.balance);
      sfx.win();
      toast('ok', `Mission reward ${usd(r.claimed)} credited`);
      load();
    } catch (e) {
      toast('err', (e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };
  const done = d?.missions.filter((m) => m.claimed).length ?? 0;
  return (
    <section className={`rw-card rw-missions ${compact ? 'compact' : ''}`}>
      <header>
        <LuTarget size={18} />
        <div>
          <b>Daily missions</b>
          <small>
            {d ? `${done}/${d.missions.length} completed · new missions in ${cd?.text}` : 'Complete missions to earn bonus cash every day'}
          </small>
        </div>
      </header>
      {!user ? (
        <p className="muted">Log in to track your missions.</p>
      ) : !d ? (
        <Skeleton h={48} count={3} />
      ) : (
        <ul>
          {d.missions.map((m) => (
            <li key={m.id} className={m.claimed ? 'claimed' : m.complete ? 'ready' : ''}>
              <div className="ms-top">
                <span>{m.title}</span>
                <em>+{usd(m.reward)}</em>
              </div>
              <div className="ms-bar">
                <i style={{ width: `${(m.progress / m.goal) * 100}%` }} />
              </div>
              <div className="ms-foot">
                <small>
                  {m.unit === '$' ? `${usd(m.progress)} / ${usd(m.goal)}` : `${m.progress} / ${m.goal}`}
                </small>
                {m.claimed ? (
                  <span className="ms-done">
                    <LuCheck size={14} /> Claimed
                  </span>
                ) : (
                  <button className="btn btn-primary btn-sm" disabled={!m.complete || busy === m.id} onClick={() => claim(m.id)}>
                    {busy === m.id ? <Spinner /> : 'Claim'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ───────────────────────────── page ───────────────────────────── */

export function RewardsPage() {
  const links = useMemo(
    () => [
      { to: '/tournament', icon: <LuTrophy size={20} />, title: 'Weekly race', text: 'Climb the wager leaderboard for a share of the prize pool' },
      { to: '/referral', icon: <LuUsers size={20} />, title: 'Refer & earn', text: 'Invite friends and earn from every bet they place' },
      { to: '/vip', icon: <LuGift size={20} />, title: 'VIP booster', text: '$20 real cash for every $5,000 you wager' },
    ],
    []
  );
  return (
    <div className="page rewards-page">
      <BackBar title="Rewards" />
      <div className="rw-grid">
        <DailyWheel />
        <div className="rw-col">
          <CashbackCard />
          <div className="rw-links">
            {links.map((l) => (
              <Link key={l.to} to={l.to} className="rw-link">
                {l.icon}
                <div>
                  <b>{l.title}</b>
                  <small>{l.text}</small>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
      <Missions />
    </div>
  );
}
