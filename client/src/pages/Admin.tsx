import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { dateTime, usd } from '../lib/format';
import { useRouter } from '../lib/router';
import { useAuth, useToast } from '../lib/state';
import { BackBar } from '../components/Layout';
import { Empty, Skeleton, Spinner } from '../components/ui';

type Stats = {
  users: number; newUsers30d: number; deposits30d: { sum: number; count: number }; withdrawals30d: { sum: number; count: number };
  pendingWithdrawals: { sum: number; count: number }; pendingDeposits?: { sum: number; count: number }; paymentMode?: string; casino30d?: { rounds: number; wagered: number; ggr: number }; openBets: { count: number; stake: number; liability: number };
  ggr30d: number; playerBalances: number; oddsQuotaRemaining: number | null; withdrawalMode: string; feed: string;
};

function Dashboard() {
  const [s, setS] = useState<Stats | null>(null);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [liveCheck, setLiveCheck] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    api<Stats>('/admin/stats').then(setS);
  }, []);
  const sync = async (what: string) => {
    setBusy(what);
    try {
      const d = await api<{ result: number }>('/admin/sync', { body: { what } });
      toast('ok', `${what} synced (${d.result})`);
    } catch (e) {
      toast('err', (e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };
  if (!s) return <Skeleton h={90} count={4} />;
  const tiles: [string, string, string?][] = [
    ['Users', String(s.users), `+${s.newUsers30d} in 30d`],
    ['Deposits 30d', usd(s.deposits30d.sum), `${s.deposits30d.count} payments`],
    ['Withdrawals 30d', usd(s.withdrawals30d.sum), `${s.withdrawals30d.count} payouts`],
    ['Deposits to approve', usd(s.pendingDeposits?.sum ?? 0), `${s.pendingDeposits?.count ?? 0} waiting`],
    ['Pending withdrawals', usd(s.pendingWithdrawals.sum), `${s.pendingWithdrawals.count} waiting`],
    ['GGR 30d', usd(s.ggr30d), 'Sportsbook stakes − payouts'],
    ['Casino GGR 30d', usd(s.casino30d?.ggr ?? 0), `${s.casino30d?.rounds ?? 0} rounds · ${usd(s.casino30d?.wagered ?? 0)} wagered`],
    ['Open bets', String(s.openBets.count), `${usd(s.openBets.stake)} staked`],
    ['Max liability', usd(s.openBets.liability), 'If every open bet wins'],
    ['Player balances', usd(s.playerBalances), 'Owed to players'],
  ];
  return (
    <>
      <div className="stat-row wrap">
        {tiles.map(([k, v, sub]) => (
          <div key={k} className="stat">
            <small>{k}</small>
            <b>{v}</b>
            {sub && <em>{sub}</em>}
          </div>
        ))}
      </div>
      <section className="panel">
        <h3>Data feed</h3>
        <p className="muted">
          Feed: <b>{s.feed}</b> · requests remaining today: <b>{s.oddsQuotaRemaining?.toLocaleString() ?? 'unknown'}</b>. Withdrawal mode: <b>{s.withdrawalMode}</b>.
        </p>
        <div className="chips">
          <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={async () => {
            setBusy('status');
            try {
              const d = await api<{ ok: boolean; error?: string; plan?: string; usedToday?: number; limitPerDay?: number; ends?: string }>('/admin/feed-status');
              toast(d.ok ? 'ok' : 'err', d.ok ? `Key OK — plan ${d.plan ?? '?'} · ${d.usedToday ?? 0}/${d.limitPerDay ?? '?'} used today${d.ends ? ` · renews ${d.ends.slice(0, 10)}` : ''}` : `Key problem: ${d.error}`);
            } catch (e) {
              toast('err', (e as ApiError).message);
            } finally {
              setBusy(null);
            }
          }}>
            {busy === 'status' ? <Spinner /> : 'Check API key'}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={async () => {
            setBusy('live');
            try {
              setLiveCheck(await api<Record<string, unknown>>('/admin/live-check'));
            } catch (e) {
              toast('err', (e as ApiError).message);
            } finally {
              setBusy(null);
            }
          }}>
            {busy === 'live' ? <Spinner /> : 'Live check'}
          </button>
          {['sports', 'odds', 'scores'].map((w) => (
            <button key={w} className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => sync(w)}>
              {busy === w ? <Spinner /> : `Sync ${w} now`}
            </button>
          ))}
        </div>
        {liveCheck && (
          <div className="live-check">
            <h4>Live check</h4>
            <table className="kv">
              <tbody>
                {Object.entries(liveCheck).map(([k, v]) => (
                  <tr key={k}>
                    <th>{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</th>
                    <td>{Array.isArray(v) ? (v.length ? v.join(' · ') : '—') : String(v ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

type WItem = { id: string; amount: string; cryptoCurrency: string; address: string; note: string | null; createdAt: string; providerId: string | null; txHash: string | null; user: { username: string; email: string; kycStatus: string } };
function Withdrawals() {
  const [status, setStatus] = useState('PENDING');
  const [items, setItems] = useState<WItem[] | null>(null);
  const toast = useToast();
  const load = () => api<{ items: WItem[] }>(`/admin/withdrawals?status=${status}`).then((d) => setItems(d.items));
  useEffect(() => {
    setItems(null);
    load();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = async (w: WItem) => {
    const txHash = window.prompt('Manual mode: paste the blockchain tx hash after sending the funds.\nNOWPayments mode: leave empty to send the payout automatically.') ?? undefined;
    if (txHash === undefined) return;
    try {
      const d = await api<{ status: string; note?: string }>(`/admin/withdrawals/${w.id}/approve`, { body: { txHash: txHash || undefined } });
      toast('ok', d.note ?? `Withdrawal ${d.status.toLowerCase()}`);
      load();
    } catch (e) {
      toast('err', (e as ApiError).message);
    }
  };
  const reject = async (w: WItem) => {
    const reason = window.prompt('Reason for rejection (shown to the user)');
    if (!reason) return;
    try {
      await api(`/admin/withdrawals/${w.id}/reject`, { body: { reason } });
      toast('ok', 'Rejected and refunded');
      load();
    } catch (e) {
      toast('err', (e as ApiError).message);
    }
  };

  return (
    <>
      <div className="chips">
        {['PENDING', 'COMPLETED', 'CANCELLED', 'FAILED'].map((s) => (
          <button key={s} className={`chip${status === s ? ' on' : ''}`} onClick={() => setStatus(s)}>
            {s.toLowerCase()}
          </button>
        ))}
      </div>
      {items === null ? (
        <Skeleton h={70} count={3} />
      ) : items.length === 0 ? (
        <Empty title="Nothing here" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>User</th><th>Amount</th><th>Coin / address</th><th>Requested</th><th /></tr>
            </thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id}>
                  <td><b>{w.user.username}</b><small>{w.user.email} · KYC {w.user.kycStatus.toLowerCase()}</small></td>
                  <td><b>{usd(w.amount)}</b></td>
                  <td><b>{w.cryptoCurrency?.toUpperCase()}</b><code className="addr">{w.address}</code>{w.note && <small>{w.note}</small>}{w.txHash && <small>tx {w.txHash}</small>}</td>
                  <td>{dateTime(w.createdAt)}</td>
                  <td className="actions">
                    {status === 'PENDING' && !w.providerId && (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={() => approve(w)}>Approve</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => reject(w)}>Reject</button>
                      </>
                    )}
                    {status === 'PENDING' && w.providerId && <small>Sent to provider</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type DItem = { id: string; amount: string; cryptoCurrency: string; address: string | null; txHash: string | null; note: string | null; createdAt: string; user: { username: string; email: string; kycStatus: string } };
const explorer = (coin: string, tx: string) =>
  coin.includes('trc20') || coin === 'trx' ? `https://tronscan.org/#/transaction/${tx}`
  : coin.includes('erc20') || coin === 'eth' || coin === 'usdc' ? `https://etherscan.io/tx/${tx}`
  : coin.includes('bep20') || coin.includes('bsc') || coin === 'bnb' ? `https://bscscan.com/tx/${tx}`
  : coin === 'btc' ? `https://mempool.space/tx/${tx}`
  : coin === 'ltc' ? `https://blockchair.com/litecoin/transaction/${tx}`
  : coin === 'sol' ? `https://solscan.io/tx/${tx}`
  : `https://blockchair.com/search?q=${tx}`;

function Deposits() {
  const [status, setStatus] = useState('PENDING');
  const [items, setItems] = useState<DItem[] | null>(null);
  const toast = useToast();
  const load = () => api<{ items: DItem[] }>(`/admin/deposits?status=${status}`).then((d) => setItems(d.items));
  useEffect(() => {
    setItems(null);
    load();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = async (d: DItem) => {
    const v = window.prompt(`Check the TXID on the blockchain first.\nAmount to credit in USD (user declared $${d.amount}):`, d.amount);
    if (v === null) return;
    const amount = Number(v);
    if (!(amount > 0)) return toast('err', 'Enter a valid amount');
    try {
      const r = await api<{ credited: string }>(`/admin/deposits/${d.id}/approve`, { body: { amount } });
      toast('ok', `Credited ${usd(r.credited)} to ${d.user.username}`);
      load();
    } catch (e) {
      toast('err', (e as ApiError).message);
    }
  };
  const reject = async (d: DItem) => {
    const reason = window.prompt('Reason for rejection (shown to the user)', 'Payment not found on the blockchain');
    if (!reason) return;
    try {
      await api(`/admin/deposits/${d.id}/reject`, { body: { reason } });
      toast('ok', 'Deposit rejected');
      load();
    } catch (e) {
      toast('err', (e as ApiError).message);
    }
  };

  return (
    <>
      <div className="chips">
        {['PENDING', 'COMPLETED', 'FAILED'].map((s) => (
          <button key={s} className={`chip${status === s ? ' on' : ''}`} onClick={() => setStatus(s)}>
            {s === 'FAILED' ? 'rejected' : s.toLowerCase()}
          </button>
        ))}
      </div>
      <p className="muted">Open the TXID link, check the coin, network, receiving address and amount, then approve. Approving credits the user's balance immediately.</p>
      {items === null ? (
        <Skeleton h={70} count={3} />
      ) : items.length === 0 ? (
        <Empty title="Nothing here" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>User</th><th>Amount</th><th>Coin / TXID</th><th>Submitted</th><th /></tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <td><b>{d.user.username}</b><small>{d.user.email}</small></td>
                  <td><b>{usd(d.amount)}</b></td>
                  <td>
                    <b>{d.cryptoCurrency?.toUpperCase()}</b>
                    {d.txHash ? <a className="addr" href={explorer(d.cryptoCurrency ?? '', d.txHash)} target="_blank" rel="noreferrer">{d.txHash}</a> : <small>no TXID</small>}
                    {d.note && <small>{d.note}</small>}
                  </td>
                  <td>{dateTime(d.createdAt)}</td>
                  <td className="actions">
                    {status === 'PENDING' && (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={() => approve(d)}>Approve</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => reject(d)}>Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type AUser = { id: string; username: string; email: string; balance: string; country: string; kycStatus: string; isBanned: boolean; createdAt: string; role: string };
function Users() {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AUser[] | null>(null);
  const toast = useToast();
  const load = () => api<{ users: AUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`).then((d) => setUsers(d.users));
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast('ok', msg);
      load();
    } catch (e) {
      toast('err', (e as ApiError).message);
    }
  };
  return (
    <>
      <label className="search-box"><input placeholder="Search email or username" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {users === null ? <Skeleton h={60} count={4} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>User</th><th>Balance</th><th>Country</th><th>KYC</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.isBanned ? 'banned' : ''}>
                  <td><b>{u.username}{u.role === 'ADMIN' && ' ★'}</b><small>{u.email}</small></td>
                  <td>{usd(u.balance)}</td>
                  <td>{u.country}</td>
                  <td>
                    <select value={u.kycStatus} onChange={(e) => act(() => api(`/admin/users/${u.id}/kyc`, { body: { status: e.target.value } }), 'KYC updated')}>
                      {['NONE', 'PENDING', 'VERIFIED', 'REJECTED'].map((k) => <option key={k}>{k}</option>)}
                    </select>
                  </td>
                  <td className="actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                      const a = window.prompt('Adjust balance by (e.g. 25 or -10)');
                      const note = a && window.prompt('Reason');
                      if (a && note) act(() => api(`/admin/users/${u.id}/adjust`, { body: { amount: Number(a), note } }), 'Balance adjusted');
                    }}>Adjust</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => act(() => api(`/admin/users/${u.id}/ban`, { body: { banned: !u.isBanned } }), u.isBanned ? 'Unbanned' : 'Banned')}>{u.isBanned ? 'Unban' : 'Ban'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type AEvent = { id: string; sportTitle: string; homeTeam: string; awayTeam: string; commenceTime: string; status: string; homeScore: number | null; awayScore: number | null; featured: boolean; openSelections: number };
function Events() {
  const [status, setStatus] = useState('LIVE');
  const [q, setQ] = useState('');
  const [events, setEvents] = useState<AEvent[] | null>(null);
  const toast = useToast();
  const load = () => api<{ events: AEvent[] }>(`/admin/events?status=${status}&q=${encodeURIComponent(q)}`).then((d) => setEvents(d.events));
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [status, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<{ settled?: number }>, msg: string) => {
    try {
      const d = await fn();
      toast('ok', `${msg}${d.settled != null ? ` — ${d.settled} bets settled` : ''}`);
      load();
    } catch (e) {
      toast('err', (e as ApiError).message);
    }
  };
  return (
    <>
      <div className="chips">
        {['UPCOMING', 'LIVE', 'COMPLETED', 'CANCELLED'].map((s) => (
          <button key={s} className={`chip${status === s ? ' on' : ''}`} onClick={() => setStatus(s)}>{s.toLowerCase()}</button>
        ))}
      </div>
      <label className="search-box"><input placeholder="Search team" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <p className="muted">Results settle automatically from the feed. Use manual settle only if the feed never finalises a match; void for postponed/abandoned games.</p>
      {events === null ? <Skeleton h={60} count={4} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Match</th><th>Kick-off</th><th>Score</th><th>Open picks</th><th /></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td><b>{e.homeTeam} vs {e.awayTeam}</b><small>{e.sportTitle}</small></td>
                  <td>{dateTime(e.commenceTime)}</td>
                  <td>{e.homeScore ?? '–'} : {e.awayScore ?? '–'}</td>
                  <td>{e.openSelections}</td>
                  <td className="actions">
                    {e.status === 'UPCOMING' && (
                      <button className="btn btn-ghost btn-sm" onClick={() => act(() => api(`/admin/events/${e.id}/featured`, { body: { featured: !e.featured } }), e.featured ? 'Unfeatured' : 'Featured')}>{e.featured ? '★ Featured' : '☆ Feature'}</button>
                    )}
                    {(e.status === 'LIVE' || e.status === 'UPCOMING') && (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => {
                          const r = window.prompt(`Final score "${e.homeTeam}-${e.awayTeam}" e.g. 2-1`);
                          const m = r?.match(/^(\d+)\s*[-:]\s*(\d+)$/);
                          if (m) act(() => api(`/admin/events/${e.id}/settle`, { body: { homeScore: +m[1], awayScore: +m[2] } }), 'Settled');
                        }}>Settle</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => window.confirm('Void this match and refund all open picks?') && act(() => api(`/admin/events/${e.id}/void`, { method: 'POST' }), 'Voided')}>Void</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type ASport = { key: string; group: string; title: string; active: boolean; enabled: boolean };
function Sports() {
  const [sports, setSports] = useState<ASport[] | null>(null);
  const load = () => api<{ sports: ASport[] }>('/admin/sports').then((d) => setSports(d.sports));
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <p className="muted">Leagues come from APIFOOTBALL_LEAGUES. Untick a league to hide it and stop syncing it.</p>
      {sports === null ? <Skeleton h={50} count={5} /> : (
        <div className="sport-toggles">
          {sports.map((s) => (
            <label key={s.key} className={`toggle-row${s.active ? '' : ' off'}`}>
              <input type="checkbox" checked={s.enabled} onChange={async (e) => { await api(`/admin/sports/${s.key}`, { body: { enabled: e.target.checked } }); load(); }} />
              <span><b>{s.title}</b><small>{s.group}{!s.active && ' · out of season'}</small></span>
            </label>
          ))}
        </div>
      )}
    </>
  );
}

export function AdminPage() {
  const { user, ready } = useAuth();
  const { search, navigate } = useRouter();
  const tab = search.get('tab') ?? 'dashboard';
  if (!ready) return null;
  if (user?.role !== 'ADMIN') return <div className="page"><Empty title="Admins only" /></div>;
  return (
    <div className="page">
      <BackBar title="Admin" />
      <div className="seg seg-scroll">
        {['dashboard', 'deposits', 'withdrawals', 'users', 'events', 'sports'].map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => navigate(`/admin?tab=${t}`, true)}>{t}</button>
        ))}
      </div>
      <div className="admin-body">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'deposits' && <Deposits />}
        {tab === 'withdrawals' && <Withdrawals />}
        {tab === 'users' && <Users />}
        {tab === 'events' && <Events />}
        {tab === 'sports' && <Sports />}
      </div>
    </div>
  );
}
