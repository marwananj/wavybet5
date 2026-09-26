import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LuUndo2, LuTrash2, LuRotateCcw, LuMinus, LuPlus, LuZap } from 'react-icons/lu';
import { usd } from '../../lib/format';
import { casino } from '../api';
import { ActionBar, GameShell, InfoRow, PlayButton, Seg, useBet, useMedia } from '../shared';
import { ANNOUNCED, color, covered, HOTSPOTS, k as K, neighbours, ORDER, PAYS, RED, toApi, type BetKey } from '../rouletteBets';
import { Racetrack } from './Racetrack';
import { resultSound, rollLoop, sfx, speak } from '../sound';
import { HoldemDealer, type DealerMood } from './HoldemDealer';

const STEP = 360 / 37;
const CHIPS = [0.1, 0.5, 1, 5, 10, 25, 100];

type Mode = 'classic' | 'thunder';
interface Strike {
  number: number;
  multiplier: number;
}
interface RouletteResult {
  number: number;
  color: string;
  pocket: number;
  returned: number;
  mode: Mode;
  lucky: Strike[];
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
const T_SPIRAL = 0.55; // spirals down the bowl and hits a deflector
const T_WHEEL = 9; // rotor coasts to rest
const LIFT = 0.35; // dealer launches the ball from the pocket onto the track
const RING_R = 34.5; // first contact with the rotor (number ring / fret tops)

/* ease with a non-zero end speed: the ball is still travelling when it leaves the track */
const easeOutKeep = (v: number) => (1.6 * v - 0.6 * v * v);

interface Hop {
  from: number; // relative angle at take-off
  to: number; // relative angle at landing
  t0: number;
  dur: number;
  h: number; // height of the hop (px in 3D)
  r: number; // radial pop (in % of bowl) toward the number ring
}

/** A realistic landing: 3–5 hops over the frets, each shorter and lower, the last one into the winning pocket. */
function planHops(start: number, end: number, tStart: number) {
  const hops: Hop[] = [];
  const n = 3 + Math.floor(Math.random() * 3); // 3..5
  // displacement of every hop in pockets (first ones big, mostly in the travel direction (-), some kick back (+))
  const d: number[] = [];
  for (let i = 0; i < n; i++) {
    const size = (2.6 - i * 0.55) * (0.7 + Math.random() * 0.6);
    const back = i > 0 && Math.random() < 0.38;
    d.push(Math.max(0.35, size) * (back ? 1 : -1));
  }
  // scale so the hops end exactly on the winning pocket
  const want = end - start;
  const sum = d.reduce((x, y) => x + y, 0) * STEP;
  const fix = (want - sum) / n;
  let at = start;
  let t = tStart;
  for (let i = 0; i < n; i++) {
    const dur = Math.max(0.1, 0.36 - i * 0.065) * (0.9 + Math.random() * 0.2);
    const to = i === n - 1 ? end : at + d[i] * STEP + fix;
    hops.push({ from: at, to, t0: t, dur, h: Math.max(1.5, 16 - i * 4) * (0.8 + Math.random() * 0.4), r: Math.max(0.6, 4.5 - i * 1.1) });
    at = to;
    t += dur;
  }
  // tiny rattle inside the pocket
  hops.push({ from: end, to: end + STEP * 0.12, t0: t, dur: 0.07, h: 1.2, r: 0.3 });
  hops.push({ from: end + STEP * 0.12, to: end, t0: t + 0.07, dur: 0.06, h: 0.6, r: 0.15 });
  return { hops, tLock: t + 0.13 };
}

/* ─────────────────────────────── rotor art ────────────────────────────── */

function RotorSvg({ win, lucky }: { win: number | null; lucky: Map<number, number> }) {
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
      {[...lucky.keys()].map((n) => {
        const i = ORDER.indexOf(n);
        return (
          <g key={`l${n}`} className="r3-lucky">
            <path d={arc((i - 0.5) * STEP, (i + 0.5) * STEP, 132, 199)} fill="#ffd24a" opacity=".55" filter="url(#r3-glow)" />
            <path d={arc((i - 0.5) * STEP, (i + 0.5) * STEP, 170, 199)} fill="none" stroke="#ffe28a" strokeWidth="3.5" />
          </g>
        );
      })}
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
  diamond: boolean;
  fret: number;
  t0: number;
  W0: number;
  Wd: number;
  rel0: number;
  relA: number; // where the ball leaves the track (relative angle)
  relB: number; // first contact with the rotor
  relEnd: number;
  R0: number;
  hops: Hop[];
  hop: number;
  tLock: number;
  locked: boolean;
  onLock: () => void;
}

function useWheel() {
  const rotor = useRef<HTMLDivElement>(null);
  const ball = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const cam = useRef<HTMLDivElement>(null);
  const z = useRef({ zoom: 1, tx: 0, ty: 0 });
  const s = useRef({ W: 0, rel: 0, R: POCKET_R, H: 0, visible: false, anim: null as Anim | null, roll: null as ReturnType<typeof rollLoop> | null, lastB: 0 });

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
        let H = 0; // ball height above the wheel (px)
        if (t < a.tLock) {
          let rel: number;
          let R: number;
          if (t < T_DROP) {
            // riding the track, slowing down
            rel = a.rel0 + (a.relA - a.rel0) * easeOutKeep(t / T_DROP);
            if (t < LIFT) R = a.R0 + (TRACK_R - a.R0) * (t / LIFT);
            else R = TRACK_R - Math.pow((t - LIFT) / (T_DROP - LIFT), 6) * 1.2;
          } else if (t < T_DROP + T_SPIRAL) {
            // spirals down the bowl, clips a diamond and pops up
            const k = (t - T_DROP) / T_SPIRAL;
            rel = a.relA + (a.relB - a.relA) * (1 - Math.pow(1 - k, 1.6));
            const r0 = TRACK_R - 1.2;
            R = r0 - (r0 - RING_R) * k * k;
            if (k > 0.35 && k < 0.8) {
              const q = (k - 0.35) / 0.45;
              H = Math.sin(q * Math.PI) * 14; // deflector kick
              R += Math.sin(q * Math.PI) * 1.4;
            }
            if (!a.diamond && k > 0.35) {
              a.diamond = true;
              sfx.diamond();
            }
          } else {
            // hops over the frets into the pocket
            let i = a.hop;
            while (i < a.hops.length - 1 && t >= a.hops[i].t0 + a.hops[i].dur) i++;
            const hp = a.hops[i];
            if (i !== a.hop) {
              a.hop = i;
              sfx.bounce(Math.max(0.2, 1 - i * 0.2)); // landing clack on a fret / pocket
            }
            const q = Math.min(1, Math.max(0, (t - hp.t0) / hp.dur));
            rel = hp.from + (hp.to - hp.from) * q;
            const arc = 4 * q * (1 - q);
            H = hp.h * arc;
            // pockets are lower than the number ring: the ball sinks inward as the hops die out
            const base = i === 0 ? RING_R + (POCKET_R - RING_R) * q : POCKET_R;
            R = base + hp.r * arc;
            // every fret it passes clicks
            const pocketNow = Math.floor((rel + STEP / 2) / STEP);
            if (a.fret !== pocketNow) {
              if (a.fret !== -9999 && H < 3) sfx.fret(Math.max(0.2, 0.8 - i * 0.15));
              a.fret = pocketNow;
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
            sfx.settle();
            a.onLock();
          }
        }
        st.H = H;
        if (u >= 1) st.anim = null;
        // rolling noise follows the ball's speed over the bowl
        const B = st.W + st.rel;
        const speed = Math.abs(B - st.lastB) / Math.max(dt, 1e-3);
        st.lastB = B;
        if (st.roll) st.roll.set(t < T_DROP ? speed / 900 : t < T_DROP + T_SPIRAL ? (speed / 900) * 0.7 : 0.08);
      } else {
        st.W += 7 * dt; // idle drift like a live table
      }
      const B = ((st.W + st.rel) * Math.PI) / 180;
      if (rotor.current) rotor.current.style.transform = `rotate(${st.W}deg)`;
      const x = 50 + st.R * Math.sin(B);
      const y = 50 - st.R * Math.cos(B);
      // TV close-up: the camera pushes in on the ball as it drops, holds on the pocket, then pulls back
      {
        const at = a ? (now - a.t0) / 1000 : 99;
        const want = a && at > T_DROP - 0.3 && at < a.tLock + 2.2 ? 1.55 : 1;
        const zz = z.current;
        zz.zoom += (want - zz.zoom) * (want > zz.zoom ? 0.045 : 0.06);
        const k = (zz.zoom - 1) / 0.55; // 0‥1
        const W = (cam.current?.firstElementChild as HTMLElement | null)?.offsetWidth ?? 360;
        zz.tx += (((50 - x) / 100) * W * zz.zoom * k * 0.85 - zz.tx) * 0.12;
        zz.ty += (((50 - y) / 100) * W * 0.64 * zz.zoom * k * 0.85 - zz.ty) * 0.12; // 0.64 ≈ cos(tilt): vertical is foreshortened
        if (cam.current) cam.current.style.transform = `translate(${zz.tx.toFixed(1)}px, ${zz.ty.toFixed(1)}px) scale(${zz.zoom.toFixed(3)})`;
      }
      if (ball.current) {
        ball.current.style.left = `${x}%`;
        ball.current.style.top = `${y}%`;
        ball.current.style.opacity = st.visible ? '1' : '0';
        ball.current.style.setProperty('--bz', `${(6 + st.H).toFixed(1)}px`);
      }
      if (shadow.current) {
        shadow.current.style.left = `${x}%`;
        shadow.current.style.top = `${y + 0.8}%`;
        shadow.current.style.opacity = st.visible ? String(Math.max(0.25, 1 - st.H / 24)) : '0';
        shadow.current.style.setProperty('--ss', (1.25 + st.H / 30).toFixed(2));
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
      const tHops = T_DROP + T_SPIRAL;
      // work backwards from the winning pocket: hops, then the spiral, then the track
      const spiral = -(55 + Math.random() * 25);
      const hopTravel = -(4 + Math.random() * 5) * STEP; // total drift of the hops (pockets)
      const relB = relEnd - hopTravel;
      const relA = relB - spiral;
      const plan = planHops(relB, relEnd, tHops);
      st.anim = {
        t0: performance.now(),
        W0: st.W,
        Wd: 360 * 2 + 120 + Math.random() * 180,
        rel0,
        relA,
        relB,
        relEnd,
        R0: st.visible ? st.R : TRACK_R,
        hops: plan.hops,
        hop: 0,
        tLock: plan.tLock,
        locked: false,
        fret: -9999,
        diamond: false,
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

  return { rotor, ball, shadow, cam, spin };
}

function Wheel({ w, spinning, win, lucky, thunder }: { w: ReturnType<typeof useWheel>; spinning: boolean; win: number | null; lucky: Map<number, number>; thunder: boolean }) {
  return (
    <div className="rw3-view">
      <div className="rw3-cam" ref={w.cam}>
    <div className={`rw3-scene ${spinning ? 'spinning' : ''} ${win != null && !spinning ? 'settled' : ''} ${thunder ? 'thunder' : ''}`}>
      <div className="rw3-tilt">
        <Layers n={7} cls="rw3-edge" gap={2.6} />
        <div className="rw3-bowl">
          <div className="rw3-track" />
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className={`rw3-diamond ${i % 2 ? 'h' : 'v'}`} style={{ '--a': `${i * 45 + 22.5}deg` } as CSSProperties} />
          ))}
          <div className="rw3-rotor" ref={w.rotor}>
            <RotorSvg win={spinning ? null : win} lucky={lucky} />
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
      </div>
    </div>
  );
}


