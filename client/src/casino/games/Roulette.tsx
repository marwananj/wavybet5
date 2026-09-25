import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LuUndo2, LuTrash2, LuRotateCcw } from 'react-icons/lu';
import { usd } from '../../lib/format';
import { casino } from '../api';
import { GameShell, InfoRow, PlayButton, useBet } from '../shared';
import { resultSound, rollLoop, sfx } from '../sound';

const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const STEP = 360 / 37;
const color = (n: number) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const CHIPS = [0.1, 0.5, 1, 5, 10, 25, 100];

type BetKey = string; // "straight:17" | "red" | "dozen:1" | "column:3" ...
interface RouletteResult {
  number: number;
  color: string;
  pocket: number;
  returned: number;
}

/* ─────────────────────────────── geometry ───────────────────────────────
 * All radii are in % of the bowl width, measured from the centre.
 * The rotor is 76% of the bowl; inside the rotor SVG (r = 200) the number ring is 170–200,
 * the pockets 132–170 and the cone below 132.                                                   */
const ROTOR = 38; // rotor radius
const TRACK_R = 44.2; // ball track on the bowl
const POCKET_R = (151 / 200) * ROTOR; // ball resting in a pocket
const APRON_R = 39.6; // where the ball leaves the track and hits the deflectors

/* spin timeline (seconds) */
const T_DROP = 4.1; // ball leaves the track
const T_LOCK = 5.9; // ball settles in the pocket
const T_WHEEL = 8.5; // rotor coasts to rest
const LIFT = 0.35; // dealer launches the ball from the pocket onto the track

/* ─────────────────────────────── rotor art ────────────────────────────── */

function RotorSvg({ win }: { win: number | null }) {
  const C = 200;
  const pt = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return [C + r * Math.sin(a), C - r * Math.cos(a)] as const;
  };
  const arc = (a0: number, a1: number, r0: number, r1: number) => {
    const [x0, y0] = pt(a0, r1);
    const [x1, y1] = pt(a1, r1);
    const [x2, y2] = pt(a1, r0);
    const [x3, y3] = pt(a0, r0);
    return `M${x0} ${y0} A${r1} ${r1} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 0 0 ${x3} ${y3} Z`;
  };
  const winIdx = win == null ? -1 : ORDER.indexOf(win);
  return (
    <svg viewBox="0 0 400 400" className="rw3-svg" aria-hidden>
      <defs>
        <linearGradient id="r3-red" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e3203f" />
          <stop offset="1" stopColor="#8e0b22" />
        </linearGradient>
        <linearGradient id="r3-black" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b2f3f" />
          <stop offset="1" stopColor="#090a10" />
        </linearGradient>
        <linearGradient id="r3-green" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1fc26d" />
          <stop offset="1" stopColor="#086638" />
        </linearGradient>
        <radialGradient id="r3-cone" cx="42%" cy="36%" r="70%">
          <stop offset="0" stopColor="#b07a3c" />
          <stop offset=".45" stopColor="#7a4a1c" />
          <stop offset=".8" stopColor="#4a2a0c" />
          <stop offset="1" stopColor="#2a1605" />
        </radialGradient>
        <linearGradient id="r3-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff4c4" />
          <stop offset=".35" stopColor="#f0c75a" />
          <stop offset=".7" stopColor="#b8860b" />
          <stop offset="1" stopColor="#6e4a06" />
        </linearGradient>
        <radialGradient id="r3-pocket" cx="50%" cy="50%" r="50%">
          <stop offset=".6" stopColor="rgba(0,0,0,0)" />
          <stop offset="1" stopColor="rgba(0,0,0,.55)" />
        </radialGradient>
        <filter id="r3-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <circle cx={C} cy={C} r="200" fill="#1a0e03" />
      {ORDER.map((n, i) => {
        const a0 = (i - 0.5) * STEP;
        const a1 = (i + 0.5) * STEP;
        const fill = n === 0 ? 'url(#r3-green)' : RED.has(n) ? 'url(#r3-red)' : 'url(#r3-black)';
        const [tx, ty] = pt(i * STEP, 185);
        return (
          <g key={n}>
            <path d={arc(a0, a1, 170, 199)} fill={fill} />
            <path d={arc(a0, a1, 132, 170)} fill={fill} opacity=".62" />
            <text x={tx} y={ty} transform={`rotate(${i * STEP} ${tx} ${ty})`} textAnchor="middle" dominantBaseline="central" fontSize="15" fontWeight="800" fill="#fff" fontFamily="Montserrat, sans-serif">
              {n}
            </text>
          </g>
        );
      })}
      {/* pocket depth shading */}
      <circle cx={C} cy={C} r="170" fill="none" stroke="rgba(0,0,0,.45)" strokeWidth="10" />
      <circle cx={C} cy={C} r="151" fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="26" />
      {/* frets */}
      {ORDER.map((_, i) => {
        const [x0, y0] = pt((i - 0.5) * STEP, 132);
        const [x1, y1] = pt((i - 0.5) * STEP, 199);
        return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="url(#r3-gold)" strokeWidth="2.2" />;
      })}
      <circle cx={C} cy={C} r="199" fill="none" stroke="url(#r3-gold)" strokeWidth="2.5" />
      <circle cx={C} cy={C} r="170" fill="none" stroke="url(#r3-gold)" strokeWidth="2.5" />
      {winIdx >= 0 && (
        <g className="r3-winglow">
          <path d={arc((winIdx - 0.5) * STEP, (winIdx + 0.5) * STEP, 128, 203)} fill="#ffe28a" opacity=".9" filter="url(#r3-glow)" />
          <path d={arc((winIdx - 0.5) * STEP, (winIdx + 0.5) * STEP, 132, 199)} fill="rgba(255,255,255,.25)" stroke="#ffe28a" strokeWidth="4" />
        </g>
      )}
      {/* cone */}
      <circle cx={C} cy={C} r="132" fill="url(#r3-cone)" />
      <circle cx={C} cy={C} r="132" fill="none" stroke="url(#r3-gold)" strokeWidth="4" />
      <circle cx={C} cy={C} r="96" fill="none" stroke="rgba(255,220,150,.18)" strokeWidth="1.5" />
      {Array.from({ length: 16 }, (_, i) => {
        const [x, y] = pt(i * 22.5 + 11.25, 128);
        const [x2, y2] = pt(i * 22.5 + 11.25, 60);
        return <line key={i} x1={x2} y1={y2} x2={x} y2={y} stroke="rgba(255,225,170,.07)" strokeWidth="10" />;
      })}
      <circle cx={C} cy={C} r="62" fill="#2a1605" opacity=".5" />
    </svg>
  );
}

