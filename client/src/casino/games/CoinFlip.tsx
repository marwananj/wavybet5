import { useRef, useState } from 'react';
import { usd } from '../../lib/format';
import { casino, mult, sleep } from '../api';
import { BetAmount, GameShell, InfoRow, PlayButton, Seg, useBet } from '../shared';
import { resultSound, sfx } from '../sound';

type Side = 'heads' | 'tails';
interface CoinResult {
  pick: Side;
  side: Side;
}
const WIN = 1.98;

function CoinFace({ side }: { side: Side }) {
  return (
    <div className={`coin-face ${side}`}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="43" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="2.5" />
        {side === 'heads' ? (
          <>
            <path d="M22 58c6-10 12-10 18 0s12 10 18 0 12-10 20-4" fill="none" stroke="rgba(90,55,0,.8)" strokeWidth="7" strokeLinecap="round" />
            <path d="M22 44c6-10 12-10 18 0s12 10 18 0 12-10 20-4" fill="none" stroke="#fff6d6" strokeWidth="6" strokeLinecap="round" />
          </>
        ) : (
          <text x="50" y="63" textAnchor="middle" fontSize="38" fontWeight="900" fill="#e8f3ff" fontFamily="Montserrat, sans-serif">
            W
          </text>
        )}
      </svg>
    </div>
  );
}

export function CoinFlipGame() {
  const bet = useBet();
  const [amount, setAmount] = useState('1.00');
  const [side, setSide] = useState<Side>('heads');
  const [rot, setRot] = useState(0);
  const [tossing, setTossing] = useState(false);
  const [result, setResult] = useState<{ side: Side; win: boolean } | null>(null);
  const [history, setHistory] = useState<{ side: Side; id: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const rotRef = useRef(0);
  const stake = Number(amount) || 0;

  async function play() {
    if (!bet.ensure(stake)) return;
    setBusy(true);
    setResult(null);
    bet.debit(stake);
    try {
      const res = await casino.play<CoinResult>('coinflip', { stake, side });
      // spin at least 6 full turns, land on the right face (heads = 0°, tails = 180°)
      const cur = rotRef.current;
      const base = cur - (cur % 360) + 360 * 6;
      const next = base + (res.result.side === 'tails' ? 180 : 0);
      rotRef.current = next;
      setTossing(true);
      setRot(next);
      sfx.whoosh(0.6);
      [0, 0.18, 0.34, 0.5, 0.64, 0.78, 0.9, 1.0, 1.1, 1.2].forEach((t) => setTimeout(() => sfx.tick(1.6), t * 1000));
      await sleep(1700);
      setTossing(false);
      sfx.coin();
      const win = res.round.status === 'WON';
      setTimeout(() => resultSound(win ? res.round.multiplier : 0), 250);
      setResult({ side: res.result.side, win });
      setHistory((h) => [{ side: res.result.side, id: Date.now() }, ...h].slice(0, 14));
      bet.setBalance(res.balance);
      setRefresh((r) => r + 1);
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <GameShell
      game="coinflip"
      refreshKey={refresh}
      controls={
        <>
          <BetAmount value={amount} onChange={setAmount} disabled={busy} />
          <span className="field-label">Pick a side</span>
          <Seg
            value={side}
            onChange={setSide}
            disabled={busy}
            options={[
              { v: 'heads', label: 'Heads' },
              { v: 'tails', label: 'Tails' },
            ]}
          />
          <InfoRow label="Payout" value={`${mult(WIN)} · ${usd(stake * WIN)}`} accent />
          <PlayButton busy={busy} onClick={play}>
            Flip coin
          </PlayButton>
        </>
      }
      stage={
        <div className="coin-stage">
          <div className="coin-history">
            {history.map((h) => (
              <span key={h.id} className={`ch ${h.side}`}>
                {h.side === 'heads' ? 'H' : 'T'}
              </span>
            ))}
          </div>
          <div className={`coin-toss ${tossing ? 'tossing' : ''}`}>
            <div className="coin3d" style={{ transform: `rotateY(${rot}deg)` }}>
              <CoinFace side="heads" />
              <CoinFace side="tails" />
              <div className="coin-edge" />
            </div>
          </div>
          <div className="coin-shadow" />
          {result && (
            <div className={`stage-banner ${result.win ? 'win' : 'loss'}`}>
              {result.side === 'heads' ? 'Heads' : 'Tails'} · {result.win ? `You win ${usd(stake * WIN)}` : 'no win'}
            </div>
          )}
        </div>
      }
    />
  );
}
