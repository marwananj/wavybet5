import { useEffect, useState } from 'react';
import { LuActivity } from 'react-icons/lu';
import { api } from '../lib/api';
import { usd } from '../lib/format';
import { useAuth } from '../lib/state';

interface Row {
  id: string;
  kind: 'casino' | 'sport';
  game: string;
  gameId: string;
  user: string;
  tier: string;
  at: string;
  stake: string;
  multiplier: number;
  payout: string;
}
const TIER_COLOR: Record<string, string> = { bronze: '#cd7f32', silver: '#c0c7d4', gold: '#f5c542', platinum: '#7dd3fc', diamond: '#a78bfa', wavy: '#3ad0ff' };

/** Live bet feed: latest bets, high rollers and your own, refreshed every few seconds. */
export function BetFeed({ title = 'Live bets' }: { title?: string }) {
  const { user } = useAuth();
  const [tab, setTab] = useState<'all' | 'high' | 'mine'>('all');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    let known = new Set<string>();
    setRows(null);
    const load = () =>
      api<{ rows: Row[] }>(`/feed?tab=${tab}`)
        .then((d) => {
          if (!alive) return;
          const nw = new Set(d.rows.filter((r) => known.size && !known.has(r.id)).map((r) => r.id));
          known = new Set(d.rows.map((r) => r.id));
          setFresh(nw);
          setRows(d.rows);
        })
        .catch(() => alive && setRows((r) => r ?? []));
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tab, user?.id]);
  const tabs = [
    ['all', 'All bets'],
    ['high', 'High rollers'],
    ...(user ? [['mine', 'My bets']] : []),
  ] as [typeof tab, string][];
  return (
    <section className="bet-feed">
      <div className="bf-head">
        <h3>
          <LuActivity size={17} /> {title}
          <i className="live-dot" />
        </h3>
        <div className="seg seg-sm">
          {tabs.map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="bf-table">
        <div className="bf-row bf-th">
          <span>Game</span>
          <span className="hide-sm">Player</span>
          <span className="hide-sm">Time</span>
          <span>Bet</span>
          <span>Multi</span>
          <span>Payout</span>
        </div>
        {rows === null ? (
          <div className="bf-empty">Loading…</div>
        ) : !rows.length ? (
          <div className="bf-empty">No bets yet — be the first!</div>
        ) : (
          rows.map((r) => {
            const won = Number(r.payout) > Number(r.stake);
            return (
              <div key={r.id} className={`bf-row ${fresh.has(r.id) ? 'new' : ''}`}>
                <span className="bf-game">
                  <i className={`bf-kind ${r.kind}`}>{r.kind === 'sport' ? '⚽' : '🎲'}</i>
                  <span className="ellipsis">{r.game}</span>
                </span>
                <span className="hide-sm bf-user">
                  <i style={{ background: TIER_COLOR[r.tier] ?? '#64748b' }} />
                  {r.user}
                </span>
                <span className="hide-sm muted">{new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span>{usd(r.stake)}</span>
                <span className={won ? 'win' : 'muted'}>{r.multiplier.toFixed(2)}×</span>
                <span className={won ? 'win' : 'loss'}>{won ? `+${usd(r.payout)}` : `-${usd(r.stake)}`}</span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