/** Stacked discs give the turret and the bowl real thickness in 3D. */
const Layers = ({ n, cls, gap }: { n: number; cls: string; gap: number }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      <span key={i} className={cls} style={{ transform: `translateZ(${-(i + 1) * gap}px)` }} />
    ))}
  </>
);

/* ─────────────────────────────── the wheel ────────────────────────────── */

interface Anim {
  t0: number;
  W0: number;
  Wd: number;
  rel0: number;
  relEnd: number;
  R0: number;
  locked: boolean;
  bounce: number;
  onLock: () => void;
}

function useWheel() {
  const rotor = useRef<HTMLDivElement>(null);
  const ball = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const s = useRef({ W: 0, rel: 0, R: POCKET_R, visible: false, anim: null as Anim | null, roll: null as ReturnType<typeof rollLoop> | null, lastB: 0 });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const st = s.current;
      const a = st.anim;
      if (a) {
        const t = (now - a.t0) / 1000;
        const u = Math.min(1, t / T_WHEEL);
        st.W = a.W0 + a.Wd * (1 - Math.pow(1 - u, 2.4)) + 7 * Math.min(t, T_WHEEL); // coasts into the idle drift
        if (t < T_LOCK) {
          const v = t / T_LOCK;
          let rel = a.rel0 + (a.relEnd - a.rel0) * (1 - Math.pow(1 - v, 2.6));
          let R: number;
          if (t < LIFT) R = a.R0 + (TRACK_R - a.R0) * (t / LIFT);
          else if (t < T_DROP) R = TRACK_R - Math.pow((t - LIFT) / (T_DROP - LIFT), 5) * (TRACK_R - APRON_R) * 0.35;
          else {
            const k = (t - T_DROP) / (T_LOCK - T_DROP); // 0‥1
            const FALL = 0.2;
            if (k < FALL) {
              const f = k / FALL;
              R = TRACK_R - (TRACK_R - APRON_R) * 0.35 - (TRACK_R - (TRACK_R - APRON_R) * 0.35 - POCKET_R) * f * f;
            } else {
              const q = (k - FALL) / (1 - FALL);
              const decay = Math.pow(1 - q, 2);
              const phase = q * Math.PI * 4.5;
              R = POCKET_R + Math.abs(Math.sin(phase)) * 5.2 * decay;
              rel += Math.sin(phase * 0.9) * STEP * 1.4 * decay; // skitters across the frets
              const hop = Math.floor(phase / Math.PI);
              if (hop !== a.bounce) {
                a.bounce = hop;
                sfx.bounce(Math.max(0.25, decay));
              }
            }
          }
          st.rel = rel;
          st.R = R;
        } else {
          st.rel = a.relEnd;
          st.R = POCKET_R;
          if (!a.locked) {
            a.locked = true;
            st.roll?.stop();
            st.roll = null;
            a.onLock();
          }
        }
        if (u >= 1) st.anim = null;
        // rolling noise follows the ball's speed over the bowl
        const B = st.W + st.rel;
        const speed = Math.abs(B - st.lastB) / Math.max(dt, 1e-3);
        st.lastB = B;
        if (st.roll) st.roll.set(t < T_DROP ? speed / 900 : (speed / 900) * 0.5);
      } else {
        st.W += 7 * dt; // idle drift like a live table
      }
      const B = ((st.W + st.rel) * Math.PI) / 180;
      if (rotor.current) rotor.current.style.transform = `rotate(${st.W}deg)`;
      const x = 50 + st.R * Math.sin(B);
      const y = 50 - st.R * Math.cos(B);
      if (ball.current) {
        ball.current.style.left = `${x}%`;
        ball.current.style.top = `${y}%`;
        ball.current.style.opacity = st.visible ? '1' : '0';
      }
      if (shadow.current) {
        shadow.current.style.left = `${x}%`;
        shadow.current.style.top = `${y + 0.8}%`;
        shadow.current.style.opacity = st.visible ? '1' : '0';
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      s.current.roll?.stop();
    };
  }, []);

  /** Spin; resolves when the ball has settled in `pocket`. */
  const spin = (pocket: number) =>
    new Promise<void>((resolve) => {
      const st = s.current;
      const want = pocket * STEP;
      const rel0 = st.visible ? st.rel : st.rel + 180;
      // ball runs 5–6 laps counter-clockwise relative to the rotor
      const d = (((rel0 - want) % 360) + 360) % 360;
      const relEnd = rel0 - d - 360 * 5;
      st.anim = {
        t0: performance.now(),
        W0: st.W,
        Wd: 360 * 2 + 120 + Math.random() * 180,
        rel0,
        relEnd,
        R0: st.visible ? st.R : TRACK_R,
        locked: false,
        bounce: -1,
        onLock: () => {
          sfx.clack();
          resolve();
        },
      };
      st.visible = true;
      st.roll?.stop();
      st.roll = rollLoop();
      sfx.whoosh(0.4);
    });

  return { rotor, ball, shadow, spin };
}

