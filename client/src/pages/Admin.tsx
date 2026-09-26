import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { subscribeNamed } from '../lib/live';
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

type AUser = { id: string; username: string; email: string; balance: string; country: string; kycStatus: string; isBanned: boolean; createdAt: string; role: string; emailVerified?: boolean };
/** send a test verification e-mail and show exactly what the e-mail provider answered */
function EmailTest() {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<{ ok: boolean; provider: string; to: string; error?: string; raw?: { provider: string; status: number; body: string } | null } | null>(null);
  const run = async () => {
    setBusy(true);
    setR(null);
    try {
      setR(await api('/admin/test-email', { body: { to: to || undefined } }));
    } catch (e) {
      setR({ ok: false, provider: '?', to, error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card email-test">
      <b>E-mail delivery test</b>
      <div className="email-test-row">
        <input placeholder="send to (default: your admin e-mail)" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={run}>{busy ? <Spinner /> : 'Send test'}</button>
      </div>
      {r && (
        <div className={`email-test-res ${r.ok ? 'ok' : 'err'}`}>
          {r.ok ? `✓ Sent through ${r.provider} to ${r.to} — check the inbox (and spam).` : `✕ ${r.provider}: ${r.error}`}
          {r.raw && <pre>{`${r.raw.provider} HTTP ${r.raw.status}\n${r.raw.body}`}</pre>}
        </div>
      )}
    </div>
  );
}

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
      <EmailTest />
      <label className="search-box"><input placeholder="Search email or username" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {users === null ? <Skeleton h={60} count={4} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>User</th><th>Balance</th><th>Country</th><th>KYC</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.isBanned ? 'banned' : ''}>
                  <td><b>{u.username}{u.role === 'ADMIN' && ' ★'}</b><small>{u.email}{u.emailVerified === false && <em className="unverified-tag"> · e-mail not verified</em>}</small></td>
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
                    {u.emailVerified === false && (
                      <button className="btn btn-ghost btn-sm" onClick={() => act(() => api(`/admin/users/${u.id}/verify-email`, { method: 'POST' }), 'E-mail marked verified')}>Verify e-mail</button>
                    )}
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

interface FeedType {
  name: string;
  source: 'prematch' | 'live';
  mapped: string | null;
  sample: string;
  count: number;
}
/** Every bet name the odds feeds have sent since the server started, and the market it maps to. */
function FeedMarkets() {
  const [rows, setRows] = useState<FeedType[] | null>(null);
  const [only, setOnly] = useState<'all' | 'mapped' | 'unmapped'>('all');
  useEffect(() => {
    api<{ types: FeedType[] }>('/admin/feed-bet-types').then((d) => setRows(d.types)).catch(() => setRows([]));
  }, []);
  const list = (rows ?? []).filter((r) => (only === 'all' ? true : only === 'mapped' ? !!r.mapped : !r.mapped));
  return (
    <>
      <p className="muted">
        Bet types received from API-Football since the last server restart. <b>Mapped</b> ones are offered on the site. If a market you expect is
        unmapped, send its exact name to your developer.
      </p>
      <div className="seg seg-sm" style={{ maxWidth: 360, marginBottom: 12 }}>
        {(['all', 'mapped', 'unmapped'] as const).map((k) => (
          <button key={k} className={only === k ? 'on' : ''} onClick={() => setOnly(k)}>
            {k}
          </button>
        ))}
      </div>
      {rows === null ? (
        <Skeleton h={40} count={6} />
      ) : !list.length ? (
        <Empty title="Nothing yet" text="The list fills as the odds jobs run (pre-match every 30 min, live every few seconds)." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Feed</th>
                <th>Bet name</th>
                <th>Our market</th>
                <th>Sample values</th>
                <th>Seen</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={`${r.source}:${r.name}`}>
                  <td>{r.source}</td>
                  <td><b>{r.name}</b></td>
                  <td>{r.mapped ?? <span className="muted">not used</span>}</td>
                  <td className="muted">{r.sample}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface Thread {
  userId: string;
  username: string;
  email: string;
  balance: string;
  last: string;
  lastStaff: boolean;
  at: string;
  unread: number;
}
interface SMsg {
  id: string;
  body: string;
  staff: boolean;
  user: string;
  at: string;
}
/** Customer support inbox: one thread per player, replies appear live in their chat window. */
function SupportInbox() {
  const toast = useToast();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [sel, setSel] = useState<Thread | null>(null);
  const [msgs, setMsgs] = useState<SMsg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const loadThreads = () => api<{ threads: Thread[] }>('/chat/admin/threads').then((d) => setThreads(d.threads)).catch(() => setThreads([]));
  const open = (t: Thread) => {
    setSel(t);
    api<{ messages: SMsg[] }>(`/chat/admin/threads/${t.userId}`).then((d) => setMsgs(d.messages));
  };
  useEffect(() => {
    loadThreads();
    const off = subscribeNamed('support', (d: { threadUserId: string }) => {
      loadThreads();
      setSel((cur) => {
        if (cur && cur.userId === d.threadUserId) api<{ messages: SMsg[] }>(`/chat/admin/threads/${cur.userId}`).then((x) => setMsgs(x.messages));
        return cur;
      });
    });
    const t = setInterval(loadThreads, 20_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);
  const reply = async () => {
    if (!sel || !text.trim()) return;
    setBusy(true);
    try {
      const d = await api<{ messages: SMsg[] }>(`/chat/admin/threads/${sel.userId}`, { body: { body: text.trim() } });
      setMsgs(d.messages);
      setText('');
      loadThreads();
    } catch (e) {
      toast('err', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="inbox">
      <div className="inbox-list">
        {threads === null ? (
          <Skeleton h={54} count={4} />
        ) : !threads.length ? (
          <Empty title="No conversations yet" text="Players open support from the chat button." />
        ) : (
          threads.map((t) => (
            <button key={t.userId} className={`inbox-item ${sel?.userId === t.userId ? 'on' : ''}`} onClick={() => open(t)}>
              <b>
                {t.username}
                {t.unread > 0 && <em>{t.unread}</em>}
              </b>
              <small className="ellipsis">
                {t.lastStaff ? 'You: ' : ''}
                {t.last}
              </small>
              <small className="muted">{dateTime(t.at)}</small>
            </button>
          ))
        )}
      </div>
      <div className="inbox-thread">
        {!sel ? (
          <Empty title="Select a conversation" />
        ) : (
          <>
            <div className="inbox-who">
              <b>{sel.username}</b>
              <small>
                {sel.email} · balance {usd(sel.balance)}
              </small>
            </div>
            <div className="chat-list">
              {msgs.map((m) => (
                <div key={m.id} className={`chat-msg ${m.staff ? 'me' : 'staff-view'}`}>
                  <span className="chat-user">{m.staff ? 'Support' : m.user}</span>
                  <p>{m.body}</p>
                  <small>{dateTime(m.at)}</small>
                </div>
              ))}
            </div>
            <div className="chat-input">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply to the player…" onKeyDown={(e) => e.key === 'Enter' && reply()} />
              <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={reply}>
                {busy ? <Spinner /> : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface CMsg {
  id: string;
  user: string;
  body: string;
  at: string;
  staff: boolean;
}
/** Global chat moderation: delete messages, mute players. */
function ChatModeration() {
  const toast = useToast();
  const [msgs, setMsgs] = useState<CMsg[]>([]);
  const [mute, setMute] = useState({ username: '', minutes: '60' });
  const load = () => api<{ messages: CMsg[] }>('/chat/global').then((d) => setMsgs(d.messages.slice().reverse()));
  useEffect(() => {
    load();
    return subscribeNamed('chat', () => load());
  }, []);
  const del = async (id: string) => {
    await api(`/chat/admin/delete/${id}`, { method: 'POST' });
    load();
  };
  const doMute = async () => {
    try {
      await api('/chat/admin/mute', { body: { username: mute.username, minutes: Number(mute.minutes) || 0 } });
      toast('ok', Number(mute.minutes) ? `${mute.username} muted` : `${mute.username} unmuted`);
    } catch (e) {
      toast('err', (e as ApiError).message);
    }
  };
  return (
    <>
      <div className="field-row" style={{ alignItems: 'end', marginBottom: 12 }}>
        <label className="field">
          <span>Username</span>
          <input value={mute.username} onChange={(e) => setMute({ ...mute, username: e.target.value })} />
        </label>
        <label className="field">
          <span>Mute minutes (0 = unmute)</span>
          <input value={mute.minutes} onChange={(e) => setMute({ ...mute, minutes: e.target.value.replace(/\D/g, '') })} />
        </label>
        <button className="btn btn-ghost" onClick={doMute} disabled={!mute.username}>
          Apply
        </button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <tbody>
            {msgs.map((m) => (
              <tr key={m.id}>
                <td className="muted">{dateTime(m.at)}</td>
                <td>
                  <b>{m.user}</b>
                </td>
                <td>{m.body}</td>
                <td>
                  <button className="btn btn-ghost btn-sm" onClick={() => del(m.id)}>
                    Delete
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setMute({ ...mute, username: m.user })}>
                    Mute…
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}


type ABet = {
  id: string; type: string; status: string; stake: string; totalOdds: string; potentialPayout: string; payout: string | null; createdAt: string; settledAt: string | null; live: boolean;
  user: { username: string; email: string; tier: string };
  selections: { id: string; eventLabel: string; sportTitle: string; marketKey: string; outcomeName: string; odds: string; status: string; commenceTime: string }[];
};
type BetsRes = {
  bets: ABet[];
  next: string | null;
  summary: { count: number; counts: Record<string, number>; staked: number; paid: number; ggr: number; openCount: number; openStake: number; openLiability: number };
  exposure: { eventId: string; event: string; bets: number; stake: number; liability: number }[];
};

/** Every sports bet placed on the site (all players) */
function AdminBets() {
  const [f, setF] = useState({ status: 'all', type: 'all', q: '', days: '7', minStake: '' });
  const [d, setD] = useState<BetsRes | null>(null);
  const [more, setMore] = useState<ABet[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const qs = (cursor?: string) =>
    new URLSearchParams({ status: f.status, type: f.type, days: f.days, ...(f.q ? { q: f.q } : {}), ...(f.minStake ? { minStake: f.minStake } : {}), ...(cursor ? { cursor } : {}) }).toString();
  const load = () => api<BetsRes>(`/admin/bets?${qs()}`).then((x) => { setD(x); setMore([]); }).catch(() => setD(null));
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [f.status, f.type, f.q, f.days, f.minStake]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && !more.length && load(), 15000);
    return () => clearInterval(t);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const next = more.length ? null : d?.next;
  const loadMore = async () => {
    if (!d?.next) return;
    const x = await api<BetsRes>(`/admin/bets?${qs(d.next)}`);
    setMore(x.bets);
    setD({ ...d, next: x.next });
  };
  const rows = [...(d?.bets ?? []), ...more];
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <div className="admin-bets">
      <div className="ab-filters">
        <input placeholder="Player, e-mail, match or bet ID" value={f.q} onChange={set('q')} />
        <select value={f.status} onChange={set('status')}>
          {['all', 'OPEN', 'WON', 'LOST', 'CASHOUT', 'VOID'].map((x) => <option key={x} value={x}>{x === 'all' ? 'All statuses' : x.toLowerCase()}</option>)}
        </select>
        <select value={f.type} onChange={set('type')}>
          {['all', 'SINGLE', 'PARLAY', 'BUILDER'].map((x) => <option key={x} value={x}>{x === 'all' ? 'All types' : x.toLowerCase()}</option>)}
        </select>
        <select value={f.days} onChange={set('days')}>
          {[['1', 'Today'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input placeholder="Min stake $" inputMode="decimal" value={f.minStake} onChange={set('minStake')} />
      </div>
      {d && (
        <div className="ab-summary">
          <div><small>Bets</small><b>{d.summary.count}</b></div>
          <div><small>Staked</small><b>{usd(d.summary.staked)}</b></div>
          <div><small>Paid out</small><b>{usd(d.summary.paid)}</b></div>
          <div className={d.summary.ggr >= 0 ? 'pos' : 'neg'}><small>GGR (settled)</small><b>{usd(d.summary.ggr)}</b></div>
          <div><small>Open bets</small><b>{d.summary.openCount} · {usd(d.summary.openStake)}</b></div>
          <div className="warn"><small>Open liability</small><b>{usd(d.summary.openLiability)}</b></div>
        </div>
      )}
      {d && d.exposure.length > 0 && (
        <div className="ab-exposure">
          <h4>Biggest open exposure</h4>
          {d.exposure.map((e) => (
            <div key={e.eventId}>
              <span className="ellipsis">{e.event}</span>
              <small>{e.bets} bets · {usd(e.stake)} staked</small>
              <b>{usd(e.liability)}</b>
            </div>
          ))}
        </div>
      )}
      {d === null ? <Skeleton h={56} count={6} /> : (
        <div className="ab-list">
          {rows.map((b) => (
            <div key={b.id} className={`ab-bet st-${b.status.toLowerCase()} ${open === b.id ? 'open' : ''}`}>
              <button type="button" className="ab-main" onClick={() => setOpen(open === b.id ? null : b.id)}>
                <span className="ab-user">
                  <b>{b.user.username}</b>
                  <small>{b.user.email}</small>
                </span>
                <span className="ab-what">
                  <b className="ellipsis">{b.type === 'SINGLE' ? b.selections[0]?.outcomeName : `${b.type.toLowerCase()} · ${b.selections.length} legs`}</b>
                  <small className="ellipsis">{b.type === 'SINGLE' ? b.selections[0]?.eventLabel : b.selections.map((s) => s.eventLabel).join(' · ')}</small>
                </span>
                <span className="ab-num"><small>Stake</small><b>{usd(b.stake)}</b></span>
                <span className="ab-num"><small>Odds</small><b>{Number(b.totalOdds).toFixed(2)}</b></span>
                <span className="ab-num"><small>{b.status === 'OPEN' ? 'To win' : 'Paid'}</small><b>{usd(b.status === 'OPEN' ? b.potentialPayout : b.payout ?? 0)}</b></span>
                <span className="ab-tags">
                  <em className={`ab-st st-${b.status.toLowerCase()}`}>{b.status.toLowerCase()}</em>
                  {b.live && <em className="ab-live">LIVE</em>}
                  <small>{new Date(b.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
                </span>
              </button>
              {open === b.id && (
                <div className="ab-legs">
                  {b.selections.map((s) => (
                    <div key={s.id} className={`st-${s.status.toLowerCase()}`}>
                      <span><b>{s.outcomeName}</b> <small>{s.marketKey}</small></span>
                      <span className="ellipsis">{s.eventLabel} · {s.sportTitle}</span>
                      <span>@ {Number(s.odds).toFixed(2)}</span>
                      <em>{s.status.toLowerCase()}</em>
                    </div>
                  ))}
                  <small className="muted">Bet ID {b.id}{b.settledAt ? ` · settled ${new Date(b.settledAt).toLocaleString()}` : ''}</small>
                </div>
              )}
            </div>
          ))}
          {!rows.length && <p className="muted">No bets match these filters.</p>}
          {next && <button className="btn btn-ghost btn-block" onClick={loadMore}>Load more</button>}
        </div>
      )}
    </div>
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
        {['dashboard', 'bets', 'deposits', 'withdrawals', 'users', 'support', 'chat', 'events', 'sports', 'markets'].map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => navigate(`/admin?tab=${t}`, true)}>{t}</button>
        ))}
      </div>
      <div className="admin-body">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'bets' && <AdminBets />}
        {tab === 'deposits' && <Deposits />}
        {tab === 'withdrawals' && <Withdrawals />}
        {tab === 'users' && <Users />}
        {tab === 'events' && <Events />}
        {tab === 'sports' && <Sports />}
        {tab === 'markets' && <FeedMarkets />}
        {tab === 'support' && <SupportInbox />}
        {tab === 'chat' && <ChatModeration />}
      </div>
    </div>
  );
}
