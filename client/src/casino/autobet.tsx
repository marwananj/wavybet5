import { useEffect, useRef, useState } from 'react';
import { usd } from '../lib/format';
import { Seg } from './shared';

/**
 * Autobet for instant games. The game supplies `playOnce(stake)` which places ONE bet and resolves
 * with { stake, payout } when the result is known (or null on error, which stops the run).
 * Settings: number of bets (0 = until stopped), on win / on loss (reset or increase by %),
 * stop on profit, stop on loss.
 */
export interface AutoResult {
  stake: number;
  payout: number;
}
interface Cfg {
  count: string;
  onWin: 'reset' | 'increase';
  winPct: string;
  onLoss: 'reset' | 'increase';
  lossPct: string;
  stopProfit: string;
  stopLoss: string;
}
const DEF: Cfg = { count: '10', onWin: 'reset', winPct: '0', onLoss: 'reset', lossPct: '0', stopProfit: '', stopLoss: '' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useAutoBet(opts: { amount: string; setAmount: (v: string) => void; playOnce: (stake: number) => Promise<AutoResult | null>; gap?: number; maxStake?: number }) {
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [cfg, setCfg] = useState<Cfg>(() => {
    try {
      return { ...DEF, ...JSON.parse(localStorage.getItem('wb_autobet') ?? '{}') };
    } catch {
      return DEF;
    }
  });
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [profit, setProfit] = useState(0);
  const stopRef = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    try {
      localStorage.setItem('wb_autobet', JSON.stringify(cfg));
    } catch {
      /* ignore */
    }
  }, [cfg]);
  useEffect(() => () => void (stopRef.current = true), []);

  const start = async () => {
    const base = Number(optsRef.current.amount) || 0;
    if (!(base > 0)) return;
    stopRef.current = false;
    setRunning(true);
    setDone(0);
    setProfit(0);
    const total = Math.max(0, Math.floor(Number(cfg.count) || 0));
    const sp = Number(cfg.stopProfit) || 0;
    const sl = Number(cfg.stopLoss) || 0;
    let stake = base;
    let pl = 0;
    let n = 0;
    while (!stopRef.current && (total === 0 || n < total)) {
      const r = await optsRef.current.playOnce(Math.round(stake * 100) / 100);
      if (!r) break;
      n++;
      pl += r.payout - r.stake;
      setDone(n);
      setProfit(pl);
      if (sp > 0 && pl >= sp) break;
      if (sl > 0 && -pl >= sl) break;
      const win = r.payout > r.stake;
      const how = win ? cfg.onWin : cfg.onLoss;
      const pct = Number(win ? cfg.winPct : cfg.lossPct) || 0;
      stake = how === 'reset' ? base : stake * (1 + pct / 100);
      if (optsRef.current.maxStake) stake = Math.min(stake, optsRef.current.maxStake);
      optsRef.current.setAmount((Math.round(stake * 100) / 100).toFixed(2));
      await sleep(optsRef.current.gap ?? 350);
    }
    setRunning(false);
  };
  const stop = () => {
    stopRef.current = true;
  };

  const set = (k: keyof Cfg) => (e: { target: { value: string } }) => setCfg((c) => ({ ...c, [k]: e.target.value.replace(/[^0-9.]/g, '') }));
  const panel =
    mode === 'auto' ? (
      <div className="autobet">
        <label className="ab-field">
          <span>Number of bets</span>
          <div className="ab-input">
            <input inputMode="numeric" value={cfg.count} disabled={running} onChange={set('count')} />
            <button type="button" className={cfg.count === '0' ? 'on' : ''} disabled={running} onClick={() => setCfg((c) => ({ ...c, count: '0' }))} title="Until stopped">
              ∞
            </button>
          </div>
        </label>
        {(['Win', 'Loss'] as const).map((w) => {
          const on = w === 'Win' ? cfg.onWin : cfg.onLoss;
          const pk = w === 'Win' ? 'winPct' : 'lossPct';
          return (
            <label key={w} className="ab-field">
              <span>On {w.toLowerCase()}</span>
              <div className="ab-input">
                <button type="button" className={on === 'reset' ? 'on' : ''} disabled={running} onClick={() => setCfg((c) => ({ ...c, [w === 'Win' ? 'onWin' : 'onLoss']: 'reset' }))}>
                  Reset
                </button>
                <button type="button" className={on === 'increase' ? 'on' : ''} disabled={running} onClick={() => setCfg((c) => ({ ...c, [w === 'Win' ? 'onWin' : 'onLoss']: 'increase' }))}>
                  Increase
                </button>
                <input inputMode="decimal" value={cfg[pk]} disabled={running || on === 'reset'} onChange={set(pk)} />
                <b>%</b>
              </div>
            </label>
          );
        })}
        <div className="ab-two">
          <label className="ab-field">
            <span>Stop on profit</span>
            <div className="ab-input">
              <b>$</b>
              <input inputMode="decimal" placeholder="0.00" value={cfg.stopProfit} disabled={running} onChange={set('stopProfit')} />
            </div>
          </label>
          <label className="ab-field">
            <span>Stop on loss</span>
            <div className="ab-input">
              <b>$</b>
              <input inputMode="decimal" placeholder="0.00" value={cfg.stopLoss} disabled={running} onChange={set('stopLoss')} />
            </div>
          </label>
        </div>
        {(running || done > 0) && (
          <div className="ab-status">
            <span>
              {running ? 'Running' : 'Finished'} · {done}
              {Number(cfg.count) > 0 ? ` / ${cfg.count}` : ''} bets
            </span>
            <b className={profit >= 0 ? 'win' : 'loss'}>
              {profit >= 0 ? '+' : '−'}
              {usd(Math.abs(profit))}
            </b>
          </div>
        )}
      </div>
    ) : null;

  const modeSwitch = (
    <Seg
      value={mode}
      onChange={(m) => !running && setMode(m)}
      options={[
        { v: 'manual', label: 'Manual' },
        { v: 'auto', label: 'Auto' },
      ]}
    />
  );
  return { mode, running, start, stop, panel, modeSwitch, done };
}