function Wheel({ w, spinning, win }: { w: ReturnType<typeof useWheel>; spinning: boolean; win: number | null }) {
  return (
    <div className={`rw3-scene ${spinning ? 'spinning' : ''} ${win != null && !spinning ? 'settled' : ''}`}>
      <div className="rw3-tilt">
        <Layers n={7} cls="rw3-edge" gap={2.6} />
        <div className="rw3-bowl">
          <div className="rw3-track" />
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className={`rw3-diamond ${i % 2 ? 'h' : 'v'}`} style={{ '--a': `${i * 45 + 22.5}deg` } as CSSProperties} />
          ))}
          <div className="rw3-rotor" ref={w.rotor}>
            <RotorSvg win={spinning ? null : win} />
            <div className="rw3-turret">
              <Layers n={5} cls="rw3-tlayer" gap={-3} />
              <div className="rw3-cross">
                {[0, 90, 180, 270].map((d) => (
                  <span key={d} className="rw3-arm" style={{ transform: `rotate(${d}deg)` }}>
                    <i />
                  </span>
                ))}
                <b className="rw3-knob" />
              </div>
            </div>
          </div>
          <div className="rw3-ballshadow" ref={w.shadow} />
          <div className="rw3-ball" ref={w.ball} />
        </div>
      </div>
      <div className="rw3-floor" />
    </div>
  );
}

/* ─────────────────────────────── board ─────────────────────────────── */

function Cell({ k, label, cls, bets, onBet, win, span, settled }: { k: BetKey; label: string; cls: string; bets: Record<BetKey, number>; onBet: (k: BetKey) => void; win?: boolean; span?: string; settled: boolean }) {
  const amt = bets[k] ?? 0;
  const dolly = win && k.startsWith('straight');
  return (
    <button type="button" className={`rc ${cls} ${win ? 'rc-win' : ''}`} style={span ? { gridArea: span } : undefined} onClick={() => onBet(k)}>
      <span className="rc-label">{label}</span>
      {amt > 0 && <span className={`rchip ${settled ? (win ? 'won' : 'lost') : ''}`}>{amt >= 1000 ? `${Math.round(amt / 100) / 10}k` : amt % 1 ? amt.toFixed(2) : amt}</span>}
      {dolly && <span className="rdolly" aria-label="winning number" />}
    </button>
  );
}

