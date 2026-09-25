import { useState } from 'react';
import { FaHandPaper, FaHandRock, FaHandScissors } from 'react-icons/fa';
import { usd } from '../../lib/format';
import { casino, mult, sleep } from '../api';
import { ActionBar, BetAmount, GameShell, InfoRow, PlayButton, useBet } from '../shared';
import { resultSound, sfx } from '../sound';

type Pick = 'rock' | 'paper' | 'scissors';
interface RpsResult {
  pick: Pick;
  house: Pick;
  outcome: 'win' | 'lose' | 'draw';
}
const ICON = { rock: FaHandRock, paper: FaHandPaper, scissors: FaHandScissors };
const WIN = 1.96;

export function RpsGame() {
  const bet = useBet();
  const [amount, setAmount] = useState('1.00');
  const [pick, setPick] = useState<Pick>('rock');
  const [shown, setShown] = useState<{ me: Pick; house: Pick } | null>(null);
  const [outcome, setOutcome] = useState<RpsResult['outcome'] | null>(null);
  const [shaking, setShaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [streak, setStreak] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const stake = Number(amount) || 0;

  async function play() {
    if (!bet.ensure(stake)) return;
    setBusy(true);
    setOutcome(null);
    setShown(null);
    setShaking(true);
    bet.debit(stake);
    sfx.bet();
    [0, 0.36, 0.72].forEach((t) => setTimeout(() => sfx.hop(), t * 1000));
    try {
      const [res] = await Promise.all([casino.play<RpsResult>('rps', { stake, pick }), sleep(1100)]);
      setShaking(false);
      setShown({ me: res.result.pick, house: res.result.house });
      setOutcome(res.result.outcome);
      sfx.clack();
      setTimeout(() => (res.result.outcome === 'win' ? sfx.win() : res.result.outcome === 'lose' ? sfx.lose() : sfx.coin()), 200);
      setStreak((s) => (res.result.outcome === 'win' ? s + 1 : res.result.outcome === 'lose' ? 0 : s));
      bet.setBalance(res.balance);
      setRefresh((r) => r + 1);
    } catch (e) {
      setShaking(false);
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }

  const Hand = ({ who, p }: { who: 'me' | 'house'; p: Pick }) => {
    const I = ICON[p];
    return (
      <div className={`rps-hand ${who} ${shaking ? 'shake' : ''} ${outcome && ((who === 'me' && outcome === 'win') || (who === 'house' && outcome === 'lose')) ? 'winner' : ''}`}>
        <I size={78} />
      </div>
    );
  };

  return (
    <GameShell
      game="rps"
      refreshKey={refresh}
      controls={
        <>
          <BetAmount value={amount} onChange={setAmount} disabled={busy} />
          <span className="field-label">Your move</span>
          <div className="rps-picks">
            {(['rock', 'paper', 'scissors'] as Pick[]).map((p) => {
              const I = ICON[p];
              return (
                <button key={p} className={`rps-pick ${pick === p ? 'on' : ''}`} onClick={() => setPick(p)} disabled={busy}>
                  <I size={26} />
                  <span>{p}</span>
                </button>
              );
            })}
          </div>
          <InfoRow label="Win pays" value={`${mult(WIN)} · ${usd(stake * WIN)}`} accent />
          <InfoRow label="Draw" value="Stake returned" />
          <ActionBar>
            <PlayButton busy={busy} onClick={play}>
              Play
            </PlayButton>
          </ActionBar>
        </>
      }
      stage={
        <div className="rps-stage">
          <div className="rps-arena">
            <div className="rps-side">
              <span className="rps-label">You</span>
              <Hand who="me" p={shaking || !shown ? 'rock' : shown.me} />
            </div>
            <div className="rps-vs">VS</div>
            <div className="rps-side">
              <span className="rps-label">WavyBet</span>
              <Hand who="house" p={shaking || !shown ? 'rock' : shown.house} />
            </div>
          </div>
          <div className="rps-streak">
            Win streak <b>{streak}</b>
          </div>
          {outcome && (
            <div className={`stage-banner ${outcome === 'win' ? 'win' : outcome === 'draw' ? 'push' : 'loss'}`}>
              {outcome === 'win' ? `You win ${mult(WIN)} · ${usd(stake * WIN)}` : outcome === 'draw' ? 'Draw — stake returned' : 'House wins'}
            </div>
          )}
        </div>
      }
    />
  );
}
