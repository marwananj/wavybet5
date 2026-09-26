import { useEffect, useRef, useState } from 'react';
import { usd } from '../../lib/format';
import { casino } from '../api';
import { useAutoBet, type AutoResult } from '../autobet';
import { ActionBar, BetAmount, GameShell, InfoRow, PlayButton, Seg, useBet, useCasinoConfig } from '../shared';
import { sfx, resultSound } from '../sound';

type Risk = 'low' | 'medium' | 'high';
interface PlinkoResult {
  path: number[];
  bucket: number;
  multiplier: number;
  rows: number;
  risk: Risk;
}
interface Ball {
  path: number[];
  t0: number;
  bucket: number;
  mult: number;
  hue: number;
  done: boolean;
  onLand: () => void;
  lastRow: number;
}

const ROW_MS = 150; // time per row
const FALLBACK: Record<Risk, Record<number, number[]>> = {
  low: { 8: [5.64, 2.71, 1.38, 0.76, 0.52, 0.76, 1.38, 2.71, 5.64] },
  medium: { 8: [13, 3.7, 1.31, 0.59, 0.41, 0.59, 1.31, 3.7, 13] },
  high: { 8: [29, 4.9, 1.12, 0.36, 0.2, 0.36, 1.12, 4.9, 29] },
};

/** bucket colour: red at the edges → amber → yellow in the middle */
function bucketColor(i: number, n: number) {
  const d = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2); // 0 centre … 1 edge
  const h = 50 - d * 50; // 50 (yellow) → 0 (red)
  return `hsl(${h} 95% ${55 - d * 8}%)`;
}
const fmtM = (m: number) => (m >= 100 ? `${Math.round(m)}` : m >= 10 ? m.toFixed(1).replace(/\.0$/, '') : String(Math.round(m * 100) / 100));

