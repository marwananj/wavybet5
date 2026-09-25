import { useState } from 'react';
import { LuArrowLeftRight } from 'react-icons/lu';
import { usd } from '../../lib/format';
import { casino, mult, sleep } from '../api';
import { ActionBar, BetAmount, GameShell, InfoRow, PlayButton, useBet } from '../shared';
import { resultSound, sfx } from '../sound';

interface DiceResult {
  roll: number;
  target: number;
  over: boolean;
  chance: number;
  payoutMultiplier: number;
}
const round2 = (x: number) => Math.round(x * 100) / 100;
const floor4 = (x: number) => Math.floor(x * 10000) / 10000;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export function DiceGame() {
  const bet = useBet();
  const [amount, setAmount] = useState('1.00');
  const [over, setOver] = useState(true);
  const [target, setTarget] = useState(50.5);
  const [roll, setRoll] = useState<number | null>(null);
  const [won, setWon] = useState<boolean | null>(null);
  const [history, setHistory] = useState<{ roll: number; win: boolean; id: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [editMult, setEditMult] = useState<string | null>(null);
  const [editChance, setEditChance] = useState<string | null>(null);

  const chance = round2(over ? 100 - target : target);
  const m = floor4(99 / chance);
  const stake = Number(amount) || 0;

  const setChance = (c: number) => {
    const cc = round2(clamp(c, 1, 98));
    setTarget(round2(over ? 100 - cc : cc));
  };
  const setSlider = (t: number) => setTarget(round2(over ? clamp(t, 2, 99) : clamp(t, 1, 98)));
  const flip = () => {
    setOver(!over);
    setTarget(round2(100 - target));
  };

  async function play() {
    if (!bet.ensure(stake)) return;
    setBusy(true);
    setWon(null);
    bet.debit(stake);
    try {
      sfx.bet();
      const res = await casino.play<DiceResult>('dice', { stake, target, over });
      sfx.dice();
      setRoll(res.result.roll);
      const win = res.round.status === 'WON';
      await sleep(520);
      setWon(win);
      resultSound(win ? res.round.multiplier : 0);
      setHistory((h) => [{ roll: res.result.roll, win, id: Date.now() }, ...h].slice(0, 12));
      bet.setBalance(res.balance);
      setRefresh((r) => r + 1);
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }

  const winZone = over ? { left: `${target}%`, right: 0 } : { left: 0, right: `${100 - target}%` };

  return (
    <GameShell
      game="dice"
      refreshKey={refresh}
      controls={
        <>
          <BetAmount value={amount} onChange={setAmount} disabled={busy} />
          <InfoRow label="Profit on win" value={usd(stake * m - stake)} accent />
          <ActionBar>
            <PlayButton busy={busy} onClick={play}>
              Roll dice
            </PlayButton>
          </ActionBar>
        </>
      }
      stage={
        <div className="dice-stage">
          <div className="roll-history">
            {history.map((h) => (
              <span key={h.id} className={`rh-pill ${h.win ? 'win' : 'loss'}`}>
                {h.roll.toFixed(2)}
              </span>
            ))}
          </div>

          <div className="dice-board">
            <div className="dice-track">
              <div className="dt-bar">
                <div className="dt-win" style={winZone} />
              </div>
              <input
                type="range"
                className="dt-range"
                min={0}
                max={100}
                step={0.01}
                value={target}
                disabled={busy}
                onChange={(e) => setSlider(Number(e.target.value))}
                aria-label="Target"
              />
              {roll != null && (
                <div className={`dt-result ${won === null ? '' : won ? 'win' : 'loss'}`} style={{ left: `${roll}%` }}>
                  <span>{roll.toFixed(2)}</span>
                </div>
              )}
            </div>
            <div className="dice-scale">
              {[0, 25, 50, 75, 100].map((n) => (
                <span key={n} style={{ left: `${n}%` }}>
                  {n}
                </span>
              ))}
            </div>
          </div>

          <div className="dice-fields">
            <label className="field">
              <span>Multiplier</span>
              <div className="amount-input">
                <input
                  inputMode="decimal"
                  value={editMult ?? m.toFixed(4)}
                  disabled={busy}
                  onChange={(e) => setEditMult(e.target.value)}
                  onBlur={() => {
                    const x = Number(editMult);
                    if (x > 1) setChance(99 / x);
                    setEditMult(null);
                  }}
                />
                <b>×</b>
              </div>
            </label>
            <label className="field">
              <span>{over ? 'Roll over' : 'Roll under'}</span>
              <button type="button" className="amount-input flip-field" onClick={flip} disabled={busy}>
                <b className="ff-val">{target.toFixed(2)}</b>
                <LuArrowLeftRight size={16} />
              </button>
            </label>
            <label className="field">
              <span>Win chance</span>
              <div className="amount-input">
                <input
                  inputMode="decimal"
                  value={editChance ?? chance.toFixed(2)}
                  disabled={busy}
                  onChange={(e) => setEditChance(e.target.value)}
                  onBlur={() => {
                    const x = Number(editChance);
                    if (x > 0) setChance(x);
                    setEditChance(null);
                  }}
                />
                <b>%</b>
              </div>
            </label>
          </div>
          {won !== null && roll != null && (
            <div className={`stage-banner ${won ? 'win' : 'loss'}`}>
              {won ? `You won ${mult(m)} · ${usd(stake * m)}` : `Rolled ${roll.toFixed(2)} — no win`}
            </div>
          )}
        </div>
      }
    />
  );
}
