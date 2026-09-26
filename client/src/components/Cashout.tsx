import { useCallback, useEffect, useState } from 'react';
import { LuHandCoins } from 'react-icons/lu';
import { api, type ApiError } from '../lib/api';
import { odds as fmtOdds, usd } from '../lib/format';
import { Link } from '../lib/router';
import { useAuth, useToast } from '../lib/state';
import type { Bet } from '../lib/types';
import { Spinner } from './ui';

export interface Quote {
  available: boolean;
  amount?: string;
  reason?: string;
}

/** Live cash-out values for the player's open bets (refreshed every 8 s while visible). */
export function useCashoutQuotes(enabled: boolean) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const load = useCallback(() => api<{ quotes: Record<string, Quote> }>('/bets/cashout/quotes', { method: 'POST' }).then((d) => setQuotes(d.quotes)).catch(() => {}), []);
  useEffect(() => {
    if (!enabled) return;
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 8000);
    return () => clearInterval(t);
  }, [enabled, load]);
  return { quotes, reload: load };
}

export function CashoutButton({ bet, quote, onDone }: { bet: Pick<Bet, 'id' | 'stake'>; quote?: Quote; onDone: (amount: string) => void }) {
  const { setBalance } = useAuth();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 5000);
    return () => clearTimeout(t);
  }, [confirm]);
  if (!quote) return null;
  if (!quote.available)
    return (
      <button className="btn btn-ghost btn-sm cashout-btn off" disabled title={quote.reason}>
        <LuHandCoins size={15} /> Cash out {quote.reason === 'Suspended' ? '· suspended' : 'unavailable'}
      </button>
    );
  const go = async () => {
    if (!confirm) return setConfirm(true);
    setBusy(true);
    try {
      const d = await api<{ amount: string; balance: string }>(`/bets/${bet.id}/cashout`, { body: { amount: Number(quote.amount) } });
      setBalance(d.balance);
      toast('ok', `💰 Cashed out ${usd(d.amount)}`);
      onDone(d.amount);
    } catch (e) {
      toast('err', (e as ApiError).message);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  const up = Number(quote.amount) >= Number(bet.stake);
  return (
    <button className={`btn btn-sm cashout-btn ${confirm ? 'confirm' : ''} ${up ? 'up' : 'down'}`} onClick={go} disabled={busy}>
      {busy ? <Spinner /> : <LuHandCoins size={15} />}
      {confirm ? `Confirm ${usd(quote.amount)}` : `Cash out ${usd(quote.amount)}`}
    </button>
  );
}

/** Compact open-bets list with cash out, used inside the betslip. */
export function SlipOpenBets() {
  const { user } = useAuth();
  const [bets, setBets] = useState<Bet[] | null>(null);
  const { quotes, reload } = useCashoutQuotes(!!user);
  const load = useCallback(() => api<{ bets: Bet[] }>('/bets?status=open').then((d) => setBets(d.bets)).catch(() => setBets([])), []);
  useEffect(() => {
    if (user) load();
  }, [user, load]);
  if (!user) return <div className="slip-empty"><p>Log in to see your open bets</p></div>;
  if (bets === null) return <div className="slip-empty"><Spinner /></div>;
  if (!bets.length) return <div className="slip-empty"><p>No open bets</p><span>Your running bets and cash-out offers appear here.</span></div>;
  return (
    <div className="slip-open">
      {bets.map((b) => (
        <div key={b.id} className={`ob-card ${b.type === 'PARLAY' ? 'parlay' : ''}`}>
          <div className="ob-head">
            <b>{b.type === 'PARLAY' ? `${b.selections.length}-leg parlay` : b.type === 'BUILDER' ? 'Bet Builder' : 'Single'}</b>
            <span>@ {fmtOdds(b.totalOdds)}</span>
          </div>
          <ul className="ob-legs">
            {b.selections.map((s) => (
              <li key={s.id} className={`st-${s.status.toLowerCase()}`}>
                <i />
                <span className="ellipsis">
                  <b>{s.outcomeName}</b> · {s.eventLabel}
                </span>
              </li>
            ))}
          </ul>
          <div className="ob-foot">
            <span>
              {usd(b.stake)} → <b className="win">{usd(b.potentialPayout)}</b>
            </span>
            <CashoutButton
              bet={b}
              quote={quotes[b.id]}
              onDone={() => {
                load();
                reload();
              }}
            />
          </div>
        </div>
      ))}
      <Link to="/bets?tab=open" className="btn btn-ghost btn-sm btn-block">
        All my bets
      </Link>
    </div>
  );
}
