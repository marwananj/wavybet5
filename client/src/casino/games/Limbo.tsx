import { useRef, useState } from 'react';
import { usd } from '../../lib/format';
import { casino } from '../api';
import { ActionBar, BetAmount, GameShell, InfoRow, PlayButton, useBet } from '../shared';
import { resultSound, sfx } from '../sound';
import { useAutoBet, type AutoResult } from '../autobet';

interface LimboResult {
  target: number;
  result: number;
  won: boolean;
  chance: number;
}
const fmt = (m: number) => (m >= 1000 ? Math.floor(m).toLocaleString() : m.toFixed(2));

export function LimboGame() {
  const bet = useBet();
  const [amount, setAmount] = useState('1.00');
  const [target, setTarget] = useState('2.00');
  const [shown, setShown] = useState<number | null>(null);
  const [won, setWon] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ x: number; win: boolean; id: number }[]>([]);
  const [refresh, setRefresh] = useState(0);
  const raf = useRef(0);

  const t = Math.max(1.01, Math.min(1_000_000, Number(target) || 1.01));
  const chance = Math.min(98.02, 99 / t);
  const stake = Number(amount) || 0;

  const count = (to: number) =>
    new Promise<void>((resolve) => {
      cancelAnimationFrame(raf.current);
      const t0 = performance.now();
      const dur = Math.min(900, 380 + Math.log10(to) * 200);
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        setShown(1 + (to - 1) * e);
        if (k < 1) raf.current = requestAnimationFrame(step);
        else resolve();
      };
      raf.current = requestAnimationFrame(step);
    });

  async function play(st = stake): Promise<AutoResult | null> {
    if (!bet.ensure(st)) return null;
    setBusy(true);
    setWon(null);
    bet.debit(st);
    sfx.bet();
    try {
      const res = await casino.play<LimboResult>('limbo', { stake: st, target: t });
      sfx.whoosh(0.35);
      await count(res.result.result);
      setShown(res.result.result);
      setWon(res.result.won);
      resultSound(res.result.won ? t : 0);
      setHistory((h) => [{ x: res.result.result, win: res.result.won, id: Date.now() }, ...h].slice(0, 14));
      bet.setBalance(res.balance);
      setRefresh((r) => r + 1);
      return { stake: st, payout: Number(res.round.payout) };
    } catch (e) {
      bet.fail(e);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const auto = useAutoBet({ amount, setAmount, playOnce: (st) => play(st), gap: 250 });

  return (
    <GameShell
      game="limbo"
      refreshKey={refresh}
      controls={
        <>
          {auto.modeSwitch}
          <BetAmount value={amount} onChange={setAmount} disabled={busy || auto.running} />
          <label className="field">
            <span>Target multiplier</span>
            <div className="amount-input">
              <input inputMode="decimal" value={target} disabled={busy} onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ''))} onBlur={() => setTarget(t.toFixed(2))} />
              <b>×</b>
            </div>
          </label>
          <div className="limbo-quick">
            {[1.5, 2, 5, 10, 100].map((x) => (
              <button key={x} type="button" className={t === x ? 'on' : ''} disabled={busy} onClick={() => setTarget(x.toFixed(2))}>
                {x}×
              </button>
            ))}
          </div>
          <InfoRow label="Win chance" value={`${chance.toFixed(chance < 1 ? 4 : 2)}%`} />
          <InfoRow label="Profit on win" value={usd(stake * t - stake)} accent />
          {auto.panel}
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
              <PlayButton busy={busy} onClick={() => play()}>
                Bet · {usd(stake)}
              </PlayButton>
            )}
          </ActionBar>
        </>
      }
      stage={
        <div className="limbo-stage">
          <div className="bm-history">
            {history.map((h) => (
              <span key={h.id} className={`bm-pill ${h.win ? 'hi' : ''}`}>
                {fmt(h.x)}×
              </span>
            ))}
          </div>
          <div className={`limbo-core ${won === null ? '' : won ? 'win' : 'loss'}`}>
            <div className="limbo-rings" aria-hidden>
              <i />
              <i />
              <i />
            </div>
            <b>{shown == null ? '1.00' : fmt(shown)}×</b>
            <span>{won === null ? `Target ${t.toFixed(2)}×` : won ? `Win · ${usd(stake * t)}` : `Needed ${t.toFixed(2)}×`}</span>
          </div>
        </div>
      }
    />
  );
}
