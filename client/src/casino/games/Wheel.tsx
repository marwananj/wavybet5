import { useEffect, useMemo, useRef, useState } from 'react';
import { usd } from '../../lib/format';
import { casino, mult } from '../api';
import { BetAmount, GameShell, InfoRow, PlayButton, Seg, useBet, useCasinoConfig } from '../shared';
import { resultSound, sfx } from '../sound';

type Risk = 'easy' | 'medium' | 'hard';
interface WheelResult {
  index: number;
  multiplier: number;
  risk: Risk;
  segments: number;
}
const SEGMENTS = [10, 20, 30, 40, 50];
const SPIN_S = 4.6;

export const wheelColor = (m: number) =>
  m === 0 ? '#2b3260' : m < 1.4 ? '#c9d3ff' : m < 1.8 ? '#16c79a' : m < 2.5 ? '#ffd24a' : m < 9 ? '#ff8a3d' : '#ff3d6e';

function WheelArt({ table, win }: { table: number[]; win: number | null }) {
  const n = table.length;
  const seg = 360 / n;
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
  return (
    <svg viewBox="0 0 400 400" className="wh-svg" aria-hidden>
      <defs>
        <radialGradient id="wh-shine" cx="50%" cy="30%" r="75%">
          <stop offset="0" stopColor="rgba(255,255,255,.18)" />
          <stop offset=".6" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <radialGradient id="wh-hub" cx="45%" cy="35%" r="70%">
          <stop offset="0" stopColor="#27305f" />
          <stop offset="1" stopColor="#0c1030" />
        </radialGradient>
      </defs>
      <circle cx={C} cy={C} r="199" fill="#0b0f2a" />
      {table.map((m, i) => (
        <path
          key={i}
          d={arc((i - 0.5) * seg, (i + 0.5) * seg, 120, 186)}
          fill={wheelColor(m)}
          opacity={win == null || win === i ? 1 : 0.35}
          className={win === i ? 'wh-win' : ''}
          stroke="#0b0f2a"
          strokeWidth={n > 30 ? 1.2 : 2}
        />
      ))}
      <circle cx={C} cy={C} r="186" fill="url(#wh-shine)" />
      {/* studs */}
      {table.map((_, i) => {
        const [x, y] = pt((i - 0.5) * seg, 193);
        return <circle key={i} cx={x} cy={y} r="2.6" fill="#8fa2ff" opacity=".8" />;
      })}
      <circle cx={C} cy={C} r="120" fill="url(#wh-hub)" />
      <circle cx={C} cy={C} r="120" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="6" />
      <circle cx={C} cy={C} r="104" fill="none" stroke="rgba(143,162,255,.25)" strokeWidth="1.5" strokeDasharray="3 7" />
    </svg>
  );
}