export function PlinkoGame() {
  const bet = useBet();
  const cfg = useCasinoConfig() as unknown as { plinko?: { tables: Record<Risk, Record<number, number[]>> }; maxStake?: number } | null;
  const [amount, setAmount] = useState('1.00');
  const [risk, setRisk] = useState<Risk>('medium');
  const [rows, setRows] = useState(12);
  const [history, setHistory] = useState<{ m: number; id: number }[]>([]);
  const [hits, setHits] = useState<Record<number, number>>({}); // bucket → flash key
  const [refresh, setRefresh] = useState(0);
  const [inFlight, setInFlight] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const balls = useRef<Ball[]>([]);
  const geo = useRef({ w: 600, h: 520 });
  const seq = useRef(0);
  const lastBal = useRef(0);

  const table = cfg?.plinko?.tables?.[risk]?.[rows] ?? FALLBACK[risk][8];
  const nRows = cfg?.plinko ? rows : 8;
  const stake = Number(amount) || 0;
  const locked = inFlight > 0;

  /* geometry */
  const layout = (w: number, h: number, R: number) => {
    const top = 34;
    const bottom = h - 46;
    const gapY = (bottom - top) / R;
    const gapX = Math.min((w - 24) / (R + 2), gapY * 1.25);
    const cx = w / 2;
    const peg = (r: number, i: number) => ({ x: cx + (i - (r + 2) / 2) * gapX, y: top + r * gapY });
    return { top, bottom, gapX, gapY, cx, peg };
  };

  /* canvas render loop */
  useEffect(() => {
    let raf = 0;
    const draw = (now: number) => {
      const c = canvas.current;
      if (c) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = c.clientWidth;
        const h = c.clientHeight;
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
          c.width = Math.round(w * dpr);
          c.height = Math.round(h * dpr);
        }
        geo.current = { w, h };
        const g = c.getContext('2d')!;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        const L = layout(w, h, nRows);
        board.current?.style.setProperty('--gx', `${L.gapX}px`);
        // pegs
        for (let r = 0; r < nRows; r++) {
          for (let i = 0; i < r + 3; i++) {
            const p = L.peg(r, i);
            const grad = g.createRadialGradient(p.x - 1, p.y - 1, 0, p.x, p.y, 4.5);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(1, '#8b93b8');
            g.fillStyle = grad;
            g.beginPath();
            g.arc(p.x, p.y, Math.max(2.4, Math.min(4, L.gapX * 0.1)), 0, Math.PI * 2);
            g.fill();
          }
        }
        // balls
        const R = nRows;
        for (const b of balls.current) {
          const t = (now - b.t0) / ROW_MS; // rows travelled
          const row = Math.min(R, Math.floor(t));
          const f = Math.min(1, t - row);
          // position of the ball above peg row `row` (column = rights so far)
          let rights = 0;
          for (let i = 0; i < row && i < R; i++) rights += b.path[i];
          const from = row === 0 ? { x: L.cx, y: L.top - 22 } : { x: L.cx + (rights - row / 2) * L.gapX, y: L.top + (row - 1) * L.gapY + L.gapY * 0.5 };
          let x: number;
          let y: number;
          if (row >= R) {
            x = L.cx + (b.bucket - R / 2) * L.gapX;
            y = L.bottom + 10;
            if (!b.done) {
              b.done = true;
              b.onLand();
            }
          } else {
            const dir = b.path[row];
            const to = { x: L.cx + (rights + dir - (row + 1) / 2) * L.gapX, y: L.top + row * L.gapY + L.gapY * 0.5 };
            x = from.x + (to.x - from.x) * f;
            // bounce: fall + a small hop off the peg
            y = from.y + (to.y - from.y) * f - Math.sin(f * Math.PI) * L.gapY * 0.35;
            if (row !== b.lastRow) {
              b.lastRow = row;
              if (row > 0) sfx.tick();
            }
          }
          const rad = Math.max(4.5, Math.min(8, L.gapX * 0.24));
          const grad = g.createRadialGradient(x - rad / 3, y - rad / 3, 0, x, y, rad);
          grad.addColorStop(0, `hsl(${b.hue} 100% 85%)`);
          grad.addColorStop(1, `hsl(${b.hue} 90% 50%)`);
          g.shadowColor = `hsl(${b.hue} 100% 60%)`;
          g.shadowBlur = 12;
          g.fillStyle = grad;
          g.beginPath();
          g.arc(x, y, rad, 0, Math.PI * 2);
          g.fill();
          g.shadowBlur = 0;
        }
        balls.current = balls.current.filter((b) => !b.done || now - b.t0 < (R + 3) * ROW_MS);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [nRows]);

  /** drop one ball; resolves when it lands */
  const drop = (st: number) =>
    new Promise<AutoResult | null>((resolve) => {
      if (!bet.ensure(st)) return resolve(null);
      bet.debit(st);
      sfx.bet();
      setInFlight((n) => n + 1);
      const my = ++seq.current;
      casino
        .play<PlinkoResult>('plinko', { stake: st, rows: nRows, risk })
        .then((res) => {
          const r = res.result;
          balls.current.push({
            path: r.path,
            t0: performance.now(),
            bucket: r.bucket,
            mult: r.multiplier,
            hue: 190 + Math.random() * 40,
            done: false,
            lastRow: -1,
            onLand: () => {
              setHits((h) => ({ ...h, [r.bucket]: Date.now() }));
              setHistory((hh) => [{ m: r.multiplier, id: Date.now() + Math.random() }, ...hh].slice(0, 12));
              r.multiplier >= 1 ? resultSound(r.multiplier) : sfx.lose();
              if (my >= lastBal.current) {
                lastBal.current = my;
                bet.setBalance(res.balance);
              }
              setRefresh((x) => x + 1);
              setInFlight((n) => n - 1);
              resolve({ stake: st, payout: Number(res.round.payout) });
            },
          });
        })
        .catch((e) => {
          setInFlight((n) => n - 1);
          bet.fail(e);
          resolve(null);
        });
    });

  const auto = useAutoBet({ amount, setAmount, playOnce: drop, gap: 250, maxStake: cfg?.maxStake });

  return (
    <GameShell
      game="plinko"
      refreshKey={refresh}
      controls={
        <>
          {auto.modeSwitch}
          <BetAmount value={amount} onChange={setAmount} disabled={auto.running} />
          <label className="field">
            <span>Risk</span>
            <Seg value={risk} onChange={(v) => setRisk(v as Risk)} disabled={locked || auto.running} options={[{ v: 'low', label: 'Low' }, { v: 'medium', label: 'Medium' }, { v: 'high', label: 'High' }]} />
          </label>
          <label className="field">
            <span>Rows</span>
            <Seg
              value={String(rows)}
              onChange={(v) => setRows(Number(v))}
              disabled={locked || auto.running}
              options={[8, 10, 12, 14, 16].map((n) => ({ v: String(n), label: String(n) }))}
            />
          </label>
          {auto.panel}
          <InfoRow label="Max win" value={usd(stake * Math.max(...table))} accent />
          <ActionBar>
            {auto.mode === 'auto' ? (
              auto.running ? (
                <PlayButton tone="cash" onClick={auto.stop}>
                  Stop autobet · {auto.done}
                </PlayButton>
              ) : (
                <PlayButton onClick={auto.start}>Start autobet</PlayButton>
              )
            ) : (
              <PlayButton onClick={() => drop(stake)}>Drop ball · {usd(stake)}</PlayButton>
            )}
          </ActionBar>
        </>
      }
      stage={
        <div className={`plinko-stage risk-${risk}`}>
          <div className="pk-history">
            {history.map((h) => (
              <span key={h.id} style={{ background: bucketColor(table.indexOf(h.m) >= 0 ? table.indexOf(h.m) : 0, table.length) }}>
                {fmtM(h.m)}×
              </span>
            ))}
          </div>
          <div className="pk-board" ref={board}>
            <canvas ref={canvas} className="pk-canvas" aria-label="Plinko board" />
            <div className="pk-buckets" style={{ gridTemplateColumns: `repeat(${table.length}, 1fr)`, width: `calc(${table.length} * var(--gx, 30px))` }}>
              {table.map((m, i) => (
                <span key={`${i}-${hits[i] ?? 0}`} className={`pk-bucket ${hits[i] && Date.now() - hits[i] < 600 ? 'hit' : ''}`} style={{ background: bucketColor(i, table.length) }}>
                  {fmtM(m)}
                  <em>×</em>
                </span>
              ))}
            </div>
          </div>
        </div>
      }
    />
  );
}