/* ─────────────────────────────── table ─────────────────────────────── */

const chipLabel = (amt: number) => (amt >= 1000 ? `${Math.round(amt / 100) / 10}k` : amt % 1 ? amt.toFixed(amt < 1 ? 1 : 2).replace(/0$/, '') : String(amt));

/** grid-area for every bet spot — wide table on desktop, tall 5-column table on phones */
const LAYOUT = {
  wide: {
    zero: '1 / 1 / 4 / 2',
    num: (n: number) => {
      const ri = 3 - (((n - 1) % 3) + 1); // top row holds 3, 6, 9 …
      const c = Math.floor((n - 1) / 3);
      return `${ri + 1} / ${c + 2} / ${ri + 2} / ${c + 3}`;
    },
    col: (c: number) => `${4 - c} / 14 / ${5 - c} / 15`,
    dozen: (d: number) => `4 / ${2 + (d - 1) * 4} / 5 / ${6 + (d - 1) * 4}`,
    out: (i: number) => `5 / ${2 + i * 2} / 6 / ${4 + i * 2}`,
    hot: '1 / 2 / 4 / 14',
    pos: (u: number, v: number) => ({ left: `${(u / 12) * 100}%`, top: `${(1 - v / 3) * 100}%` }),
  },
  tall: {
    zero: '1 / 3 / 2 / 6',
    num: (n: number) => {
      const r = Math.ceil(n / 3) + 1;
      const c = 3 + ((n - 1) % 3);
      return `${r} / ${c} / ${r + 1} / ${c + 1}`;
    },
    col: (c: number) => `14 / ${2 + c} / 15 / ${3 + c}`,
    dozen: (d: number) => `${2 + (d - 1) * 4} / 2 / ${6 + (d - 1) * 4} / 3`,
    out: (i: number) => `${2 + i * 2} / 1 / ${4 + i * 2} / 2`,
    hot: '2 / 3 / 14 / 6',
    pos: (u: number, v: number) => ({ left: `${(v / 3) * 100}%`, top: `${(u / 12) * 100}%` }),
  },
};

