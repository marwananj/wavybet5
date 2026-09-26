import { useEffect, useState } from 'react';
import { LuClock, LuCrown, LuTrophy } from 'react-icons/lu';
import { api } from '../lib/api';
import { usd } from '../lib/format';
import { useAuth } from '../lib/state';
import { BackBar } from '../components/Layout';
import { Skeleton } from '../components/ui';
import { useCountdown } from './Rewards';

interface Board {
  week: string;
  endsAt: string;
  pool: number;
  minWager: number;
  prizes: number[];
  rows: { rank: number; user: string; wagered: number; me: boolean }[];
  me: { rank: number | null; wagered: number } | null;
  lastWeek: { week: string; winners: { rank: number; user: string; amount: number; wagered: number }[] };
}

const MEDAL = ['🥇', '🥈', '🥉'];

export function TournamentPage() {
  const { user } = useAuth();
  const [b, setB] = useState<Board | null>(null);
  const cd = useCountdown(b?.endsAt);
  useEffect(() => {
    const load = () => api<Board>('/rewards/tournament').then(setB).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [user?.id]);

  return (
    <div className="page tour-page">
      <BackBar title="Weekly Race" />
      <section className="tour-hero">
        <div className="tour-trophy" aria-hidden>
          <LuTrophy size={46} />
        </div>
        <div>
          <small>{b?.week ?? 'This week'} · Wager race</small>
          <h2>{b ? usd(b.pool) : '—'} prize pool</h2>
          <p>Every bet counts — sports and Originals. The top 10 by total wagered on Sunday 23:59 UTC share the pool automatically.</p>
        </div>
        <div className="tour-timer">
          <LuClock size={16} />
          <span>Ends in</span>
          <b>{cd?.text ?? '—'}</b>
        </div>
      </section>

      {b && (
        <div className="tour-prizes">
          {b.prizes.map((p, i) => (
            <div key={i} className={`tp tp-${i + 1}`}>
              <span>{MEDAL[i] ?? `#${i + 1}`}</span>
              <b>{usd(p)}</b>
            </div>
          ))}
        </div>
      )}

      {user && b?.me && (
        <div className="tour-me">
          <LuCrown size={18} />
          <span>
            {b.me.rank ? (
              <>
                You are <b>#{b.me.rank}</b> with {usd(b.me.wagered)} wagered
              </>
            ) : (
              <>
                You have wagered <b>{usd(b.me.wagered)}</b> this week
                {b.me.wagered < b.minWager ? ` — wager ${usd(b.minWager - b.me.wagered)} more to enter the race` : ''}
              </>
            )}
          </span>
        </div>
      )}

      <section className="tour-board">
        <div className="tb-head">
          <span>#</span>
          <span>Player</span>
          <span>Wagered</span>
          <span>Prize</span>
        </div>
        {!b ? (
          <Skeleton h={40} count={6} />
        ) : b.rows.length === 0 ? (
          <p className="muted tb-empty">No players yet this week — be the first on the board!</p>
        ) : (
          b.rows.map((r) => (
            <div key={r.rank} className={`tb-row ${r.rank <= 3 ? `top top${r.rank}` : ''} ${r.me ? 'me' : ''}`}>
              <span>{MEDAL[r.rank - 1] ?? r.rank}</span>
              <span>
                {r.user}
                {r.me && <em> (you)</em>}
              </span>
              <span>{usd(r.wagered)}</span>
              <span>{b.prizes[r.rank - 1] ? usd(b.prizes[r.rank - 1]) : '—'}</span>
            </div>
          ))
        )}
      </section>

      {b && b.lastWeek.winners.length > 0 && (
        <section className="tour-last">
          <h3>Last week's winners · {b.lastWeek.week}</h3>
          <div className="tl-list">
            {b.lastWeek.winners.slice(0, 5).map((w) => (
              <div key={w.rank}>
                <span>{MEDAL[w.rank - 1] ?? `#${w.rank}`}</span>
                <b>{w.user}</b>
                <em>{usd(w.amount)}</em>
              </div>
            ))}
          </div>
        </section>
      )}
      <small className="muted">Minimum {b ? usd(b.minWager) : '$50'} wagered to qualify. Prizes are paid as balance with no wagering requirement.</small>
    </div>
  );
}
