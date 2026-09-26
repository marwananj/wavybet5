import { useEffect, useMemo, useState } from 'react';
import { LuChevronDown, LuTicket, LuTrash2, LuX, LuCircleAlert, LuShare2 } from 'react-icons/lu';
import { api, ApiError } from '../lib/api';
import { marketLabel, odds as fmtOdds, usd } from '../lib/format';
import { useAuth, useSlip, useToast } from '../lib/state';
import { Link } from '../lib/router';
import { Spinner } from './ui';
import { SlipOpenBets } from './Cashout';
import { LoadCode, ShareSlip, useSlipLinkLoader } from './SlipShare';
import { OddsFormatSelect } from './OddsFormatSelect';

type Mode = 'singles' | 'parlay';
const QUICK = [5, 10, 25, 50, 100];

export function Betslip() {
  const slip = useSlip();
  const { user, openAuth, setBalance } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('singles');
  const [parlayStake, setParlayStake] = useState('');
  const [accept, setAccept] = useState<'none' | 'higher' | 'any'>('higher');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<number | null>(null);
  const [view, setView] = useState<'slip' | 'open'>('slip');
  const [sharing, setSharing] = useState(false);
  useSlipLinkLoader();

  const picks = slip.picks;
  const n = picks.length;
  const sameEvent = new Set(picks.map((p) => p.eventId)).size !== n;

  useEffect(() => {
    if (n >= 2 && !sameEvent) setMode((m) => (m === 'singles' && n === 2 ? 'parlay' : m));
    if (n < 2) setMode('singles');
  }, [n, sameEvent]);

  useEffect(() => setError(null), [n, mode]);

  const parlayOdds = useMemo(() => picks.reduce((a, p) => a * p.odds, 1), [picks]);
  const totalStake = mode === 'parlay' ? Number(parlayStake || 0) : picks.reduce((a, p) => a + Number(p.stake || 0), 0);
  const potential = mode === 'parlay' ? Number(parlayStake || 0) * parlayOdds : picks.reduce((a, p) => a + Number(p.stake || 0) * p.odds, 0);
  // only interrupt the user for changes their odds preference doesn't auto-accept
  const changed = picks.some(
    (p) => p.prevOdds && p.prevOdds !== p.odds && (accept === 'none' || (accept === 'higher' && p.odds < p.prevOdds))
  );
  const unavailable = picks.some((p) => p.unavailable);
  const insufficient = !!user && totalStake > Number(user.balance);

  async function place() {
    if (!user) return openAuth('login');
    setError(null);
    setBusy(true);
    try {
      const body =
        mode === 'parlay'
          ? { mode, stake: Number(parlayStake), acceptOddsChanges: accept, selections: picks.map((p) => ({ outcomeId: p.outcomeId, odds: p.odds })) }
          : {
              mode,
              acceptOddsChanges: accept,
              selections: picks.filter((p) => Number(p.stake) > 0).map((p) => ({ outcomeId: p.outcomeId, odds: p.odds, stake: Number(p.stake) })),
            };
      if (!body.selections.length) throw new ApiError(400, 'Enter a stake');
      const d = await api<{ bets: unknown[]; balance: string }>('/bets', { body });
      setBalance(d.balance);
      setPlaced(d.bets.length);
      toast('ok', d.bets.length > 1 ? `${d.bets.length} bets placed` : 'Bet placed — good luck!');
      slip.clear();
      setParlayStake('');
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'ODDS_CHANGED' && Array.isArray(err.data)) {
        for (const c of err.data as { outcomeId: string; odds: number | null }[]) {
          const p = picks.find((x) => x.outcomeId === c.outcomeId);
          if (!p) continue;
          if (c.odds === null) slip.update(c.outcomeId, { unavailable: true });
          else slip.update(c.outcomeId, { prevOdds: p.odds, odds: c.odds });
        }
      }
      if (err.code === 'EMAIL_UNVERIFIED') openAuth('verify');
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const acceptChanges = () => slip.replaceAll(picks.map((p) => ({ ...p, prevOdds: undefined })));

  return (
    <>
      <div className={`slip-backdrop${slip.open ? ' show' : ''}`} onClick={() => slip.setOpen(false)} />
      <aside className={`betslip${slip.open ? ' open' : ''}`} aria-label="Betslip">
        <button className="slip-bar" onClick={() => slip.setOpen(!slip.open)}>
          <span className="slip-bar-left">
            <LuTicket size={20} />
            Betslip
            {n > 0 && <span className="slip-count">{n}</span>}
            {slip.quick.on && <span className="slip-quick-tag">⚡ Quick {usd(slip.quick.stake)}</span>}
          </span>
          <span className="slip-bar-right">
            {n > 1 && mode === 'parlay' && <span className="slip-bar-odds">{fmtOdds(parlayOdds)}</span>}
            <LuChevronDown className="slip-chev" size={18} />
          </span>
        </button>

        <div className="slip-body">
          <QuickBetBar />
          <div className="slip-views">
            <button className={view === 'slip' ? 'on' : ''} onClick={() => setView('slip')}>
              Betslip {n > 0 && <em>{n}</em>}
            </button>
            <button className={view === 'open' ? 'on' : ''} onClick={() => setView('open')}>
              My bets · Cash out
            </button>
          </div>
          {view === 'open' ? (
            <SlipOpenBets />
          ) : placed !== null && n === 0 ? (
            <div className="slip-empty">
              <div className="slip-success">✓</div>
              <p>
                <b>{placed > 1 ? `${placed} bets placed` : 'Bet placed'}</b>
              </p>
              <Link to="/bets?tab=open" className="btn btn-ghost btn-sm" onClick={() => { slip.setOpen(false); setPlaced(null); }}>
                View open bets
              </Link>
            </div>
          ) : n === 0 ? (
            <div className="slip-empty">
              <LuTicket size={34} />
              <p>Your betslip is empty</p>
              <span>Tap any odds to add a selection.</span>
              <LoadCode />
            </div>
          ) : (
            <>
              <div className="slip-tabs">
                <button className={mode === 'singles' ? 'on' : ''} onClick={() => setMode('singles')}>
                  Singles
                </button>
                <button className={mode === 'parlay' ? 'on' : ''} onClick={() => setMode('parlay')} disabled={n < 2 || sameEvent} title={sameEvent ? 'Two picks from the same match cannot be combined' : ''}>
                  Parlay
                </button>
                <button className={`slip-share-btn${sharing ? ' on' : ''}`} onClick={() => setSharing((x) => !x)} aria-label="Share betslip" title="Share / save this betslip">
                  <LuShare2 size={16} />
                </button>
                <button className="slip-clear" onClick={slip.clear} aria-label="Clear betslip">
                  <LuTrash2 size={16} />
                </button>
              </div>
              {sharing && <ShareSlip onClose={() => setSharing(false)} />}

              <div className={`slip-picks${mode === 'parlay' ? ' parlay' : ''}`}>
                {picks.map((p) => (
                  <div key={p.outcomeId} className={`pick${p.unavailable ? ' dead' : ''}`}>
                    <div className="pick-top">
                      <div className="pick-info">
                        <b className="ellipsis">
                          {p.live && <span className="live-dot" aria-label="Live" />}
                          {p.outcomeName}
                        </b>
                        <span className="ellipsis">{p.eventLabel}</span>
                        <small>{marketLabel(p.marketKey)}</small>
                      </div>
                      <div className="pick-right">
                        <button className="icon-btn" onClick={() => slip.remove(p.outcomeId)} aria-label="Remove">
                          <LuX size={16} />
                        </button>
                        <span className={`pick-odds${p.prevOdds ? (p.odds > p.prevOdds ? ' up' : ' down') : ''}`}>
                          {p.prevOdds && <s>{fmtOdds(p.prevOdds)}</s>}
                          {p.unavailable ? (p.live ? 'Suspended' : 'Closed') : fmtOdds(p.odds)}
                        </span>
                      </div>
                    </div>
                    {mode === 'singles' && !p.unavailable && (
                      <div className="pick-stake">
                        <label className="stake-input">
                          <span>$</span>
                          <input inputMode="decimal" placeholder="Stake" value={p.stake ?? ''} onChange={(e) => slip.update(p.outcomeId, { stake: e.target.value.replace(/[^0-9.]/g, '') })} />
                        </label>
                        <span className="pick-win">
                          Win <b>{usd(Number(p.stake || 0) * p.odds)}</b>
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className={`slip-foot${mode === 'parlay' ? ' parlay' : ''}`}>
                {mode === 'parlay' && (
                  <>
                    <AccaInsurance picks={picks} />
                    <div className="parlay-card">
                      <div>
                        <small>{n}-leg parlay</small>
                        <b>{picks.map((p) => fmtOdds(p.odds)).join(' × ')}</b>
                      </div>
                      <span className="parlay-odds">{fmtOdds(parlayOdds)}</span>
                    </div>
                    <label className="stake-input big">
                      <span>$</span>
                      <input inputMode="decimal" placeholder="Stake" value={parlayStake} onChange={(e) => setParlayStake(e.target.value.replace(/[^0-9.]/g, ''))} />
                    </label>
                    <div className="quick-stakes">
                      {QUICK.map((q) => (
                        <button key={q} onClick={() => setParlayStake(String(Number(parlayStake || 0) + q))}>
                          +{q}
                        </button>
                      ))}
                      {user && <button onClick={() => setParlayStake(String(Math.floor(Number(user.balance) * 100) / 100))}>Max</button>}
                    </div>
                  </>
                )}
                <div className="slip-line">
                  <span>Total stake</span>
                  <b>{usd(totalStake)}</b>
                </div>
                <div className="slip-line">
                  <span>Potential win</span>
                  <b className="win">{usd(potential)}</b>
                </div>
                <label className="slip-accept">
                  <span>Odds changes</span>
                  <select value={accept} onChange={(e) => setAccept(e.target.value as typeof accept)}>
                    <option value="higher">Accept higher</option>
                    <option value="any">Accept any</option>
                    <option value="none">Ask me</option>
                  </select>
                </label>
                <div className="slip-accept">
                  <OddsFormatSelect compact />
                </div>
                {(error || unavailable || insufficient) && (
                  <div className="slip-error">
                    <LuCircleAlert size={16} />
                    {unavailable ? (picks.some((p) => p.unavailable && p.live) ? 'A live market is suspended — wait for it to reopen or remove it' : 'Remove closed selections to continue') : insufficient ? 'Insufficient balance' : error}
                  </div>
                )}
                {changed && !unavailable ? (
                  <button className="btn btn-warn btn-block" onClick={acceptChanges}>
                    Accept new odds
                  </button>
                ) : !user ? (
                  <button className="btn btn-primary btn-block" onClick={() => openAuth('login')}>
                    Log in to place bet
                  </button>
                ) : insufficient ? (
                  <Link to="/wallet" className="btn btn-primary btn-block" onClick={() => slip.setOpen(false)}>
                    Deposit
                  </Link>
                ) : (
                  <button className="btn btn-primary btn-block" disabled={busy || unavailable || totalStake <= 0} onClick={place}>
                    {busy ? (
                      <>
                        <Spinner /> {picks.some((p) => p.live) ? 'Accepting live bet…' : ''}
                      </>
                    ) : (
                      `Place bet ${totalStake > 0 ? usd(totalStake) : ''}`
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

/** ⚡ Quick Bet: one tap on any price places a single with this stake */
function QuickBetBar() {
  const slip = useSlip();
  const { quick, setQuick } = slip;
  const [edit, setEdit] = useState(String(quick.stake));
  return (
    <div className={`quickbet${quick.on ? ' on' : ''}`}>
      <button type="button" className="qb-toggle" onClick={() => setQuick({ ...quick, on: !quick.on })} aria-pressed={quick.on}>
        <span className="qb-switch">
          <i />
        </span>
        <span>
          <b>⚡ Quick Bet</b>
          <small>{quick.on ? 'One tap on any odds places your bet' : 'Off — taps add to the betslip'}</small>
        </span>
      </button>
      {quick.on && (
        <div className="qb-stakes">
          {[1, 5, 10, 25].map((v) => (
            <button key={v} type="button" className={quick.stake === v ? 'on' : ''} onClick={() => (setQuick({ ...quick, stake: v }), setEdit(String(v)))}>
              ${v}
            </button>
          ))}
          <label>
            $
            <input
              inputMode="decimal"
              value={edit}
              onChange={(e) => setEdit(e.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={() => {
                const v = Math.max(0, Math.round(Number(edit) * 100) / 100);
                setQuick({ ...quick, stake: v });
                setEdit(String(v));
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

let rulesP: Promise<{ accaInsurance: { minLegs: number; minOdds: number; max: number } }> | null = null;
/** 🛡️ Acca Insurance progress in the slip */
function AccaInsurance({ picks }: { picks: { odds: number }[] }) {
  const [r, setR] = useState<{ minLegs: number; minOdds: number; max: number } | null>(null);
  useEffect(() => {
    (rulesP ??= api('/bets/rules')).then((d) => setR(d.accaInsurance)).catch(() => (rulesP = null));
  }, []);
  if (!r || !(r.max > 0)) return null;
  const good = picks.filter((p) => p.odds >= r.minOdds).length;
  const low = picks.length - good;
  const on = low === 0 && picks.length >= r.minLegs;
  return (
    <div className={`acca-ins ${on ? 'on' : ''}`}>
      <span className="ai-ico">🛡️</span>
      <div>
        <b>{on ? 'Acca Insurance active' : 'Acca Insurance'}</b>
        <small>
          {on
            ? `If just one leg loses, your stake comes back as bonus (up to ${usd(r.max)}).`
            : low > 0
              ? `Every leg needs odds ${r.minOdds.toFixed(2)}+ (${low} below).`
              : `Add ${r.minLegs - picks.length} more leg${r.minLegs - picks.length > 1 ? 's' : ''} (${r.minLegs}+ legs, each ${r.minOdds.toFixed(2)}+).`}
        </small>
      </div>
      <div className="ai-dots">
        {Array.from({ length: r.minLegs }, (_, i) => (
          <i key={i} className={i < Math.min(good, r.minLegs) ? 'on' : ''} />
        ))}
      </div>
    </div>
  );
}