interface TableProps {
  bets: Record<BetKey, number>;
  onBet: (k: BetKey) => void;
  last: number | null;
  settled: boolean;
  tall: boolean;
  hover: Set<number>;
  onHover: (nums: number[] | null) => void;
  lucky: Map<number, number>;
}

function Cell({ k, label, cls, span, t }: { k: BetKey; label: string; cls: string; span: string; t: TableProps }) {
  const amt = t.bets[k] ?? 0;
  const nums = covered(k);
  const straight = k.startsWith('straight:');
  const n = straight ? nums[0] : null;
  const win = t.last != null && nums.includes(t.last);
  const hl = nums.length > 0 && nums.every((x) => t.hover.has(x));
  const lucky = n != null ? t.lucky.get(n) : undefined;
  return (
    <button
      type="button"
      data-n={n ?? undefined}
      className={`rc ${cls} ${win ? 'rc-win' : ''} ${hl ? 'hl' : ''} ${lucky ? 'lucky' : ''}`}
      style={{ gridArea: span }}
      onClick={() => t.onBet(k)}
      onPointerEnter={() => t.onHover(nums)}
      title={`${label || k} · pays ${PAYS[k.split(':')[0]]}:1`}
    >
      <span className="rc-label">{label}</span>
      {lucky && <span className="rc-lucky">{lucky}×</span>}
      {amt > 0 && <span className={`rchip ${t.settled ? (win ? 'won' : 'lost') : ''}`}>{chipLabel(amt)}</span>}
      {win && straight && <span className="rdolly" aria-label="winning number" />}
    </button>
  );
}

