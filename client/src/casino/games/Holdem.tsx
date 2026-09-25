import { useEffect, useRef, useState } from 'react';
import { LuChevronDown } from 'react-icons/lu';
import { usd } from '../../lib/format';
import { casino, type Card, type Round } from '../api';
import { ActionBar, BetAmount, GameShell, PlayButton, PlayingCard, useBet, useCasinoConfig } from '../shared';
import { resultSound, sfx } from '../sound';

interface Outcome {
  playerHand: string;
  dealerHand: string;
  playerBest: number[]; // indexes into [hole0, hole1, board0..4]
  dealerBest: number[];
  qualifies: boolean;
  winner: 'player' | 'dealer' | 'tie';
  ante: number;
  call: number;
  aaReturn: number;
  stakeUnits: number;
  payoutUnits: number;
}
interface HoldemView {
  player: Card[];
  board: Card[];
  dealer: Card[] | null;
  aa: number;
  finished: boolean;
  folded: boolean;
  called: boolean;
  playerNow: string;
  aaPays: number;
  outcome?: Outcome;
}

const ANTE_ROWS: [string, string][] = [
  ['Royal flush', '100:1'],
  ['Straight flush', '20:1'],
  ['Four of a kind', '10:1'],
  ['Full house', '3:1'],
  ['Flush', '2:1'],
  ['Straight or lower', '1:1'],
];
const AA_ROWS: [string, string][] = [
  ['Royal flush', '100:1'],
  ['Straight flush', '50:1'],
  ['Four of a kind', '40:1'],
  ['Full house', '30:1'],
  ['Flush', '20:1'],
  ['Straight', '7:1'],
  ['Three of a kind', '7:1'],
  ['Two pair', '7:1'],
  ['Pair of Aces', '7:1'],
];

