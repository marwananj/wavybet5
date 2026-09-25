import { useEffect, useRef, useState } from 'react';
import { LuArrowDown, LuArrowUp, LuEqual, LuSkipForward } from 'react-icons/lu';
import { usd } from '../../lib/format';
import { casino, mult, type Card, type Round } from '../api';
import { BetAmount, GameShell, InfoRow, PlayButton, PlayingCard, useBet } from '../shared';
import { resultSound, sfx } from '../sound';

interface Opt {
  choice: 'higher' | 'lower' | 'same';
  label: string;
  p: number;
  multiplier: number;
  next: number;
}
interface HiloView {
  history: { card: Card; choice?: string; correct?: boolean; multiplier?: number }[];
  current: Card;
  multiplier: number;
  wins: number;
  finished: boolean;
  lost: boolean;
  options: Opt[];
  canCashout: boolean;
  cashed: boolean;
}
const ICON = { higher: LuArrowUp, lower: LuArrowDown, same: LuEqual };

export function HiloGame() {
  const bet = useBet();
  const [amount, setAmount] = useState('1.00');
  const [round, setRound] = useState<Round<HiloView> | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!bet.user) return;
    casino.active<HiloView>('hilo').then((d) => d.round && setRound(d.round)).catch(() => {});
  }, [bet.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = round?.view;
  const inPlay = !!v && !v.finished;
  const stake = round ? Number(round.stake) : Number(amount) || 0;

  useEffect(() => {
    strip.current?.scrollTo({ left: strip.current.scrollWidth, behavior: 'smooth' });
  }, [v?.history.length]);

  async function start() {
    const s = Number(amount) || 0;
    if (!bet.ensure(s)) return;
    setBusy(true);
    bet.debit(s);
    try {
      sfx.bet();
      const d = await casino.start<HiloView>('hilo', { stake: s });
      sfx.flip();
      setRound(d.round);
      bet.setBalance(d.balance);
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function act(action: 'guess' | 'skip' | 'cashout', choice?: Opt['choice']) {
    if (!round) return;
    setBusy(true);
    try {
      const d = await casino.act<HiloView>('hilo', round.id, action, choice ? { choice } : {});
      const dv = d.round.view!;
      if (action === 'cashout') sfx.cashout();
      else {
        sfx.flip();
        if (dv.lost) setTimeout(() => sfx.lose(), 200);
        else if (action === 'guess') setTimeout(() => sfx.step(Math.min(12, dv.wins)), 150);
      }
      setRound(d.round);
      bet.setBalance(d.balance);
      if (d.round.view?.finished) setRefresh((r) => r + 1);
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }

  const current = v?.current ?? null;

  return (
    <GameShell
      game="hilo"
      refreshKey={refresh}
      controls={
        <>
          <BetAmount value={amount} onChange={setAmount} disabled={busy || inPlay} />
          {inPlay ? (
            <>
              <div className="hilo-opts">
                {v!.options.map((o) => {
                  const I = ICON[o.choice];
                  return (
                    <button key={o.choice} className={`hilo-opt ${o.choice}`} disabled={busy} onClick={() => act('guess', o.choice)}>
                      <I size={20} />
                      <span>
                        <b>{o.label}</b>
                        <small>
                          {(o.p * 100).toFixed(2)}% · {mult(o.multiplier)}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
              <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => act('skip')}>
                <LuSkipForward size={16} /> Skip card
              </button>
              <InfoRow label="Current multiplier" value={mult(v!.multiplier)} accent={v!.wins > 0} />
              <PlayButton tone="cash" busy={busy} disabled={!v!.canCashout} onClick={() => act('cashout')}>
                {v!.canCashout ? `Cash out ${usd(stake * v!.multiplier)}` : 'Guess to start winning'}
              </PlayButton>
            </>
          ) : (
            <PlayButton busy={busy} onClick={start}>
              {v ? 'Play again' : 'Start'}
            </PlayButton>
          )}
        </>
      }
      stage={
        <div className="hilo-stage">
          <div className="hilo-profit">
            <span>Total profit ({mult(v?.multiplier ?? 1)})</span>
            <b className={v && v.wins > 0 && !v.lost ? 'win' : v?.lost ? 'loss' : ''}>
              {(() => {
                const p = v ? (v.lost ? -stake : stake * v.multiplier - stake) : 0;
                return `${p < 0 ? '−' : ''}${usd(Math.abs(p))}`;
              })()}
            </b>
          </div>
          <div className="hilo-center">
            <div className="hilo-hint up">
              <LuArrowUp size={18} /> {v && inPlay ? `${v.options[0].label} ${(v.options[0].p * 100).toFixed(1)}%` : 'Higher'}
            </div>
            <div className="hilo-deck">
              <PlayingCard faceDown className="deck-back b2" />
              <PlayingCard faceDown className="deck-back b1" />
              <PlayingCard key={v?.history.length ?? 0} card={current} faceDown={!current} className={`hilo-card ${current ? 'flip-in' : ''} ${v?.lost ? 'lost' : ''}`} />
            </div>
            <div className="hilo-hint down">
              <LuArrowDown size={18} /> {v && inPlay ? `${v.options[1].label} ${(v.options[1].p * 100).toFixed(1)}%` : 'Lower'}
            </div>
          </div>
          <div className="hilo-strip" ref={strip}>
            {v?.history.map((h, i) => (
              <div key={i} className={`hs-item ${h.correct === false ? 'bad' : h.correct ? 'good' : ''}`}>
                <PlayingCard card={h.card} small />
                <span className="hs-tag">
                  {i === 0 ? 'Start' : h.correct === false ? '✕' : h.multiplier != null && v.history[i - 1]?.choice === 'skip' ? 'Skip' : mult(h.multiplier ?? 1)}
                </span>
              </div>
            ))}
          </div>
          {v?.finished && (
            <div className={`stage-banner ${v.cashed ? 'win' : 'loss'}`}>{v.cashed ? `Cashed out ${mult(v.multiplier)} · ${usd(round!.payout)}` : 'Wrong guess — round lost'}</div>
          )}
        </div>
      }
    />
  );
}