function Table(t: TableProps & { disabled: boolean }) {
  const L = t.tall ? LAYOUT.tall : LAYOUT.wide;
  return (
    <div className={`rboard-wrap ${t.disabled ? 'locked' : ''} ${t.settled ? 'settled' : ''}`} onPointerLeave={() => t.onHover(null)}>
      <div className={`rboard felt ${t.tall ? 'tall' : ''}`}>
        <Cell t={t} k={K.straight(0)} label="0" cls="green zero" span={L.zero} />
        {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => (
          <Cell t={t} key={n} k={K.straight(n)} label={String(n)} cls={color(n)} span={L.num(n)} />
        ))}
        {[1, 2, 3].map((c) => (
          <Cell t={t} key={`col${c}`} k={`column:${c}`} label="2:1" cls="outside" span={L.col(c)} />
        ))}
        {[1, 2, 3].map((d) => (
          <Cell t={t} key={`dz${d}`} k={`dozen:${d}`} label={['1st 12', '2nd 12', '3rd 12'][d - 1]} cls="outside dozen" span={L.dozen(d)} />
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
        ).map(([key, l], i) => (
          <Cell t={t} key={key} k={key} label={l} cls={`outside ${key === 'red' ? 'red diamond' : key === 'black' ? 'black diamond' : ''}`} span={L.out(i)} />
        ))}
        {/* split / street / corner / six-line spots sit on the lines between numbers */}
        <div className="rb-hot" style={{ gridArea: L.hot }}>
          {HOTSPOTS.map((h) => {
            const amt = t.bets[h.key] ?? 0;
            const nums = covered(h.key);
            const win = t.last != null && nums.includes(t.last);
            return (
              <button
                key={h.key}
                type="button"
                className={`hs ${h.kind} ${amt ? 'has' : ''}`}
                style={L.pos(h.u, h.v)}
                onClick={() => t.onBet(h.key)}
                onPointerEnter={() => t.onHover(nums)}
                aria-label={`${h.kind} ${nums.join(', ')}`}
                title={`${h.kind} ${nums.join('/')} · pays ${PAYS[h.kind]}:1`}
              >
                {amt > 0 && <span className={`rchip mini ${t.settled ? (win ? 'won' : 'lost') : ''}`}>{chipLabel(amt)}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── lightning ─────────────────────────────── */

interface Bolt {
  id: number;
  d: string;
  branch: string;
  w: number;
  h: number;
  x: number;
  y: number;
}
function makeBolt(w: number, h: number, x: number, y: number): Bolt {
  const x0 = x + (Math.random() - 0.5) * w * 0.5;
  const seg = 9;
  const pts: [number, number][] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const jitter = i === 0 || i === seg ? 0 : (Math.random() - 0.5) * 60 * (1 - t * 0.6);
    pts.push([x0 + (x - x0) * t + jitter, -20 + (y + 20) * t]);
  }
  const d = 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join(' L');
  const b0 = pts[3];
  const branch = `M${b0[0].toFixed(1)} ${b0[1].toFixed(1)} L${(b0[0] + 40).toFixed(1)} ${(b0[1] + 50).toFixed(1)} L${(b0[0] + 28).toFixed(1)} ${(b0[1] + 90).toFixed(1)}`;
  return { id: Math.random(), d, branch, w, h, x, y };
}

/* ─────────────────────────────── game ─────────────────────────────── */

type Phase = 'bets' | 'closed' | 'strike' | 'spin' | 'result';
const PHASE_TEXT: Record<Phase, string> = { bets: 'Place your bets', closed: 'No more bets', strike: 'Lightning strikes', spin: 'No more bets', result: '' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function RouletteGame() {
  const bet = useBet();
  const wheel = useWheel();
  const tall = useMedia('(max-width: 559px)');
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return (localStorage.getItem('wb_roulette_mode') as Mode) || 'classic';
    } catch {
      return 'classic';
    }
  });
  const [chip, setChip] = useState(1);
  const [bets, setBets] = useState<Record<BetKey, number>>({});
  const [stack, setStack] = useState<{ k: BetKey; a: number }[][]>([]);
  const [phase, setPhase] = useState<Phase>('bets');
  const [last, setLast] = useState<number | null>(null);
  const [settled, setSettled] = useState(false); // result shown, chips still on the felt
  const [history, setHistory] = useState<{ n: number; id: number; x?: number }[]>([]);
  const [outcome, setOutcome] = useState<{ n: number; returned: number; total: number; boost?: number } | null>(null);
  const [lucky, setLucky] = useState<Map<number, number>>(new Map());
  const [bolts, setBolts] = useState<Bolt[]>([]);
  const [flash, setFlash] = useState(0);
  const [hover, setHover] = useState<Set<number>>(new Set());
  const [count, setCount] = useState(2); // neighbours either side
  const [view, setView] = useState<'table' | 'track'>('table');
  const [refresh, setRefresh] = useState(0);
  const lastBets = useRef<Record<BetKey, number>>({});
  const top = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const spinning = phase !== 'bets' && phase !== 'result';
  const thunder = mode === 'thunder';
  // live croupier
  const [talk, setTalk] = useState<{ line: string; mood: DealerMood; key: number }>({ line: 'Welcome! Place your bets, please.', mood: 'idle', key: 0 });
  const say = (line: string, mood: DealerMood = 'talk', voice?: string) => {
    setTalk((t) => ({ line, mood, key: t.key + 1 }));
    if (voice) speak(voice, { rate: 0.98 });
    if (mood === 'talk') setTimeout(() => setTalk((t) => (t.line === line ? { ...t, mood: 'idle' } : t)), 1500);
  };

  const total = useMemo(() => Math.round(Object.values(bets).reduce((a, b) => a + b, 0) * 100) / 100, [bets]);
  const straightChips = useMemo(() => {
    const m = new Map<number, number>();
    Object.entries(bets).forEach(([key, a]) => key.startsWith('straight:') && m.set(Number(key.slice(9)), a));
    return m;
  }, [bets]);

  useEffect(() => {
    try {
      localStorage.setItem('wb_roulette_mode', mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  /** first action after a result clears the felt */
  const fresh = () => {
    if (!settled) return false;
    setSettled(false);
    setOutcome(null);
    setLast(null);
    setLucky(new Map());
    setPhase('bets');
    say('Place your bets, please.', 'idle');
    return true;
  };
  const placeMany = (items: [BetKey, number][]) => {
    if (spinning || !items.length) return;
    const reset = fresh();
    sfx.chip();
    if (items.length > 1) setTimeout(() => sfx.chip(), 70);
    const group = items.map(([key, units]) => ({ k: key, a: Math.round(chip * units * 100) / 100 }));
    setBets((b) => {
      const next = { ...(reset ? {} : b) };
      for (const g of group) next[g.k] = Math.round(((next[g.k] ?? 0) + g.a) * 100) / 100;
      return next;
    });
    setStack((s) => [...(reset ? [] : s), group]);
  };
  const place = (key: BetKey) => placeMany([[key, 1]]);
  const placeNeighbours = (n: number) => placeMany(neighbours(n, count).map((x) => [K.straight(x), 1]));
  const placeSection = (id: string) => placeMany(ANNOUNCED[id].chips);

  const clear = () => {
    fresh();
    sfx.click();
    setBets({});
    setStack([]);
  };
  const undo = () => {
    if (fresh()) return clear();
    const g = stack[stack.length - 1];
    if (!g) return;
    sfx.click();
    setStack((s) => s.slice(0, -1));
    setBets((b) => {
      const next = { ...b };
      for (const { k: key, a } of g) {
        const v = Math.round(((next[key] ?? 0) - a) * 100) / 100;
        if (v <= 0) delete next[key];
        else next[key] = v;
      }
      return next;
    });
  };
  const rebet = () => {
    fresh();
    sfx.chip();
    setBets({ ...lastBets.current });
    setStack([Object.entries(lastBets.current).map(([key, a]) => ({ k: key, a }))]);
  };
  const double = () => {
    if (!total) return;
    fresh();
    sfx.chip();
    setStack((s) => [...s, Object.entries(bets).map(([key, a]) => ({ k: key, a }))]);
    setBets((b) => Object.fromEntries(Object.entries(b).map(([key, a]) => [key, Math.round(a * 200) / 100])));
  };

  const strike = (n: number) => {
    const st = stage.current;
    if (!st) return;
    const target = st.querySelector(`.rc[data-n="${n}"]`) ?? st.querySelector(`.rt-cell[data-n="${n}"]`);
    const sr = st.getBoundingClientRect();
    let x = sr.width / 2;
    let y = sr.height / 2;
    if (target) {
      const r = target.getBoundingClientRect();
      x = r.left - sr.left + r.width / 2;
      y = r.top - sr.top + r.height / 2;
    }
    const b = makeBolt(sr.width, sr.height, x, y);
    setBolts((list) => [...list, b]);
    setFlash((f) => f + 1);
    sfx.thunder();
    setTimeout(() => setBolts((list) => list.filter((z) => z.id !== b.id)), 900);
  };

  async function spin() {
    if (!total) return bet.toast('info', 'Place a chip on the table first');
    if (!bet.ensure(total)) return;
    const list = Object.entries(bets).map(([key, amount]) => toApi(key, amount));
    const placed = { ...bets };
    setPhase('closed');
    say('No more bets!', 'talk', 'No more bets.');
    setSettled(false);
    setOutcome(null);
    setLast(null);
    setLucky(new Map());
    bet.debit(total);
    sfx.bet();
    try {
      const res = await casino.play<RouletteResult>('roulette', { bets: list, mode });
      lastBets.current = placed;
      const strikes = res.result.lucky ?? [];
      if (strikes.length) {
        setPhase('strike');
        await sleep(350);
        const m = new Map<number, number>();
        for (const s of strikes) {
          strike(s.number);
          m.set(s.number, s.multiplier);
          setLucky(new Map(m));
          await sleep(620);
        }
        await sleep(300);
      }
      setPhase('spin');
      say('Good luck, everyone…', 'idle');
      if (tall) top.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await wheel.spin(res.result.pocket);
      const n = res.result.number;
      const boost = strikes.find((s) => s.number === n && placed[K.straight(n)])?.multiplier;
      setLast(n);
      setSettled(true);
      setPhase('result');
      setHistory((h) => [{ n, id: Date.now(), x: strikes.find((s) => s.number === n)?.multiplier }, ...h].slice(0, 18));
      setOutcome({ n, returned: res.result.returned, total, boost });
      {
        const col = n === 0 ? 'zero' : color(n);
        const won = res.result.returned > 0;
        const call = n === 0 ? 'Zero, green.' : `${n}, ${col}.`;
        say(
          won ? `${n === 0 ? 'Zero' : `${n} ${col}`} — winner! ${usd(res.result.returned)} for you.` : `${n === 0 ? 'Zero' : `${n} ${col}`}. Place your bets for the next spin.`,
          won ? 'happy' : 'idle',
          won ? `${call} Congratulations!` : call
        );
      }
      bet.setBalance(res.balance);
      setRefresh((x) => x + 1);
      setTimeout(() => (boost ? (sfx.thunder(), setFlash((f) => f + 1), sfx.bigWin()) : resultSound(total ? res.result.returned / total : 0)), 250);
    } catch (e) {
      setPhase('bets');
      bet.fail(e);
    }
  }

  const hasLast = Object.keys(lastBets.current).length > 0;
  const onHover = (nums: number[] | null) => setHover(new Set(nums ?? []));
  const tableProps: TableProps = { bets, onBet: place, last, settled, tall, hover, onHover, lucky };
  const stats = useMemo(() => {
    if (!history.length) return null;
    const r = history.filter((h) => color(h.n) === 'red').length;
    const z = history.filter((h) => h.n === 0).length;
    return { r: (r / history.length) * 100, z: (z / history.length) * 100, b: ((history.length - r - z) / history.length) * 100 };
  }, [history]);

  const track = (
    <div className="rt-wrap">
      <div className="rt-head">
        <span>Racetrack</span>
        <div className="rt-count">
          <small>Neighbours</small>
          <button type="button" className="mini-btn" onClick={() => (sfx.click(), setCount((c) => Math.max(1, c - 1)))} disabled={count <= 1} aria-label="Fewer neighbours">
            <LuMinus size={14} />
          </button>
          <b>{count}</b>
          <button type="button" className="mini-btn" onClick={() => (sfx.click(), setCount((c) => Math.min(5, c + 1)))} disabled={count >= 5} aria-label="More neighbours">
            <LuPlus size={14} />
          </button>
        </div>
      </div>
      <div className={spinning ? 'locked' : ''}>
        <Racetrack tall={tall} count={count} hover={hover} lucky={lucky} win={last} onNumber={placeNeighbours} onSection={placeSection} onHover={onHover} chips={straightChips} />
      </div>
      <small className="muted rt-hint">
        Tap a number to bet it with {count} neighbour{count > 1 ? 's' : ''} each side ({count * 2 + 1} chips). Voisins 9 chips · Tier 6 · Orphelins 5 · Zero 4.
      </small>
    </div>
  );

  return (
    <GameShell
      game="roulette"
      refreshKey={refresh}
      className={thunder ? 'is-thunder' : ''}
      controls={
        <>
          <span className="field-label">Table</span>
          <Seg
            value={mode}
            onChange={(m) => (settled ? clear() : fresh(), setMode(m))}
            disabled={spinning}
            options={[
              { v: 'classic', label: 'Classic' },
              { v: 'thunder', label: '⚡ Thunder' },
            ]}
          />
          <InfoRow label="Total bet" value={usd(total)} />
          <ActionBar className="rl-bar">
            <span className="field-label hide-sm">Chip value</span>
            <div className="chip-picker">
              {CHIPS.map((c) => (
                <button key={c} className={`chip-sel c${String(c).replace('.', '_')} ${chip === c ? 'on' : ''}`} onClick={() => (sfx.chip(), setChip(c))} disabled={spinning}>
                  {c < 1 ? c.toFixed(1) : c}
                </button>
              ))}
            </div>
            <div className="rl-bar-row">
              <div className="btn-pair four">
                <button className="btn btn-ghost btn-sm" onClick={undo} disabled={spinning || !stack.length} aria-label="Undo" title="Undo">
                  <LuUndo2 size={15} /> <span className="hide-sm">Undo</span>
                </button>
                <button className="btn btn-ghost btn-sm" onClick={clear} disabled={spinning || !total} aria-label="Clear" title="Clear">
                  <LuTrash2 size={15} /> <span className="hide-sm">Clear</span>
                </button>
                <button className="btn btn-ghost btn-sm" onClick={rebet} disabled={spinning || !hasLast} aria-label="Rebet" title="Rebet">
                  <LuRotateCcw size={15} /> <span className="hide-sm">Rebet</span>
                </button>
                <button className="btn btn-ghost btn-sm" onClick={double} disabled={spinning || !total} aria-label="Double" title="Double all bets">
                  <b>2×</b>
                </button>
              </div>
              <PlayButton busy={spinning} onClick={spin} disabled={!total}>
                {settled ? 'Spin again' : 'Spin'}
                {total > 0 && <small className="pb-sub"> · {usd(total)}</small>}
              </PlayButton>
            </div>
          </ActionBar>
          <div className="rl-rules">
            {thunder ? (
              <>
                <b>
                  <LuZap size={13} /> Thunder Roulette
                </b>
                <span>1–5 lucky numbers are struck every round with 50× – 500×. A straight-up bet on a lucky number pays its multiplier; other straight-ups pay 29:1. All other bets pay as usual.</span>
              </>
            ) : (
              <>
                <b>European roulette</b>
                <span>Single zero. Straight 35:1 · Split 17:1 · Street 11:1 · Corner 8:1 · Six line 5:1 · Dozen/Column 2:1 · Even money 1:1. Tap the lines between numbers for splits, corners and streets.</span>
              </>
            )}
            <small>RTP 97.3%</small>
          </div>
        </>
      }
      stage={
        <div className={`roulette-stage live-table ${thunder ? 'thunder' : ''}`} ref={stage}>
          <div className="rl-livebar">
            <span className="rl-live">
              <i /> LIVE
            </span>
            <span className="rl-table-name">{thunder ? '⚡ Thunder Roulette' : 'Wavy Royale'}</span>
            <span className={`rl-phase p-${phase}`} key={phase}>
              {phase === 'result' && last != null ? `${last} ${color(last).toUpperCase()}` : PHASE_TEXT[phase]}
            </span>
          </div>
          <div className="rl-croupier">
            <HoldemDealer mood={talk.mood} line={talk.line} lineKey={talk.key} dealing={phase === 'closed' || phase === 'spin'} />
          </div>
          <div className="rl-top" ref={top}>
            <Wheel w={wheel} spinning={spinning} win={last} lucky={lucky} thunder={thunder} />
            <div className="rl-side">
              {thunder && lucky.size > 0 && (
                <div className="rl-lucky-strip">
                  {[...lucky.entries()].map(([n, x]) => (
                    <span key={n} className={`rls ${color(n)} ${last === n ? 'hit' : ''}`}>
                      <LuZap size={11} />
                      <b>{n}</b>
                      <em>{x}×</em>
                    </span>
                  ))}
                </div>
              )}
              <div className="rl-history">
                {history.map((h) => (
                  <span key={h.id} className={`rlh ${color(h.n)} ${h.x ? 'zap' : ''}`} title={h.x ? `${h.n} · lucky ${h.x}×` : String(h.n)}>
                    {h.n}
                  </span>
                ))}
              </div>
              {stats && (
                <div className="rl-stats" title="Red / zero / black this session">
                  <i className="red" style={{ width: `${stats.r}%` }} />
                  <i className="green" style={{ width: `${stats.z}%` }} />
                  <i className="black" style={{ width: `${stats.b}%` }} />
                </div>
              )}
            </div>
            {outcome && (
              <div className={`rl-result ${color(outcome.n)} ${outcome.returned > outcome.total ? 'is-win' : ''} ${outcome.boost ? 'is-zap' : ''}`}>
                <b>{outcome.n}</b>
                <span>{outcome.boost ? `⚡ ${outcome.boost}× LIGHTNING` : outcome.n === 0 ? 'ZERO' : `${color(outcome.n).toUpperCase()} · ${outcome.n % 2 ? 'ODD' : 'EVEN'}`}</span>
              </div>
            )}
          </div>
          {tall && (
            <div className="rl-viewtabs">
              <Seg
                value={view}
                onChange={setView}
                options={[
                  { v: 'table', label: 'Table' },
                  { v: 'track', label: 'Racetrack' },
                ]}
              />
            </div>
          )}
          {(!tall || view === 'table') && <Table {...tableProps} disabled={spinning} />}
          {(!tall || view === 'track') && track}
          <div className="bolt-layer" aria-hidden>
            {flash > 0 && <div key={flash} className="thunder-flash" />}
            {bolts.map((b) => (
              <svg key={b.id} className="bolt" viewBox={`0 0 ${b.w} ${b.h}`} preserveAspectRatio="none">
                <path d={b.d} className="bolt-glow" />
                <path d={b.d} className="bolt-core" />
                <path d={b.branch} className="bolt-core thin" />
                <circle cx={b.x} cy={b.y} r="26" className="bolt-hit" />
              </svg>
            ))}
          </div>
          {outcome && (
            <div className={`stage-banner ${outcome.returned > outcome.total ? 'win' : outcome.returned > 0 ? 'push' : 'loss'}`}>
              {outcome.boost ? `⚡ ${outcome.boost}× on ${outcome.n} · ` : `${outcome.n} ${color(outcome.n)} · `}
              {outcome.returned > 0 ? `returned ${usd(outcome.returned)}` : 'no win'}
            </div>
          )}
        </div>
      }
    />
  );
}
