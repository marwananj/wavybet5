import { useEffect, useState } from 'react';
import { usd } from '../../lib/format';
import { casino, type Card, type Round } from '../api';
import { ActionBar, BetAmount, GameShell, PlayButton, PlayingCard, useBet } from '../shared';
import { resultSound, sfx } from '../sound';

interface Hand {
  cards: Card[];
  stake: number;
  done: boolean;
  doubled?: boolean;
  fromSplit?: boolean;
  result?: 'win' | 'lose' | 'push' | 'blackjack' | 'bust';
  payout?: number;
  total: { total: number; soft: boolean };
}
interface BjView {
  dealer: Card[];
  dealerHidden: boolean;
  dealerTotal: { total: number; soft: boolean };
  hands: Hand[];
  active: number;
  finished: boolean;
  actions: ('hit' | 'stand' | 'double' | 'split')[];
}
const fmtTotal = (t: { total: number; soft: boolean }) => (t.soft && t.total < 21 ? `${t.total - 10}/${t.total}` : String(t.total));
const RESULT: Record<string, string> = { win: 'WIN', lose: 'LOSE', push: 'PUSH', blackjack: 'BLACKJACK', bust: 'BUST' };

const endSound = (r: Round) => {
  const net = Number(r.payout) - Number(r.stake);
  resultSound(net > 0 ? Math.max(1.01, r.multiplier) : net === 0 ? 1 : 0);
};

export function BlackjackGame() {
  const bet = useBet();
  const [amount, setAmount] = useState('1.00');
  const [round, setRound] = useState<Round<BjView> | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [fresh, setFresh] = useState(false); // stagger the opening deal

  useEffect(() => {
    if (!bet.user) return;
    casino.active<BjView>('blackjack').then((d) => d.round && setRound(d.round)).catch(() => {});
  }, [bet.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = round?.view;
  const inPlay = !!v && !v.finished;
  const base = round ? Number(round.stake) / Math.max(1, v?.hands.reduce((a, h) => a + h.stake, 0) ?? 1) : Number(amount) || 0;

  async function deal() {
    const stake = Number(amount) || 0;
    if (!bet.ensure(stake)) return;
    setBusy(true);
    bet.debit(stake);
    try {
      sfx.bet();
      const d = await casino.start<BjView>('blackjack', { stake });
      [0, 0.15, 0.3, 0.45].forEach((t) => sfx.deal(t));
      setFresh(true);
      setRound(d.round);
      bet.setBalance(d.balance);
      if (d.round.view?.finished) {
        setRefresh((r) => r + 1);
        setTimeout(() => endSound(d.round), 900);
      }
      setTimeout(() => setFresh(false), 900);
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function act(action: 'hit' | 'stand' | 'double' | 'split') {
    if (!round) return;
    if ((action === 'double' || action === 'split') && !bet.ensure(base)) return;
    setBusy(true);
    if (action === 'double' || action === 'split') bet.debit(base);
    try {
      const d = await casino.act<BjView>('blackjack', round.id, action);
      if (action !== 'stand') sfx.deal();
      if (d.round.view?.finished) {
        sfx.flip(0.1);
        setTimeout(() => endSound(d.round), 450);
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

  const can = (a: BjView['actions'][number]) => !!v?.actions.includes(a) && !busy;
  const net = round && v?.finished ? Number(round.payout) - Number(round.stake) : null;

  return (
    <GameShell
      game="blackjack"
      refreshKey={refresh}
      controls={
        <>
          <BetAmount value={amount} onChange={setAmount} disabled={busy || inPlay} />
          <ActionBar>
          {inPlay ? (
            <div className="bj-actions">
              <button className="btn btn-primary" disabled={!can('hit')} onClick={() => act('hit')}>
                Hit
              </button>
              <button className="btn btn-ghost" disabled={!can('stand')} onClick={() => act('stand')}>
                Stand
              </button>
              <button className="btn btn-ghost" disabled={!can('double')} onClick={() => act('double')}>
                Double <small>+{usd(base)}</small>
              </button>
              <button className="btn btn-ghost" disabled={!can('split')} onClick={() => act('split')}>
                Split <small>+{usd(base)}</small>
              </button>
            </div>
          ) : (
            <PlayButton busy={busy} onClick={deal}>
              {v?.finished ? 'Deal again' : 'Deal'}
            </PlayButton>
          )}
          </ActionBar>
          <small className="muted">Blackjack pays 3:2 · Dealer stands on all 17s · Double on any two cards · One split</small>
        </>
      }
      stage={
        <div className="bj-table">
          <div className="bj-shoe" aria-hidden />
          <div className="bj-dealer">
            <div className="bj-cards">
              {v ? (
                <>
                  {v.dealer.map((c, i) => (
                    <PlayingCard key={`d${i}`} card={c} className="deal" style={{ animationDelay: fresh ? `${i === 0 ? 150 : 450 + (i - 1) * 150}ms` : '0ms' }} />
                  ))}
                  {v.dealerHidden && <PlayingCard key="d1" faceDown className="deal" style={{ animationDelay: fresh ? '450ms' : '0ms' }} />}
                </>
              ) : (
                <>
                  <PlayingCard faceDown className="ghost" />
                  <PlayingCard faceDown className="ghost" />
                </>
              )}
            </div>
            {v && <span className="bj-total">{fmtTotal(v.dealerTotal)}</span>}
            <span className="bj-label">Dealer</span>
          </div>

          <div className="bj-arc">BLACKJACK PAYS 3 TO 2 · DEALER STANDS ON ALL 17</div>
          <div className={`bj-hands ${v && v.hands.length > 1 ? 'split' : ''}`}>
            {v ? (
              v.hands.map((h, hi) => (
                <div key={hi} className={`bj-hand ${inPlay && v.active === hi ? 'active' : ''} ${h.result ? `r-${h.result}` : ''}`}>
                  <div className="bj-cards">
                    {h.cards.map((c, i) => (
                      <PlayingCard key={`p${hi}-${i}`} card={c} className="deal" style={{ animationDelay: fresh && v.hands.length === 1 ? `${i === 0 ? 0 : 300}ms` : '0ms' }} />
                    ))}
                  </div>
                  <span className="bj-total">{fmtTotal(h.total)}</span>
                  {h.result && <span className={`bj-result ${h.result}`}>{RESULT[h.result]}</span>}
                  {h.doubled && <span className="bj-tag">2×</span>}
                </div>
              ))
            ) : (
              <div className="bj-hand">
                <div className="bj-cards">
                  <PlayingCard faceDown className="ghost" />
                  <PlayingCard faceDown className="ghost" />
                </div>
                <span className="bj-label">Place your bet and deal</span>
              </div>
            )}
          </div>

          {net != null && (
            <div className={`stage-banner ${net > 0 ? 'win' : net === 0 ? 'push' : 'loss'}`}>
              {net > 0 ? `You win ${usd(round!.payout)}` : net === 0 ? 'Push — stake returned' : `Dealer wins${Number(round!.payout) > 0 ? ` · returned ${usd(round!.payout)}` : ''}`}
            </div>
          )}
        </div>
      }
    />
  );
}