function Board({ bets, onBet, last, disabled, settled }: { bets: Record<BetKey, number>; onBet: (k: BetKey) => void; last: number | null; disabled: boolean; settled: boolean }) {
  const rows = [3, 2, 1]; // top row = numbers ≡ 0 mod 3
  const winCover = (k: BetKey) => {
    if (last == null) return false;
    const [t, v] = k.split(':');
    const n = last;
    if (t === 'straight') return Number(v) === n;
    if (n === 0) return false;
    return (
      (t === 'red' && RED.has(n)) || (t === 'black' && !RED.has(n)) || (t === 'odd' && n % 2 === 1) || (t === 'even' && n % 2 === 0) ||
      (t === 'low' && n <= 18) || (t === 'high' && n >= 19) || (t === 'dozen' && Math.ceil(n / 12) === Number(v)) || (t === 'column' && ((n - 1) % 3) + 1 === Number(v))
    );
  };
  const p = { bets, onBet, settled };
  return (
    <div className={`rboard-wrap ${disabled ? 'locked' : ''} ${settled ? 'settled' : ''}`}>
      <div className="rboard felt">
        <Cell {...p} k="straight:0" label="0" cls="green zero" win={winCover('straight:0')} span="1 / 1 / 4 / 2" />
        {rows.map((r, ri) =>
          Array.from({ length: 12 }, (_, c) => {
            const n = c * 3 + r;
            return <Cell {...p} key={n} k={`straight:${n}`} label={String(n)} cls={color(n)} win={winCover(`straight:${n}`)} span={`${ri + 1} / ${c + 2} / ${ri + 2} / ${c + 3}`} />;
          })
        )}
        {rows.map((r, ri) => (
          <Cell {...p} key={`col${r}`} k={`column:${r}`} label="2:1" cls="outside" win={winCover(`column:${r}`)} span={`${ri + 1} / 14 / ${ri + 2} / 15`} />
        ))}
        {[1, 2, 3].map((d) => (
          <Cell {...p} key={`dz${d}`} k={`dozen:${d}`} label={['1st 12', '2nd 12', '3rd 12'][d - 1]} cls="outside" win={winCover(`dozen:${d}`)} span={`4 / ${2 + (d - 1) * 4} / 5 / ${6 + (d - 1) * 4}`} />
        ))}
        {(
          [
            ['low', '1–18'],
            ['even', 'Even'],
            ['red', ''],
            ['black', ''],
            ['odd', 'Odd'],
            ['high', '19–36'],
          ] as const
        ).map(([k, l], i) => (
          <Cell {...p} key={k} k={k} label={l} cls={`outside ${k === 'red' ? 'red diamond' : k === 'black' ? 'black diamond' : ''}`} win={winCover(k)} span={`5 / ${2 + i * 2} / 6 / ${4 + i * 2}`} />
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────── game ─────────────────────────────── */

export function RouletteGame() {
  const bet = useBet();
  const wheel = useWheel();
  const [chip, setChip] = useState(1);
  const [bets, setBets] = useState<Record<BetKey, number>>({});
  const [stack, setStack] = useState<{ k: BetKey; a: number }[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [last, setLast] = useState<number | null>(null);
  const [settled, setSettled] = useState(false); // result shown, chips still on the felt
  const [history, setHistory] = useState<{ n: number; id: number }[]>([]);
  const [outcome, setOutcome] = useState<{ n: number; returned: number; total: number } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const lastBets = useRef<Record<BetKey, number>>({});

  const total = useMemo(() => Math.round(Object.values(bets).reduce((a, b) => a + b, 0) * 100) / 100, [bets]);

  /** first action after a result clears the felt */
  const fresh = () => {
    if (!settled) return false;
    setSettled(false);
    setOutcome(null);
    setLast(null);
    return true;
  };
  const place = (k: BetKey) => {
    if (spinning) return;
    const reset = fresh();
    sfx.chip();
    setBets((b) => {
      const base = reset ? {} : b;
      return { ...base, [k]: Math.round(((base[k] ?? 0) + chip) * 100) / 100 };
    });
    setStack((s) => [...(reset ? [] : s), { k, a: chip }]);
  };
  const undo = () => {
    if (fresh()) return clear();
    const top = stack[stack.length - 1];
    if (!top) return;
    sfx.click();
    setStack((s) => s.slice(0, -1));
    setBets((b) => {
      const v = Math.round(((b[top.k] ?? 0) - top.a) * 100) / 100;
      const n = { ...b };
      if (v <= 0) delete n[top.k];
      else n[top.k] = v;
      return n;
    });
  };
  const clear = () => {
    fresh();
    sfx.click();
    setBets({});
    setStack([]);
  };
  const rebet = () => {
    fresh();
    sfx.chip();
    setBets({ ...lastBets.current });
    setStack(Object.entries(lastBets.current).map(([k, a]) => ({ k, a })));
  };

  async function spin() {
    if (!total) return bet.toast('info', 'Place a chip on the table first');
    if (!bet.ensure(total)) return;
    const list = Object.entries(bets).map(([k, amount]) => {
      const [type, v] = k.split(':');
      return { type, ...(v != null ? { value: Number(v) } : {}), amount };
    });
    setSpinning(true);
    setSettled(false);
    setOutcome(null);
    setLast(null);
    bet.debit(total);
    sfx.bet();
    try {
      const res = await casino.play<RouletteResult>('roulette', { bets: list });
      lastBets.current = { ...bets };
      await wheel.spin(res.result.pocket);
      setLast(res.result.number);
      setSettled(true);
      setHistory((h) => [{ n: res.result.number, id: Date.now() }, ...h].slice(0, 16));
      setOutcome({ n: res.result.number, returned: res.result.returned, total });
      bet.setBalance(res.balance);
      setRefresh((x) => x + 1);
      setTimeout(() => resultSound(total ? res.result.returned / total : 0), 250);
    } catch (e) {
      bet.fail(e);
    } finally {
      setSpinning(false);
    }
  }

  const hasLast = Object.keys(lastBets.current).length > 0;

  return (
    <GameShell
      game="roulette"
      refreshKey={refresh}
      controls={
        <>
          <span className="field-label">Chip value</span>
          <div className="chip-picker">
            {CHIPS.map((c) => (
              <button key={c} className={`chip-sel c${String(c).replace('.', '_')} ${chip === c ? 'on' : ''}`} onClick={() => (sfx.chip(), setChip(c))} disabled={spinning}>
                {c < 1 ? c.toFixed(1) : c}
              </button>
            ))}
          </div>
          <InfoRow label="Total bet" value={usd(total)} />
          <div className="btn-pair three">
            <button className="btn btn-ghost btn-sm" onClick={undo} disabled={spinning || !stack.length}>
              <LuUndo2 size={15} /> Undo
            </button>
            <button className="btn btn-ghost btn-sm" onClick={clear} disabled={spinning || !total}>
              <LuTrash2 size={15} /> Clear
            </button>
            <button className="btn btn-ghost btn-sm" onClick={rebet} disabled={spinning || !hasLast}>
              <LuRotateCcw size={15} /> Rebet
            </button>
          </div>
          <PlayButton busy={spinning} onClick={spin} disabled={!total}>
            {settled ? 'Spin again' : 'Spin'}
          </PlayButton>
          <small className="muted">European roulette · single zero · straight up pays 35:1 · 97.3% RTP</small>
        </>
      }
      stage={
        <div className="roulette-stage">
          <div className="rl-top">
            <Wheel w={wheel} spinning={spinning} win={last} />
            <div className="rl-side">
              <div className="rl-history">
                {history.map((h) => (
                  <span key={h.id} className={`rlh ${color(h.n)}`}>
                    {h.n}
                  </span>
                ))}
              </div>
            </div>
            {outcome && (
              <div className={`rl-result ${color(outcome.n)} ${outcome.returned > outcome.total ? 'is-win' : ''}`}>
                <b>{outcome.n}</b>
                <span>{outcome.n === 0 ? 'ZERO' : `${color(outcome.n).toUpperCase()} · ${outcome.n % 2 ? 'ODD' : 'EVEN'}`}</span>
              </div>
            )}
          </div>
          <Board bets={bets} onBet={place} last={last} disabled={spinning} settled={settled} />
          {outcome && (
            <div className={`stage-banner ${outcome.returned > outcome.total ? 'win' : outcome.returned > 0 ? 'push' : 'loss'}`}>
              {outcome.n} {color(outcome.n)} · {outcome.returned > 0 ? `returned ${usd(outcome.returned)}` : 'no win'}
            </div>
          )}
        </div>
      }
    />
  );
}
