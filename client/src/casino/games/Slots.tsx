import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { LuInfo, LuSquare, LuZap } from 'react-icons/lu';
import { usd } from '../../lib/format';
import { Modal } from '../../components/ui';
import { casino, sleep } from '../api';
import { ActionBar, BetAmount, GameShell, InfoRow, PlayButton, useBet, useCasinoConfig } from '../shared';
import { sfx } from '../sound';
import { SymbolTile, THEMES, type Theme } from '../slots/symbols';

interface LineWin {
  line: number;
  symbol: number;
  count: number;
  pay: number;
  cells: [number, number][];
}
interface Spin {
  grid: number[][];
  stops: number[];
  lines: LineWin[];
  scatter: { count: number; pay: number; cells: [number, number][] };
  award: number;
  win: number;
}
interface SlotRound {
  machine: string;
  base: Spin;
  free: Spin[];
  freeTotal: number;
  total: number;
}
interface MachineInfo {
  id: string;
  name: string;
  volatility: string;
  pays: number[][];
  scatterPays: number[];
  freeSpins: number[];
  fsMultiplier: number;
  rtp: number;
  lines: number;
  paylines: number[][];
}

const REELS = 5;
const LINE_COLORS = ['#ffd84a', '#3ad0ff', '#ff5d73', '#5ee38a', '#c084fc', '#fb923c', '#22d3ee', '#f472b6', '#a3e635', '#fde047'];
const rand = () => Math.floor(Math.random() * 7); // filler symbols while spinning (no wild/scatter)
const randomGrid = () => Array.from({ length: REELS }, () => [rand(), rand(), rand()]);

/* ─────────────────────────────── reels ─────────────────────────────── */

