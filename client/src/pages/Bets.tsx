import { useEffect, useState } from 'react';
import { LuTicket } from 'react-icons/lu';
import { api } from '../lib/api';
import { dateTime, marketLabel, odds as fmtOdds, usd } from '../lib/format';
import { Link, useRouter } from '../lib/router';
import { useAuth } from '../lib/state';
import type { Bet } from '../lib/types';
import { BackBar } from '../components/Layout';
import { Empty, Skeleton, Spinner } from '../components/ui';

const TABS = [
  ['open', 'Open'],
  ['won', 'Won'],
  ['lost', 'Lost'],
  ['settled', 'Settled'],
  ['all', 'All'],
] as const;

const STATUS_LABEL: Record<string, string> = { OPEN: 'Open', WON: 'Won', LOST: 'Lost', VOID: 'Void' };

function BetCard({ b }: { b: Bet }) {
  return (
    <article className={`bet-card st-${b.status.toLowerCase()}`}>
      <header className="bet-head">
        <div>
          <b>{b.type === 'PARLAY' ? `${b.selections.length}-leg parlay` : b.type === 'BUILDER' ? `Bet Builder · ${b.selections.length} legs` : 'Single'}</b>
          <small>
            {dateTime(b.createdAt)} · #{b.id.slice(-8).toUpperCase()}
          </small>
        </div>
        <span className={`status-pill st-${b.status.toLowerCase()}`}>{STATUS_LABEL[b.status]}</span>
      </header>
      <ul className="bet-legs">
        {b.selections.map((s) => (
          <li key={s.id} className={`leg st-${s.status.toLowerCase()}`}>
            <span className="leg-dot" />
            <div className="leg-info">
              <b>
                {s.outcomeName}
                {s.early && <em className="early-tag">Early payout · 2 goals ahead</em>}
              </b>
              <Link to={`/event/${s.eventId}`} className="ellipsis">
                {s.eventLabel}
              </Link>
              <small>
                {s.sportTitle} · {marketLabel(s.marketKey)} · {dateTime(s.commenceTime)}
              </small>
            </div>
            <span className="leg-odds">{fmtOdds(s.odds)}</span>
          </li>
        ))}
      </ul>
      <footer className="bet-foot">
        <div>
          <small>Stake</small>
          <b>{usd(b.stake)}</b>
        </div>
        <div>
          <small>Odds</small>
          <b>{fmtOdds(b.totalOdds)}</b>
        </div>
        <div>
          <small>{b.status === 'OPEN' ? 'To win' : 'Payout'}</small>
          <b className={b.status === 'WON' ? 'win' : b.status === 'LOST' ? 'loss' : ''}>{usd(b.status === 'OPEN' ? b.potentialPayout : b.payout ?? 0)}</b>
        </div>
      </footer>
    </article>
  );
}

export function BetsPage() {
  const { user, ready, openAuth } = useAuth();
  const { search, navigate } = useRouter();
  const tab = (search.get('tab') ?? 'open') as (typeof TABS)[number][0];
  const [bets, setBets] = useState<Bet[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [stats, setStats] = useState<{ status: string; count: number; stake: string; payout: string }[]>([]);

  useEffect(() => {
    if (!user) return;
    setBets(null);
    api<{ bets: Bet[]; nextCursor: string | null; stats: typeof stats }>(`/bets?status=${tab}`).then((d) => {
      setBets(d.bets);
      setCursor(d.nextCursor);
      setStats(d.stats);
    });
  }, [tab, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = async () => {
    if (!cursor) return;
    setMore(true);
    const d = await api<{ bets: Bet[]; nextCursor: string | null }>(`/bets?status=${tab}&cursor=${cursor}`);
    setBets((b) => [...(b ?? []), ...d.bets]);
    setCursor(d.nextCursor);
    setMore(false);
  };

  if (ready && !user)
    return (
      <div className="page">
        <BackBar title="My bets" />
        <Empty icon={<LuTicket size={34} />} title="Log in to see your bets" action={<button className="btn btn-primary" onClick={() => openAuth('login')}>Log in</button>} />
      </div>
    );

  const s = (k: string) => stats.find((x) => x.status === k);
  const totalStake = stats.reduce((a, x) => a + Number(x.stake), 0);
  const totalPayout = stats.reduce((a, x) => a + Number(x.payout), 0);
  const settledStake = stats.filter((x) => x.status !== 'OPEN').reduce((a, x) => a + Number(x.stake), 0);

  return (
    <div className="page">
      <BackBar title="My bets" />
      <div className="stat-row">
        <div className="stat">
          <small>Open bets</small>
          <b>{s('OPEN')?.count ?? 0}</b>
        </div>
        <div className="stat">
          <small>Won / Lost</small>
          <b>
            {s('WON')?.count ?? 0} / {s('LOST')?.count ?? 0}
          </b>
        </div>
        <div className="stat">
          <small>Total wagered</small>
          <b>{usd(totalStake)}</b>
        </div>
        <div className="stat">
          <small>Net result</small>
          <b className={totalPayout - settledStake >= 0 ? 'win' : 'loss'}>{usd(totalPayout - settledStake)}</b>
        </div>
      </div>
      <div className="seg seg-scroll">
        {TABS.map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => navigate(`/bets?tab=${k}`, true)}>
            {l}
          </button>
        ))}
      </div>
      <div className="bet-list">
        {bets === null ? (
          <Skeleton h={180} count={3} />
        ) : bets.length === 0 ? (
          <Empty icon={<LuTicket size={34} />} title={tab === 'open' ? 'No open bets' : 'Nothing here yet'} action={<Link to="/" className="btn btn-primary">Browse matches</Link>} />
        ) : (
          bets.map((b) => <BetCard key={b.id} b={b} />)
        )}
      </div>
      {cursor && (
        <button className="btn btn-ghost btn-block" onClick={loadMore} disabled={more}>
          {more ? <Spinner /> : 'Load more'}
        </button>
      )}
    </div>
  );
}
