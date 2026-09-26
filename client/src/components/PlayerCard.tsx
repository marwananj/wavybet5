import { useEffect, useState, type CSSProperties } from 'react';
import { LuCalendar, LuDices, LuTicket, LuTrophy } from 'react-icons/lu';
import { api, type ApiError } from '../lib/api';
import { usd } from '../lib/format';
import { TierBadge } from '../pages/Vip';
import { Modal, Spinner } from './ui';

export const TIER_COLOR: Record<string, string> = { bronze: '#cd7f32', silver: '#c0c7d4', gold: '#f5c542', platinum: '#7dd3fc', diamond: '#a78bfa', wavy: '#3ad0ff' };
export const TIER_NAME: Record<string, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond', wavy: 'Wavy Elite' };

/** small tier chip + name, used in feeds, chat and leaderboards */
export function PlayerTag({ name, tier, onClick, hidden }: { name: string; tier: string; onClick?: () => void; hidden?: boolean }) {
  const t = { id: tier, color: TIER_COLOR[tier] ?? '#64748b', name: TIER_NAME[tier] ?? tier };
  return (
    <button type="button" className={`player-tag ${hidden ? 'hidden' : ''}`} onClick={hidden ? undefined : onClick} disabled={hidden || !onClick} title={hidden ? 'Private profile' : `${name} · ${t.name}`}>
      <TierBadge tier={t} size={18} />
      <span className="ellipsis">{name}</span>
    </button>
  );
}

interface Profile {
  username: string;
  staff: boolean;
  tier: { id: string; name: string; color: string };
  next: { id: string; name: string; color: string } | null;
  progress: number;
  joined: string;
  bets: number;
  rounds: number;
  favouriteGame: string | null;
  bestCasino: { game: string; multiplier: number; payout: number } | null;
  bestSports: { odds: number; payout: number; type: string } | null;
}

export function PlayerCard({ name, onClose }: { name: string; onClose: () => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Profile>(`/players/${encodeURIComponent(name)}`).then(setP).catch((e) => setErr((e as ApiError).message));
  }, [name]);
  return (
    <Modal onClose={onClose}>
      <div className="pcard-modal">
        {err ? (
          <p className="muted">{err}</p>
        ) : !p ? (
          <div className="pc-loading">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="pc-head" style={{ '--tc': p.tier.color } as CSSProperties}>
              <div className="pc-avatar">{p.username.slice(0, 2).toUpperCase()}</div>
              <div>
                <h3>
                  {p.username} {p.staff && <em className="pc-staff">STAFF</em>}
                </h3>
                <div className="pc-tier">
                  <TierBadge tier={p.tier} size={22} /> {p.tier.name}
                </div>
              </div>
            </div>
            {p.next && (
              <div className="pc-progress">
                <div>
                  <i style={{ width: `${Math.round(p.progress * 100)}%`, background: p.tier.color }} />
                </div>
                <small>
                  {Math.round(p.progress * 100)}% to {p.next.name}
                </small>
              </div>
            )}
            <div className="pc-stats">
              <div>
                <LuTicket size={16} />
                <b>{p.bets}</b>
                <small>Sports bets</small>
              </div>
              <div>
                <LuDices size={16} />
                <b>{p.rounds}</b>
                <small>Casino rounds</small>
              </div>
              <div>
                <LuCalendar size={16} />
                <b>{new Date(p.joined).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</b>
                <small>Joined</small>
              </div>
            </div>
            <div className="pc-best">
              {p.bestCasino && (
                <div>
                  <LuTrophy size={16} />
                  <span>
                    Best casino win <b>{p.bestCasino.multiplier.toFixed(2)}×</b> on {p.bestCasino.game} · {usd(p.bestCasino.payout)}
                  </span>
                </div>
              )}
              {p.bestSports && (
                <div>
                  <LuTrophy size={16} />
                  <span>
                    Best sports win at odds <b>{p.bestSports.odds.toFixed(2)}</b> · {usd(p.bestSports.payout)}
                  </span>
                </div>
              )}
              {p.favouriteGame && (
                <div>
                  <LuDices size={16} />
                  <span>
                    Favourite game: <b>{p.favouriteGame}</b>
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