export function WheelGame() {
  const bet = useBet();
  const cfg = useCasinoConfig();
  const [amount, setAmount] = useState('1.00');
  const [risk, setRisk] = useState<Risk>('medium');
  const [segments, setSegments] = useState(30);
  const [busy, setBusy] = useState(false);
  const [win, setWin] = useState<{ index: number; m: number } | null>(null);
  const [history, setHistory] = useState<{ m: number; id: number }[]>([]);
  const [refresh, setRefresh] = useState(0);
  const disc = useRef<HTMLDivElement>(null);
  const pointer = useRef<HTMLDivElement>(null);
  const rot = useRef(0);

  const table = useMemo(() => cfg?.wheel.tables[risk]?.[segments] ?? Array.from({ length: segments }, () => 0), [cfg, risk, segments]);
  const legend = useMemo(() => {
    const m = new Map<number, number>();
    table.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [table]);
  const stake = Number(amount) || 0;
  const maxM = Math.max(...table);

  // keep the disc aligned when switching tables
  useEffect(() => {
    if (disc.current) disc.current.style.transform = `rotate(${rot.current}deg)`;
    setWin(null);
  }, [risk, segments]);

  function animate(to: number, n: number) {
    return new Promise<void>((resolve) => {
      const from = rot.current;
      const seg = 360 / n;
      const t0 = performance.now();
      let lastIdx = Math.floor((from + seg / 2) / seg);
      let kick = 0;
      const frame = (now: number) => {
        const u = Math.min(1, (now - t0) / (SPIN_S * 1000));
        const e = 1 - Math.pow(1 - u, 4);
        const r = from + (to - from) * e;
        rot.current = r;
        if (disc.current) disc.current.style.transform = `rotate(${r}deg)`;
        const idx = Math.floor((r + seg / 2) / seg);
        if (idx !== lastIdx) {
          lastIdx = idx;
          const speed = (1 - u) ** 3;
          if (speed < 0.5 || Math.random() < 0.5) sfx.tick(1 + speed * 0.5);
          kick = Math.min(26, 10 + speed * 40);
        }
        kick *= 0.82;
        if (pointer.current) pointer.current.style.transform = `translateX(-50%) rotate(${-kick}deg)`;
        if (u < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  async function play() {
    if (!bet.ensure(stake)) return;
    setBusy(true);
    setWin(null);
    bet.debit(stake);
    sfx.bet();
    try {
      const res = await casino.play<WheelResult>('wheel', { stake, risk, segments });
      const n = res.result.segments;
      const seg = 360 / n;
      // segment i is centred at i·seg on the disc; bring it under the top pointer
      const cur = rot.current;
      const base = -res.result.index * seg + (Math.random() - 0.5) * seg * 0.7;
      let to = base + 360 * Math.ceil((cur - base) / 360); // first equivalent angle ≥ current
      to += 360 * 5;
      sfx.whoosh(0.6);
      await animate(to, n);
      setWin({ index: res.result.index, m: res.result.multiplier });
      setHistory((h) => [{ m: res.result.multiplier, id: Date.now() }, ...h].slice(0, 14));
      bet.setBalance(res.balance);
      setRefresh((r) => r + 1);
      resultSound(res.result.multiplier);
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <GameShell
      game="wheel"
      refreshKey={refresh}
      controls={
        <>
          <BetAmount value={amount} onChange={setAmount} disabled={busy} />
          <span className="field-label">Risk</span>
          <Seg
            value={risk}
            onChange={setRisk}
            disabled={busy}
            options={[
              { v: 'easy', label: 'Easy' },
              { v: 'medium', label: 'Medium' },
              { v: 'hard', label: 'Hard' },
            ]}
          />
          <span className="field-label">Segments</span>
          <Seg value={String(segments)} onChange={(v) => setSegments(Number(v))} disabled={busy} options={SEGMENTS.map((n) => ({ v: String(n), label: String(n) }))} />
          <PlayButton busy={busy} onClick={play}>
            Spin
          </PlayButton>
          <InfoRow label="Max multiplier" value={mult(maxM)} />
          <InfoRow label="Max profit" value={usd(stake * maxM - stake)} accent />
        </>
      }
      stage={
        <div className="wheel-stage">
          <div className="wh-history">
            {history.map((h) => (
              <span key={h.id} className="wh-pill" style={{ background: wheelColor(h.m), color: h.m > 0 && h.m < 2.5 ? '#0b0f2a' : '#fff' }}>
                {mult(h.m)}
              </span>
            ))}
          </div>
          <div className={`wh-scene ${busy ? 'spinning' : ''}`}>
            <div className="wh-tilt">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="wh-edge" style={{ transform: `translateZ(${-(i + 1) * 3}px)` }} />
              ))}
              <div className="wh-rim" />
              <div className="wh-disc" ref={disc}>
                <WheelArt table={table} win={busy ? null : win?.index ?? null} />
              </div>
              <div className="wh-center">
                {win ? (
                  <b key={win.index + '-' + history[0]?.id} className={win.m > 0 ? 'win' : ''} style={{ color: win.m > 0 ? wheelColor(win.m) : undefined }}>
                    {mult(win.m)}
                  </b>
                ) : (
                  <span>{busy ? 'Spinning…' : 'WAVY WHEEL'}</span>
                )}
              </div>
            </div>
            <div className="wh-pointer" ref={pointer}>
              <svg viewBox="0 0 40 52" aria-hidden>
                <path d="M20 50 L4 14 A17 17 0 1 1 36 14 Z" fill="#fff" />
                <path d="M20 44 L8 14 A13 13 0 1 1 32 14 Z" fill="#3ad0ff" />
                <circle cx="20" cy="16" r="5" fill="#fff" />
              </svg>
            </div>
          </div>
          <div className="wh-legend">
            {legend.map(([m, c]) => (
              <div key={m} className={`wh-leg ${win && !busy && win.m === m ? 'hit' : ''}`} style={{ borderColor: wheelColor(m) }}>
                <i style={{ background: wheelColor(m) }} />
                <b>{mult(m)}</b>
                <small>{((c / table.length) * 100).toFixed(c / table.length < 0.1 ? 1 : 0)}%</small>
              </div>
            ))}
          </div>
        </div>
      }
    />
  );
}
