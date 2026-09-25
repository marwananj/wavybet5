import { useEffect, useState } from 'react';
import { LuShuffle, LuTrash2 } from 'react-icons/lu';
import { usd } from '../../lib/format';
import { casino, mult, sleep } from '../api';
import { BetAmount, GameShell, PlayButton, Seg, useBet, useCasinoConfig } from '../shared';
import { resultSound, sfx } from '../sound';

type Risk = 'easy' | 'medium' | 'hard' | 'expert';
interface KenoResult {
  drawn: number[];
  picks: number[];
  hits: number[];
  risk: Risk;
}

export function KenoGame() {
  const bet = useBet();
  const cfg = useCasinoConfig();
  const [amount, setAmount] = useState('1.00');
  const [risk, setRisk] = useState<Risk>('medium');
  const [picks, setPicks] = useState<number[]>([]);
  const [drawn, setDrawn] = useState<number[]>([]);
  const [hits, setHits] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const table = cfg?.keno.tables[risk]?.[String(picks.length)] ?? [];
  const stake = Number(amount) || 0;

  useEffect(() => {
    setDrawn([]);
    setHits(null);
  }, [picks.length, risk]);

  const toggle = (n: number) => {
    sfx.click();
    if (busy) return;
    if (drawn.length) {
      setDrawn([]);
      setHits(null);
    }
    setPicks((p) => (p.includes(n) ? p.filter((x) => x !== n) : p.length >= 10 ? p : [...p, n]));
  };
  const autoPick = () => {
    const pool = Array.from({ length: 40 }, (_, i) => i + 1);
    const n = picks.length || 10;
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    setPicks(out);
  };

  async function play() {
    if (!picks.length) return bet.toast('info', 'Pick at least one number');
    if (!bet.ensure(stake)) return;
    setBusy(true);
    setDrawn([]);
    setHits(null);
    bet.debit(stake);
    try {
      sfx.bet();
      const res = await casino.play<KenoResult>('keno', { stake, picks, risk });
      for (let i = 0; i < res.result.drawn.length; i++) {
        setDrawn(res.result.drawn.slice(0, i + 1));
        if (picks.includes(res.result.drawn[i])) sfx.gem();
        else sfx.tick(0.8 + i * 0.04);
        await sleep(110);
      }
      setHits(res.result.hits.length);
      resultSound(res.round.multiplier);
      bet.setBalance(res.balance);
      setRefresh((r) => r + 1);
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }

  const resultMult = hits != null ? table[hits] ?? 0 : null;

  return (
    <GameShell
      game="keno"
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
              { v: 'expert', label: 'Expert' },
            ]}
          />
          <div className="btn-pair">
            <button className="btn btn-ghost btn-sm" onClick={autoPick} disabled={busy}>
              <LuShuffle size={15} /> Auto pick
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setPicks([])} disabled={busy || !picks.length}>
              <LuTrash2 size={15} /> Clear
            </button>
          </div>
          <PlayButton busy={busy} onClick={play} disabled={!picks.length}>
            {picks.length ? `Bet · ${picks.length} pick${picks.length > 1 ? 's' : ''}` : 'Pick 1–10 numbers'}
          </PlayButton>
        </>
      }
      stage={
        <div className="keno-stage">
          <div className="keno-grid">
            {Array.from({ length: 40 }, (_, i) => i + 1).map((n) => {
              const sel = picks.includes(n);
              const d = drawn.includes(n);
              const cls = d ? (sel ? 'hit' : 'drawn') : sel ? 'sel' : '';
              return (
                <button key={n} className={`kt ${cls}`} onClick={() => toggle(n)} disabled={busy}>
                  <span className="kt-inner">
                    {d && sel ? (
                      <svg viewBox="0 0 24 24" className="gem" aria-hidden>
                        <path d="M6 3h12l4 6-10 12L2 9z" fill="currentColor" />
                        <path d="M2 9h20M9 3l3 18 3-18" stroke="rgba(0,0,0,.25)" strokeWidth="1.2" fill="none" />
                      </svg>
                    ) : null}
                    <b>{n}</b>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="keno-pay">
            {picks.length === 0 ? (
              <div className="kp-empty">Select 1–10 numbers to see payouts</div>
            ) : (
              table.map((m, h) => (
                <div key={h} className={`kp ${hits === h ? 'on' : ''} ${m === 0 ? 'zero' : ''}`}>
                  <b>{m > 0 ? mult(m) : '0.00×'}</b>
                  <span>{h}×</span>
                </div>
              ))
            )}
          </div>
          {hits != null && (
            <div className={`stage-banner ${resultMult! > 0 ? 'win' : 'loss'}`}>
              {hits} hit{hits === 1 ? '' : 's'} · {resultMult! > 0 ? `${mult(resultMult!)} · ${usd(stake * resultMult!)}` : 'no win'}
            </div>
          )}
        </div>
      }
    />
  );
}