function Paytable({ title, rows, hit }: { title: string; rows: [string, string][]; hit?: string }) {
  const [open, setOpen] = useState(title.startsWith('AA'));
  return (
    <div className={`he-pay ${open ? 'open' : ''}`}>
      <button type="button" onClick={() => setOpen(!open)}>
        {title} <LuChevronDown size={15} />
      </button>
      {open && (
        <table>
          <tbody>
            {rows.map(([h, p]) => (
              <tr key={h} className={hit && (hit === h || (h === 'Straight or lower' && ['Straight', 'Three of a kind', 'Two pair', 'Pair', 'High card'].includes(hit))) ? 'hit' : ''}>
                <td>{h}</td>
                <td>{p}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const Spot = ({ label, amount, state }: { label: string; amount: number; state?: 'win' | 'lose' | 'push' | '' }) => (
  <div className={`he-spot ${amount > 0 ? 'has' : ''} ${state ?? ''}`}>
    <span>{label}</span>
    {amount > 0 && <b className="he-chip">{amount >= 100 ? Math.round(amount) : amount.toFixed(2).replace(/\.00$/, '')}</b>}
  </div>
);

export function HoldemGame() {
  const bet = useBet();
  useCasinoConfig();
  const [ante, setAnte] = useState('1.00');
  const [aa, setAa] = useState('0.00');
  const [round, setRound] = useState<Round<HoldemView> | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [fresh, setFresh] = useState(false);
  const [revealStep, setRevealStep] = useState(5); // staged reveal of turn / river / dealer
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!bet.user) return;
    casino.active<HoldemView>('holdem').then((d) => d.round && setRound(d.round)).catch(() => {});
  }, [bet.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const v = round?.view;
  const inPlay = !!v && !v.finished;
  const anteN = Number(ante) || 0;
  const aaN = Number(aa) || 0;
  const unit = round && v ? Number(round.stake) / (1 + (v.called ? 2 : 0) + v.aa) : anteN;

  async function deal() {
    const total = anteN + aaN;
    if (!bet.ensure(total)) return;
    setBusy(true);
    bet.debit(total);
    sfx.bet();
    try {
      const d = await casino.start<HoldemView>('holdem', { stake: anteN, aa: aaN > 0 ? aaN : undefined });
      setFresh(true);
      setRevealStep(0);
      setRound(d.round);
      bet.setBalance(d.balance);
      [0, 0.12, 0.24, 0.36].forEach((t) => sfx.deal(t));
      [0.75, 0.9, 1.05].forEach((t) => sfx.flip(t));
      timers.current.push(window.setTimeout(() => setFresh(false), 1400));
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function act(action: 'call' | 'fold') {
    if (!round) return;
    if (action === 'call' && !bet.ensure(unit * 2)) return;
    setBusy(true);
    if (action === 'call') {
      bet.debit(unit * 2);
      sfx.chip();
    }
    try {
      const d = await casino.act<HoldemView>('holdem', round.id, action);
      setRound(d.round);
      setRevealStep(0);
      // turn → river → dealer cards, one beat apart
      const steps = [350, 800, 1350];
      steps.forEach((ms, i) =>
        timers.current.push(
          window.setTimeout(() => {
            setRevealStep(i + 1);
            sfx.flip();
          }, ms)
        )
      );
      timers.current.push(
        window.setTimeout(() => {
          setRevealStep(5);
          bet.setBalance(d.balance);
          setRefresh((r) => r + 1);
          const net = Number(d.round.payout) - Number(d.round.stake);
          resultSound(net > 0 ? Math.max(1.01, d.round.multiplier) : net === 0 ? 1 : 0);
        }, 1900)
      );
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }

  const o = v?.outcome;
  const showAll = !!o && revealStep >= 5;
  const boardShown = (i: number) => !!v && (i < 3 || (v.finished && revealStep >= i - 2));
  const dealerShown = !!v?.finished && revealStep >= 3;
  const best = (who: 'p' | 'd', idx: number) => {
    if (!showAll || !o) return '';
    const set = who === 'p' ? o.playerBest : o.dealerBest;
    return set.includes(idx) ? 'best' : 'dimmed';
  };
  const net = showAll && round ? Number(round.payout) - Number(round.stake) : null;
  const antePart = o ? o.ante : 0;
  const spotState = (ret: number, stakeU: number): 'win' | 'lose' | 'push' | '' => (!showAll ? '' : ret > stakeU ? 'win' : ret === stakeU ? 'push' : 'lose');

  return (
    <GameShell
      game="holdem"
      refreshKey={refresh}
      controls={
        <>
          <BetAmount value={ante} onChange={setAnte} disabled={busy || inPlay} label="Ante" />
          <BetAmount value={aa} onChange={setAa} disabled={busy || inPlay} label="AA Bonus (optional side bet)" />
          <ActionBar>
          {inPlay ? (
            <div className="he-actions">
              <button className="btn btn-ghost" disabled={busy} onClick={() => (sfx.click(), act('fold'))}>
                Fold
              </button>
              <PlayButton busy={busy} onClick={() => act('call')}>
                Call {usd(unit * 2)}
              </PlayButton>
            </div>
          ) : (
            <PlayButton busy={busy} onClick={deal}>
              {v ? 'Deal again' : 'Deal'} · {usd(anteN + aaN)}
            </PlayButton>
          )}
          </ActionBar>
          <Paytable title="Ante pays" rows={ANTE_ROWS} hit={showAll && o && v?.called && (o.winner === 'player' || !o.qualifies) ? o.playerHand : undefined} />
          <Paytable
            title="AA Bonus pays"
            rows={AA_ROWS}
            hit={v && v.aa > 0 && v.aaPays > 0 ? (v.playerNow === 'Pair' ? 'Pair of Aces' : v.playerNow) : undefined}
          />
          <small className="muted">Dealer qualifies with a pair of 4s or better. If not, the Ante pays and the Call pushes. AA Bonus uses your two cards + the flop and pays even if you fold.</small>
        </>
      }
      stage={
        <div className="he-table">
          <div className="he-felt-text">CASINO HOLD'EM · AA BONUS PAYS 7 TO 1</div>
          <div className="he-dealer">
            <div className="he-cards">
              {v ? (
                [0, 1].map((i) => (
                  <PlayingCard
                    key={`d${i}-${round!.id}`}
                    card={dealerShown ? v.dealer?.[i] : null}
                    faceDown={!dealerShown}
                    className={`deal ${dealerShown ? best('d', i) : ''}`}
                    style={{ animationDelay: fresh ? `${120 + i * 240}ms` : '0ms' }}
                  />
                ))
              ) : (
                <>
                  <PlayingCard faceDown className="ghost" />
                  <PlayingCard faceDown className="ghost" />
                </>
              )}
            </div>
            <span className="he-label">
              Dealer
              {showAll && o && (
                <>
                  {' · '}
                  <b>{o.dealerHand}</b> <em className={o.qualifies ? 'q' : 'nq'}>{o.qualifies ? 'qualifies' : "doesn't qualify"}</em>
                </>
              )}
            </span>
          </div>

          <div className="he-board">
            {[0, 1, 2, 3, 4].map((i) =>
              v ? (
                <PlayingCard
                  key={`b${i}-${round!.id}`}
                  card={boardShown(i) ? v.board[i] : null}
                  faceDown={!boardShown(i)}
                  className={`deal ${i >= 3 && !boardShown(i) ? 'he-slot' : ''} ${best('p', i + 2)}`}
                  style={{ animationDelay: fresh ? `${600 + i * 150}ms` : '0ms' }}
                />
              ) : (
                <PlayingCard key={i} faceDown className="ghost" />
              )
            )}
          </div>

          <div className="he-player">
            <div className="he-spots">
              <Spot label="ANTE" amount={v ? unit : anteN} state={v?.folded && showAll ? 'lose' : spotState(antePart, 1)} />
              <Spot label="CALL" amount={v?.called ? unit * 2 : 0} state={o && v?.called ? spotState(o.call, 2) : ''} />
              <Spot label="AA BONUS" amount={v ? unit * v.aa : aaN} state={v && v.aa > 0 && showAll ? (o && o.aaReturn > 0 ? 'win' : 'lose') : ''} />
            </div>
            <div className="he-cards">
              {v ? (
                v.player.map((c, i) => (
                  <PlayingCard key={`p${i}-${round!.id}`} card={c} className={`deal ${best('p', i)} ${v.folded ? 'folded' : ''}`} style={{ animationDelay: fresh ? `${i * 240}ms` : '0ms' }} />
                ))
              ) : (
                <>
                  <PlayingCard faceDown className="ghost" />
                  <PlayingCard faceDown className="ghost" />
                </>
              )}
            </div>
            <span className="he-label">
              {v ? (
                <>
                  You · <b>{showAll && o ? o.playerHand : v.playerNow}</b>
                  {v.aa > 0 && !v.finished && v.aaPays > 0 && <em className="q"> AA Bonus hit {v.aaPays}:1!</em>}
                </>
              ) : (
                'Place your Ante and deal'
              )}
            </span>
          </div>

          {net != null && o && (
            <div className={`stage-banner ${net > 0 ? 'win' : net === 0 ? 'push' : 'loss'}`}>
              {v!.folded
                ? `Folded${o.aaReturn > 0 ? ` · AA Bonus pays ${usd(Number(round!.payout))}` : ''}`
                : net > 0
                  ? `You win ${usd(round!.payout)}${!o.qualifies ? ' · dealer did not qualify' : ''}`
                  : net === 0
                    ? 'Push — stakes returned'
                    : `Dealer wins${Number(round!.payout) > 0 ? ` · returned ${usd(round!.payout)}` : ''}`}
            </div>
          )}
        </div>
      }
    />
  );
}
