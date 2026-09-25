import { useEffect, useMemo, useState } from 'react';
import { LuBlocks, LuX } from 'react-icons/lu';
import { api, type ApiError } from '../lib/api';
import { odds as fmtOdds, usd } from '../lib/format';
import { useAuth, useToast } from '../lib/state';
import type { Market, Outcome, SportEvent } from '../lib/types';
import { Spinner } from './ui';

const KEYS = ['h2h', 'double_chance', 'btts', 'totals', 'ht_h2h', 'ht_totals', 'corners_totals', 'correct_score'];
const TITLE: Record<string, string> = {
  h2h: 'Match result',
  double_chance: 'Double chance',
  btts: 'Both teams to score',
  totals: 'Total goals',
  ht_h2h: '1st half result',
  ht_totals: '1st half goals',
  corners_totals: 'Total corners',
  correct_score: 'Correct score',
};

interface Leg {
  o: Outcome;
  m: Market;
}

/**
 * Bet Builder: combine selections from this one match into a single bet. The server prices the
 * combination as a whole (correlated legs are not simply multiplied).
 */
export function BetBuilder({ ev }: { ev: SportEvent }) {
  const { user, openAuth, setBalance } = useAuth();
  const toast = useToast();
  const [legs, setLegs] = useState<Leg[]>([]);
  const [quote, setQuote] = useState<{ price: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [stake, setStake] = useState('5');
  const [busy, setBusy] = useState(false);

  const markets = useMemo(
    () =>
      ev.markets
        .filter((m) => KEYS.includes(m.key))
        .map((m) => ({ ...m, outcomes: m.outcomes.filter((o) => o.point == null || !Number.isInteger(o.point)) }))
        .filter((m) => m.outcomes.length)
        .sort((a, b) => KEYS.indexOf(a.key) - KEYS.indexOf(b.key)),
    [ev.markets]
  );
  const ids = legs.map((l) => l.o.id).join(',');

  useEffect(() => {
    setQuote(null);
    setErr(null);
    if (legs.length < 2) return;
    let alive = true;
    setQuoting(true);
    const t = setTimeout(() => {
      api<{ price: number }>('/bets/builder/quote', { body: { eventId: ev.id, outcomeIds: legs.map((l) => l.o.id) } })
        .then((d) => alive && setQuote(d))
        .catch((e) => alive && setErr((e as ApiError).message))
        .finally(() => alive && setQuoting(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (m: Market, o: Outcome) =>
    setLegs((ls) => {
      if (ls.some((l) => l.o.id === o.id)) return ls.filter((l) => l.o.id !== o.id);
      // one pick per market line: replace the previous pick on the same line
      const same = (l: Leg) => l.m.key === m.key && (l.o.point ?? null) === (o.point ?? null);
      const next = ls.filter((l) => !same(l));
      if (next.length >= 8) return ls;
      return [...next, { m, o }];
    });

  const place = async () => {
    if (!user) return openAuth('login');
    if (!quote) return;
    const s = Number(stake);
    if (!(s > 0)) return toast('err', 'Enter a stake');
    setBusy(true);
    try {
      const d = await api<{ balance: string }>('/bets/builder', { body: { eventId: ev.id, outcomeIds: legs.map((l) => l.o.id), stake: s, odds: quote.price } });
      setBalance(d.balance);
      toast('ok', `Bet Builder placed · ${legs.length} legs @ ${fmtOdds(quote.price)}`);
      setLegs([]);
    } catch (e) {
      const ae = e as ApiError & { data?: { odds: number }[] };
      toast('err', ae.message);
      if (ae.data?.[0]?.odds) setQuote({ price: ae.data[0].odds });
    } finally {
      setBusy(false);
    }
  };

  if (ev.status !== 'UPCOMING') return <div className="notice">Bet Builder is available before kick-off.</div>;
  if (!markets.some((m) => m.key === 'h2h')) return <div className="notice">Bet Builder opens when this match's prices are published.</div>;

  const label = (m: Market, o: Outcome) =>
    m.key === 'h2h' || m.key === 'ht_h2h' ? (o.code === 'home' ? `1 · ${ev.homeTeam}` : o.code === 'away' ? `2 · ${ev.awayTeam}` : 'X · Draw') : o.name;

  return (
    <div className="bb">
      <div className="bb-intro">
        <LuBlocks size={18} />
        <div>
          <b>Bet Builder</b>
          <small>Combine 2–8 selections from this match into one bet. The price is calculated for the whole combination.</small>
        </div>
      </div>
      {markets.map((m) => (
        <section key={m.id} className="bb-market">
          <h4>{TITLE[m.key]}</h4>
          <div className={`bb-opts ${m.key === 'correct_score' ? 'cs' : ''}`}>
            {m.outcomes.map((o) => {
              const on = legs.some((l) => l.o.id === o.id);
              return (
                <button key={o.id} type="button" className={`bb-opt ${on ? 'on' : ''}`} disabled={m.suspended || o.suspended} onClick={() => toggle(m, o)}>
                  <span>{label(m, o)}</span>
                  <b>{fmtOdds(o.price)}</b>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <div className={`bb-slip ${legs.length ? 'has' : ''}`}>
        {legs.length === 0 ? (
          <p className="muted">Pick at least two selections to build your bet.</p>
        ) : (
          <>
            <ul>
              {legs.map((l) => (
                <li key={l.o.id}>
                  <span className="bb-dot" />
                  <div>
                    <b>{label(l.m, l.o)}</b>
                    <small>{TITLE[l.m.key]}</small>
                  </div>
                  <button type="button" onClick={() => toggle(l.m, l.o)} aria-label="Remove">
                    <LuX size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="bb-price">
              <span>Bet Builder odds</span>
              <b>{quoting ? <Spinner /> : quote ? fmtOdds(quote.price) : legs.length < 2 ? '—' : '✕'}</b>
            </div>
            {err && <p className="bb-err">{err}</p>}
            <div className="bb-stake">
              <label>
                $<input inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value.replace(/[^0-9.]/g, ''))} />
              </label>
              <span>
                Returns <b>{usd((Number(stake) || 0) * (quote?.price ?? 0))}</b>
              </span>
            </div>
            <button type="button" className="btn btn-primary btn-block" disabled={!quote || busy || quoting} onClick={place}>
              {busy ? <Spinner /> : user ? `Place Bet Builder · ${usd(Number(stake) || 0)}` : 'Log in to bet'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
