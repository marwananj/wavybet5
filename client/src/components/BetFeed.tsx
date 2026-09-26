import { useEffect, useState } from 'react';
import { LuActivity, LuCopy } from 'react-icons/lu';
import { api } from '../lib/api';
import { usd } from '../lib/format';
import { useAuth, useSlip, useToast } from '../lib/state';
import type { Pick } from '../lib/types';
import { PlayerCard, PlayerTag } from './PlayerCard';
import { OddsText } from './OddsText';

interface Row {
  id: string;
  kind: 'casino' | 'sport';
  game: string;
  gameId: string;
  user: string;
  hidden?: boolean;
  tier: string;
  tierName?: string;
  at: string;
  stake: string;
  multiplier: number;
  payout: string;
  status?: string;
  odds?: number;
  picks?: (Pick & { status: string })[];
}
type Tab = 'all' | 'sports' | 'casino' | 'high' | 'mine';

/** Live bet feed: every bet as it happens — player, VIP tier, stake and result. Sports bets can be copied. */
export function BetFeed({ title = 'Live bets' }: { title?: string }) {
  const { user } = useAuth();
  const slip = useSlip();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('all');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let known = new Set<string>();
    setRows(null);
    const load = () =>
      api<{ rows: Row[] }>(`/feed?tab=${tab}`)
        .then((d) => {
          if (!alive) return;
          const nw = new Set(d.rows.filter((r) => known.size && !known.has(r.id + r.status)).map((r) => r.id));
          known = new Set(d.rows.map((r) => r.id + r.status));
          setFresh(nw);
          setRows(d.rows);
        })
        .catch(() => alive && setRows((r) => r ?? []));
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tab, user?.id]);

  const copyBet = (r: Row) => {
    const open = (r.picks ?? []).filter((p) => p.status === 'OPEN');
    if (!open.length) return toast('info', 'These selections are already settled');
    const have = new Set(slip.picks.map((p) => p.outcomeId));
    const add = open.filter((p) => !have.has(p.outcomeId)).map(({ status: _s, ...p }) => p as Pick);
    slip.replaceAll([...slip.picks, ...add].slice(0, 15));
    slip.setOpen(true);
    toast('ok', `Copied ${open.length} selection${open.length > 1 ? 's' : ''} from ${r.user}`);
  };

  const tabs = [
    ['all', 'All'],
    ['sports', 'Sports'],
    ['casino', 'Casino'],
    ['high', 'High rollers'],
    ...(user ? [['mine', 'Mine']] : []),
  ] as [Tab, string][];
  return (
    <section className="bet-feed">
      <div className="bf-head">
        <h3>
          <LuActivity size={17} /> {title}
          <i className="live-dot" />
        </h3>
        <div className="seg seg-sm seg-scroll">
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
          <span className="bf-col-user">Player</span>
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
            const open = r.status === 'OPEN';
            const won = !open && Number(r.payout) > Number(r.stake);
            const canCopy = r.kind === 'sport' && open && !!r.picks?.length;
            return (
              <div key={r.id} className={`bf-row ${fresh.has(r.id) ? 'new' : ''} ${open ? 'open' : ''}`}>
                <span className="bf-game">
                  <i className={`bf-kind ${r.kind}`}>{r.kind === 'sport' ? '⚽' : '🎲'}</i>
                  <span className="bf-game-txt">
                    <span className="ellipsis">{r.game}</span>
                    <span className="bf-user-sm">
                      <PlayerTag name={r.user} tier={r.tier} hidden={r.hidden && r.user === 'Hidden'} onClick={() => setProfile(r.user)} />
                    </span>
                  </span>
                  {canCopy && (
                    <button type="button" className="bf-copy" onClick={() => copyBet(r)} title="Copy this bet to your slip">
                      <LuCopy size={13} />
                      <span>Copy</span>
                    </button>
                  )}
                </span>
                <span className="bf-col-user">
                  <PlayerTag name={r.user} tier={r.tier} hidden={r.hidden && r.user === 'Hidden'} onClick={() => setProfile(r.user)} />
                </span>
                <span className="hide-sm muted">{new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span>{usd(r.stake)}</span>
                <span className={won ? 'win' : open ? 'pending' : 'muted'}>{open ? <OddsText odds={r.odds ?? r.multiplier} /> : `${r.multiplier.toFixed(2)}×`}</span>
                <span className={open ? 'pending' : won ? 'win' : 'loss'}>{open ? 'Open' : won ? `+${usd(r.payout)}` : `-${usd(r.stake)}`}</span>
              </div>
            );
          })
        )}
      </div>
      {profile && <PlayerCard name={profile} onClose={() => setProfile(null)} />}
    </section>
  );
}