function useReels(theme: Theme) {
  const [strips, setStrips] = useState<number[][]>(() => randomGrid());
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const win = useRef<HTMLDivElement>(null);
  const current = useRef<number[][]>(strips);

  /** spin all reels to `grid`; resolves when the last reel lands */
  const spin = useCallback(
    (grid: number[][], opts: { turbo: boolean; scatters?: boolean }) =>
      new Promise<void>((resolve) => {
        const base = opts.turbo ? 380 : 750;
        const step = opts.turbo ? 110 : 230;
        // anticipation: 2 scatters on the first reels → the remaining reels spin longer
        const scatCols = grid.map((c) => c.includes(8));
        let seen = 0;
        const antFrom = opts.turbo
          ? 99
          : grid.findIndex((_, i) => {
              if (i > 0 && scatCols[i - 1]) seen++;
              return seen >= 2;
            });
        const next = grid.map((final, i) => {
          const extra = antFrom >= 0 && i >= antFrom ? 16 + (i - antFrom) * 8 : 0;
          const filler = Array.from({ length: 12 + i * (opts.turbo ? 2 : 5) + extra }, rand);
          return [...final, ...filler, ...current.current[i]];
        });
        flushSync(() => setStrips(next));
        let done = 0;
        requestAnimationFrame(() => {
          next.forEach((strip, i) => {
            const el = els.current[i];
            if (!el) return;
            const n = strip.length - 3;
            const extraT = antFrom >= 0 && i >= antFrom ? 900 + (i - antFrom) * 500 : 0;
            const dur = base + i * step + extraT;
            el.style.transition = 'none';
            el.style.transform = `translate3d(0, calc(var(--cell) * ${-n}), 0)`;
            el.parentElement?.classList.add('moving');
            if (extraT) el.parentElement?.classList.add('anticipate');
            void el.offsetHeight;
            el.style.transition = `transform ${dur}ms cubic-bezier(0.2, 0.62, 0.28, 1.06)`;
            el.style.transform = 'translate3d(0, 0, 0)';
            if (extraT && i === antFrom) sfx.anticipate();
            window.setTimeout(() => {
              el.parentElement?.classList.remove('moving', 'anticipate');
              sfx.reelStop(i);
              if (grid[i].includes(8)) sfx.scatter(grid.slice(0, i + 1).filter((c) => c.includes(8)).length);
              done++;
              if (done === REELS) {
                current.current = grid;
                setStrips(grid.map((c) => [...c]));
                requestAnimationFrame(() => els.current.forEach((e) => e && ((e.style.transition = 'none'), (e.style.transform = 'translate3d(0,0,0)'))));
                resolve();
              }
            }, dur);
          });
        });
      }),
    []
  );

  useEffect(() => {
    const set = () => {
      const h = win.current?.clientHeight ?? 300;
      win.current?.style.setProperty('--cell', `${h / 3}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    if (win.current) ro.observe(win.current);
    return () => ro.disconnect();
  }, []);

  void theme;
  return { strips, els, win, spin };
}

/* ─────────────────────────────── paytable ─────────────────────────────── */

function Paytable({ theme, info, stake, onClose }: { theme: Theme; info: MachineInfo | undefined; stake: number; onClose: () => void }) {
  const lineBet = stake / 20;
  return (
    <Modal onClose={onClose} title={`${theme.name} · paytable`} wide>
      <div className="slot-paytable">
        <p className="muted">
          Pays for your current bet of {usd(stake)} ({usd(lineBet)} per line). Wins pay left to right on {info?.lines ?? 20} lines · WILD substitutes for every symbol
          except the scatter · {info?.rtp ? `${Math.round(info.rtp * 100)}% RTP` : ''} · {info?.volatility} volatility.
        </p>
        <div className="spt-grid">
          {[8, 7, 6, 5, 4, 3, 2, 1, 0].map((s) => (
            <div key={s} className={`spt-row ${s === 8 ? 'scatter' : s === 7 ? 'wild' : ''}`}>
              <SymbolTile theme={theme} s={s} className="spt-sym" />
              <div className="spt-pays">
                {s === 8
                  ? (info?.scatterPays ?? [2, 10, 50]).map((p, i) => (
                      <span key={i}>
                        <b>{i + 3}×</b> {usd(p * stake)} + {info?.freeSpins[i]} free spins
                      </span>
                    ))
                  : (info?.pays[s] ?? [0, 0, 0]).map((p, i) => (
                      <span key={i}>
                        <b>{i + 3}×</b> {usd(p * lineBet)}
                      </span>
                    ))}
              </div>
            </div>
          ))}
        </div>
        <p className="muted">
          3+ scatters anywhere award free spins; every free-spin win is multiplied ×{info?.fsMultiplier ?? 2} and free spins can retrigger.
        </p>
        <div className="spt-lines">
          {(info?.paylines ?? []).map((pl, i) => (
            <div key={i} className="spt-line">
              {[0, 1, 2].map((row) => (
                <div key={row}>
                  {pl.map((r, c) => (
                    <i key={c} className={r === row ? 'on' : ''} />
                  ))}
                </div>
              ))}
              <small>{i + 1}</small>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/* ─────────────────────────────── the machine ─────────────────────────────── */

type Phase = 'idle' | 'spinning' | 'show' | 'free';

export function SlotGame({ machine }: { machine: string }) {
  const theme = THEMES[machine];
  const bet = useBet();
  const cfg = useCasinoConfig() as unknown as { slots?: MachineInfo[] } | null;
  const info = cfg?.slots?.find((m) => m.id === machine);
  const reels = useReels(theme);
  const [amount, setAmount] = useState('1.00');
  const [phase, setPhase] = useState<Phase>('idle');
  const [wins, setWins] = useState<LineWin[]>([]);
  const [scatterCells, setScatterCells] = useState<[number, number][]>([]);
  const [activeLine, setActiveLine] = useState(-1);
  const [winAmt, setWinAmt] = useState<number | null>(null);
  const [banner, setBanner] = useState<{ kind: 'big' | 'mega' | 'epic' | 'fs' | 'fsend'; text: string; sub?: string } | null>(null);
  const [fs, setFs] = useState<{ left: number; total: number; mult: number } | null>(null);
  const [turbo, setTurbo] = useState(false);
  const [autoLeft, setAutoLeft] = useState(0);
  const [autoPick, setAutoPick] = useState(10);
  const [showPays, setShowPays] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [lastWin, setLastWin] = useState(0);
  const stopAuto = useRef(false);
  const stake = Number(amount) || 0;
  const busy = phase === 'spinning' || phase === 'free';

  const winCells = useMemo(() => {
    const set = new Set<string>();
    const src = activeLine >= 0 && wins[activeLine] ? [wins[activeLine]] : wins;
    src.forEach((w) => w.cells.forEach(([c, r]) => set.add(`${c}-${r}`)));
    scatterCells.forEach(([c, r]) => set.add(`${c}-${r}`));
    return set;
  }, [wins, activeLine, scatterCells]);

  // cycle through line wins
  useEffect(() => {
    if (!wins.length || phase === 'spinning') return;
    let i = -1;
    const t = setInterval(() => {
      i = (i + 1) % (wins.length + 1);
      setActiveLine(i === wins.length ? -1 : i);
    }, 1100);
    return () => clearInterval(t);
  }, [wins, phase]);

  const countUp = (to: number, ms = 900) =>
    new Promise<void>((resolve) => {
      const t0 = performance.now();
      const from = 0;
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        setWinAmt(from + (to - from) * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

  const present = async (s: Spin, stakeNow: number, mult: number) => {
    setWins(s.lines);
    setScatterCells(s.scatter.count >= 3 ? s.scatter.cells : []);
    setActiveLine(-1);
    const amt = s.win * stakeNow;
    if (amt > 0) {
      sfx.lineWin();
      await countUp(amt, turbo ? 350 : Math.min(1800, 500 + (amt / stakeNow) * 60));
    }
    void mult;
    return amt;
  };

  const spin = async () => {
    if (busy) return;
    if (!bet.ensure(stake)) return setAutoLeft(0);
    setPhase('spinning');
    setWins([]);
    setScatterCells([]);
    setActiveLine(-1);
    setWinAmt(null);
    setBanner(null);
    bet.debit(stake);
    sfx.reelStart();
    try {
      const [res] = await Promise.all([casino.play<SlotRound>(machine, { stake }), sleep(turbo ? 60 : 180)]);
      const r = res.result;
      await reels.spin(r.base.grid, { turbo });
      setPhase('show');
      let total = await present(r.base, stake, 1);
      if (r.free.length) {
        await sleep(500);
        sfx.fanfare();
        setBanner({ kind: 'fs', text: `${r.base.award} FREE SPINS`, sub: `All wins ×${info?.fsMultiplier ?? 2}` });
        await sleep(2200);
        setBanner(null);
        setPhase('free');
        let fsWin = 0;
        let left = r.base.award;
        for (const f of r.free) {
          left = left - 1 + f.award;
          setFs({ left, total: fsWin, mult: info?.fsMultiplier ?? 2 });
          setWins([]);
          setScatterCells([]);
          setWinAmt(null);
          await reels.spin(f.grid, { turbo: true });
          const w = await present(f, stake, info?.fsMultiplier ?? 2);
          fsWin += w;
          setFs({ left, total: fsWin, mult: info?.fsMultiplier ?? 2 });
          if (f.award) {
            sfx.fanfare();
            setBanner({ kind: 'fs', text: `+${f.award} FREE SPINS` });
            await sleep(1400);
            setBanner(null);
          }
          await sleep(w > 0 ? 650 : 250);
        }
        total += fsWin;
        setFs(null);
        setBanner({ kind: 'fsend', text: usd(fsWin), sub: `won in ${r.free.length} free spins` });
        sfx.bigWin();
        await sleep(2400);
        setBanner(null);
        setPhase('show');
      }
      const x = total / stake;
      setWinAmt(total > 0 ? total : null);
      setLastWin(total);
      if (x >= 15) {
        setBanner({ kind: x >= 100 ? 'epic' : x >= 40 ? 'mega' : 'big', text: x >= 100 ? 'EPIC WIN' : x >= 40 ? 'MEGA WIN' : 'BIG WIN', sub: usd(total) });
        sfx.bigWin();
        window.setTimeout(() => setBanner((b) => (b && b.kind !== 'fs' ? null : b)), 3200);
      } else if (total > 0) sfx.win();
      bet.setBalance(res.balance);
      setRefresh((k) => k + 1);
      setPhase('idle');
    } catch (e) {
      bet.fail(e);
      setPhase('idle');
      setAutoLeft(0);
    }
  };

  // autoplay
  useEffect(() => {
    if (phase !== 'idle' || autoLeft <= 0) return;
    if (stopAuto.current) {
      stopAuto.current = false;
      setAutoLeft(0);
      return;
    }
    const t = window.setTimeout(() => {
      setAutoLeft((n) => n - 1);
      spin();
    }, banner ? 2600 : turbo ? 250 : 550);
    return () => clearTimeout(t);
  }, [phase, autoLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  // space bar spins
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('input,textarea,select,button')) {
        e.preventDefault();
        spin();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const active = activeLine >= 0 ? wins[activeLine] : null;
  const pl = info?.paylines;

  return (
    <GameShell
      game={machine}
      refreshKey={refresh}
      controls={
        <>
          <BetAmount value={amount} onChange={setAmount} disabled={busy || autoLeft > 0} label="Total bet (20 lines)" />
          <InfoRow label="Line bet" value={usd(stake / 20)} />
          <div className="slot-opts">
            <button type="button" className={`slot-opt ${turbo ? 'on' : ''}`} onClick={() => setTurbo((t) => !t)}>
              <LuZap size={15} /> Turbo
            </button>
            <label className="slot-opt">
              Auto
              <select value={autoPick} onChange={(e) => setAutoPick(Number(e.target.value))} disabled={autoLeft > 0}>
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="slot-opt" onClick={() => setShowPays(true)}>
              <LuInfo size={15} /> Paytable
            </button>
          </div>
          <ActionBar className="slot-actions">
            {autoLeft > 0 ? (
              <PlayButton tone="cash" onClick={() => ((stopAuto.current = true), setAutoLeft(0))}>
                <LuSquare size={14} /> Stop auto · {autoLeft} left
              </PlayButton>
            ) : (
              <div className="slot-btns">
                <PlayButton busy={busy} onClick={spin}>
                  Spin · {usd(stake)}
                </PlayButton>
                <button type="button" className="btn btn-ghost slot-auto-btn" disabled={busy} onClick={() => setAutoLeft(autoPick)}>
                  Auto ×{autoPick}
                </button>
              </div>
            )}
          </ActionBar>
          <small className="muted">
            {theme.tagline}. {info ? `${Math.round(info.rtp * 100)}% RTP · ${info.volatility} volatility.` : ''} Press space to spin.
          </small>
        </>
      }
      stage={
        <div className={`slot-stage ${machine}`} style={{ '--frame': theme.cabinet[0], '--glow': theme.cabinet[1], '--bg': theme.cabinet[2], '--bulb': theme.bulbs } as CSSProperties}>
          <div className="slot-cabinet">
            <div className="slot-marquee">
              <span className="slot-bulbs" aria-hidden>
                {Array.from({ length: 18 }, (_, i) => (
                  <i key={i} style={{ animationDelay: `${(i % 6) * 0.12}s` }} />
                ))}
              </span>
              <h2>{theme.name}</h2>
              <small>{fs ? `FREE SPINS · ${fs.left} left · ×${fs.mult}` : `${info?.volatility ?? ''} volatility · 20 lines`}</small>
            </div>
            <div className={`slot-window ${phase === 'free' || fs ? 'fs' : ''}`} ref={reels.win} style={{ background: theme.reelBg }}>
              {reels.strips.map((strip, i) => (
                <div key={i} className="slot-reel">
                  <div className="slot-strip" ref={(el) => void (reels.els.current[i] = el)}>
                    {strip.map((s, k) => (
                      <SymbolTile key={k} theme={theme} s={s} className={k < 3 && phase !== 'spinning' && winCells.has(`${i}-${k}`) ? 'hit' : ''} />
                    ))}
                  </div>
                </div>
              ))}
              <div className="slot-shade" aria-hidden />
              {active && pl && (
                <svg className="slot-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                  <polyline
                    points={pl[active.line].map((row, c) => `${(c + 0.5) * 20},${(row + 0.5) * 33.333}`).join(' ')}
                    stroke={LINE_COLORS[active.line % LINE_COLORS.length]}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              )}
              {active && (
                <div className="slot-linewin" style={{ '--lc': LINE_COLORS[active.line % LINE_COLORS.length] } as CSSProperties}>
                  Line {active.line + 1} · {active.count}× {theme.symbols[active.symbol].name} · {usd((active.pay / 20) * stake)}
                </div>
              )}
            </div>
            <div className="slot-panel">
              <div>
                <small>BET</small>
                <b>{usd(stake)}</b>
              </div>
              <div className={`slot-win ${winAmt ? 'on' : ''}`}>
                <small>{fs ? 'FREE SPINS WIN' : 'WIN'}</small>
                <b>{usd(fs ? fs.total + (winAmt ?? 0) : winAmt ?? 0)}</b>
              </div>
              <div>
                <small>LAST WIN</small>
                <b>{usd(lastWin)}</b>
              </div>
            </div>
          </div>
          {banner && (
            <div className={`slot-banner ${banner.kind}`}>
              {(banner.kind === 'big' || banner.kind === 'mega' || banner.kind === 'epic' || banner.kind === 'fsend') && (
                <span className="slot-coins" aria-hidden>
                  {Array.from({ length: 26 }, (_, i) => (
                    <i key={i} style={{ '--x': `${Math.random() * 100}%`, '--d': `${1 + Math.random() * 1.4}s`, '--delay': `${Math.random() * 0.8}s` } as CSSProperties} />
                  ))}
                </span>
              )}
              <b>{banner.text}</b>
              {banner.sub && <span>{banner.sub}</span>}
            </div>
          )}
          {showPays && <Paytable theme={theme} info={info} stake={stake} onClose={() => setShowPays(false)} />}
        </div>
      }
    />
  );
}

export const FruitsSlot = () => <SlotGame machine="slot-fruits" />;
export const GemsSlot = () => <SlotGame machine="slot-gems" />;
export const PharaohSlot = () => <SlotGame machine="slot-pharaoh" />;
