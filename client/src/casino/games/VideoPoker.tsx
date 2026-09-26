import { useEffect, useState } from 'react';
import { usd } from '../../lib/format';
import { casino, type Card, type Round } from '../api';
import { ActionBar, BetAmount, GameShell, PlayButton, PlayingCard, useBet } from '../shared';
import { resultSound, sfx } from '../sound';

interface VpResult {
  id: string | null;
  name: string;
  pays: number;
}
interface VpView {
  hand: Card[];
  held: boolean[];
  finished: boolean;
  result: VpResult | null;
  now: VpResult | null;
  paytable: { id: string; name: string; pays: number }[];
}
const PAYTABLE = [
  ['royal', 'Royal Flush', 800],
  ['sflush', 'Straight Flush', 50],
  ['quads', 'Four of a Kind', 25],
  ['full', 'Full House', 9],
  ['flush', 'Flush', 6],
  ['straight', 'Straight', 4],
  ['trips', 'Three of a Kind', 3],
  ['twopair', 'Two Pair', 2],
  ['jacks', 'Jacks or Better', 1],
] as const;

export function VideoPokerGame() {
  const bet = useBet();
  const [amount, setAmount] = useState('1.00');
  const [round, setRound] = useState<Round<VpView> | null>(null);
  const [held, setHeld] = useState<boolean[]>([false, false, false, false, false]);
  const [busy, setBusy] = useState(false);
  const [dealKey, setDealKey] = useState(0);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!bet.user) return;
    casino.active<VpView>('videopoker').then((d) => {
      if (d.round) {
        setRound(d.round);
        setHeld(d.round.view?.held ?? [false, false, false, false, false]);
      }
    }).catch(() => {});
  }, [bet.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = round?.view;
  const inPlay = !!v && !v.finished;
  const stake = Number(amount) || 0;
  const unit = round ? Number(round.stake) : stake;

  async function deal() {
    if (!bet.ensure(stake)) return;
    setBusy(true);
    bet.debit(stake);
    sfx.bet();
    try {
      const d = await casino.start<VpView>('videopoker', { stake });
      setRound(d.round);
      setHeld([false, false, false, false, false]);
      setDealKey((k) => k + 1);
      bet.setBalance(d.balance);
      [0, 0.08, 0.16, 0.24, 0.32].forEach((t) => sfx.deal(t));
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function draw() {
    if (!round) return;
    setBusy(true);
    try {
      const d = await casino.act<VpView>('videopoker', round.id, 'draw', { held });
      setRound(d.round);
      setDealKey((k) => k + 1);
      held.forEach((h, i) => !h && sfx.deal(i * 0.08));
      setTimeout(() => {
        const r = d.round.view?.result;
        resultSound(r && r.pays > 0 ? r.pays : 0);
        bet.setBalance(d.balance);
        setRefresh((x) => x + 1);
      }, 450);
    } catch (e) {
      bet.fail(e);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (i: number) => {
    if (!inPlay || busy) return;
    sfx.click();
    setHeld((h) => h.map((x, k) => (k === i ? !x : x)));
  };
  const hit = v?.finished ? v.result?.id : v?.now?.id;
  const cards = v?.hand ?? null;

  return (
    <GameShell
      game="videopoker"
      refreshKey={refresh}
      controls={
        <>
          <BetAmount value={amount} onChange={setAmount} disabled={busy || inPlay} />
          <ActionBar>
            {inPlay ? (
              <PlayButton busy={busy} onClick={draw}>
                Draw {held.filter(Boolean).length ? `· hold ${held.filter(Boolean).length}` : ''}
              </PlayButton>
            ) : (
              <PlayButton busy={busy} onClick={deal}>
                {v ? 'Deal again' : 'Deal'} · {usd(stake)}
              </PlayButton>
            )}
          </ActionBar>
          <small className="muted">Jacks or Better, full-pay 9/6 table — 99.54% RTP with perfect holds. Tap cards to hold them, then draw once.</small>
        </>
      }
      stage={
        <div className="vp-stage">
          <div className="vp-paytable">
            {PAYTABLE.map(([id, name, pays]) => (
              <div key={id} className={`vp-row ${hit === id ? (v?.finished ? 'hit' : 'now') : ''}`}>
                <span>{name}</span>
                <b>{pays}×</b>
                <em>{usd(unit * pays)}</em>
              </div>
            ))}
          </div>
          <div className="vp-cards">
            {(cards ?? Array.from({ length: 5 }, () => null)).map((c, i) => (
              <button
                key={`${dealKey}-${i}`}
                type="button"
                className={`vp-card ${held[i] && inPlay ? 'held' : ''} ${v?.finished && held[i] ? 'kept' : ''}`}
                onClick={() => toggle(i)}
                disabled={!inPlay}
              >
                <PlayingCard card={c} faceDown={!c} className={c && !(v?.finished && held[i]) ? 'deal' : ''} style={{ animationDelay: `${i * 80}ms` }} />
                <span className="vp-hold">{held[i] && (inPlay || v?.finished) ? 'HELD' : inPlay ? 'HOLD' : ''}</span>
              </button>
            ))}
          </div>
          <div className={`vp-result ${v?.finished ? (v.result && v.result.pays > 0 ? 'win' : 'loss') : ''}`}>
            {!v
              ? 'Place your bet and deal'
              : v.finished
                ? v.result && v.result.pays > 0
                  ? `${v.result.name} · you win ${usd(round!.payout)}`
                  : `${v.result?.name ?? 'No win'} · better luck next hand`
                : v.now && v.now.pays > 0
                  ? `You have ${v.now.name} — hold and draw`
                  : 'Choose cards to hold, then draw'}
          </div>
        </div>
      }
    />
  );
}
