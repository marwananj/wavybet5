import { useEffect, useState, type CSSProperties } from 'react';
import { LuCrown, LuGift, LuTrendingUp, LuZap } from 'react-icons/lu';
import { api, type ApiError } from '../lib/api';
import { usd } from '../lib/format';
import { useAuth, useToast } from '../lib/state';
import { BackBar } from '../components/Layout';
import { Skeleton, Spinner } from '../components/ui';
import { FirstDepositPoster } from '../components/FirstDepositPromo';

interface Tier {
  id: string;
  name: string;
  from: number;
  color: string;
}
interface Vip {
  wagered: number;
  tier: Tier;
  next: Tier | null;
  progress: number;
  tiers: Tier[];
  step: number;
  reward: number;
  claimable: number;
  claimableChunks: number;
  claimedTotal: number;
  toNextReward: number;
}

export function TierBadge({ tier, size = 34 }: { tier: Pick<Tier, 'id' | 'color' | 'name'>; size?: number }) {
  return (
    <span className={`tier-badge t-${tier.id}`} style={{ width: size, height: size, color: tier.color }} title={tier.name}>
      <svg viewBox="0 0 40 40" aria-hidden>
        <path d="M20 2 L35 10 L35 26 L20 38 L5 26 L5 10Z" fill="currentColor" opacity=".22" stroke="currentColor" strokeWidth="2" />
        <path d="M12 24 L14 14 L20 19 L26 14 L28 24Z" fill="currentColor" />
      </svg>
    </span>
  );
}

export function VipPage() {
  const { user, openAuth, setBalance } = useAuth();
  const toast = useToast();
  const [v, setV] = useState<Vip | null>(null);
  const [info, setInfo] = useState<{ tiers: Tier[]; step: number; reward: number; firstDeposit: { bonus: number; min: number; wagerX: number } } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/vip/info').then(setInfo).catch(() => {});
  }, []);
  useEffect(() => {
    if (!user) return setV(null);
    api<Vip>('/vip').then(setV).catch(() => {});
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const claim = async () => {
    setBusy(true);
    try {
      const d = await api<{ claimed: string; balance: string; status: Vip }>('/vip/claim', { method: 'POST' });
      setBalance(d.balance);
      setV(d.status);
      toast('ok', `🎉 ${usd(d.claimed)} booster added to your balance`);
    } catch (e) {
      toast('err', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const tiers = v?.tiers ?? info?.tiers ?? [];
  const step = v?.step ?? info?.step ?? 5000;
  const reward = v?.reward ?? info?.reward ?? 20;
  const inStep = v ? step - v.toNextReward : 0;

  return (
    <div className="page">
      <BackBar title="VIP Club" />
      <section className="vip-hero">
        <div className="vip-hero-glow" />
        <LuCrown size={30} className="vip-crown" />
        <h1>WavyBet VIP Booster</h1>
        <p>
          Every <b>{usd(step)}</b> you wager — casino or sports — pays you <b>{usd(reward)}</b> in real balance. No wagering on the booster. Climb the tiers as you play.
        </p>
        {!user && (
          <button className="btn btn-primary" onClick={() => openAuth('register')}>
            Join the club
          </button>
        )}
      </section>

      {user && !v && <Skeleton h={180} count={1} />}
      {v && (
        <section className="vip-card" style={{ '--tc': v.tier.color } as CSSProperties}>
          <div className="vip-row">
            <TierBadge tier={v.tier} size={56} />
            <div className="vip-who">
              <small>Your tier</small>
              <b>{v.tier.name}</b>
              <span>Wagered {usd(v.wagered)}</span>
            </div>
            {v.next && (
              <div className="vip-next">
                <small>Next: {v.next.name}</small>
                <b>{usd(Math.max(0, v.next.from - v.wagered))} to go</b>
              </div>
            )}
          </div>
          <div className="vip-bar">
            <i style={{ width: `${Math.min(100, v.progress * 100)}%` }} />
          </div>

          <div className="booster">
            <div className="booster-ring" style={{ '--p': inStep / step } as CSSProperties}>
              <div>
                <LuZap size={18} />
                <b>{Math.floor((inStep / step) * 100)}%</b>
              </div>
            </div>
            <div className="booster-copy">
              <b>Booster progress</b>
              <span>
                {usd(inStep)} of {usd(step)} — {usd(v.toNextReward)} more for your next {usd(reward)}
              </span>
              <small>Claimed so far: {usd(v.claimedTotal)}</small>
            </div>
            <button className="btn btn-cash booster-claim" disabled={!v.claimable || busy} onClick={claim}>
              {busy ? <Spinner /> : v.claimable ? (
                <>
                  <LuGift size={16} /> Claim {usd(v.claimable)}
                </>
              ) : (
                'Nothing to claim yet'
              )}
            </button>
          </div>
        </section>
      )}

      <h3 className="section-title">
        <LuTrendingUp size={18} /> Tiers
      </h3>
      <div className="tier-grid">
        {tiers.map((t) => {
          const reached = v ? v.wagered >= t.from : false;
          return (
            <div key={t.id} className={`tier-card ${v?.tier.id === t.id ? 'current' : ''} ${reached ? 'reached' : ''}`} style={{ '--tc': t.color } as CSSProperties}>
              <TierBadge tier={t} size={40} />
              <b>{t.name}</b>
              <small>{t.from === 0 ? 'From your first bet' : `${usd(t.from)} wagered`}</small>
              <em>
                {usd(reward)} per {usd(step)}
              </em>
            </div>
          );
        })}
      </div>
      <FirstDepositPoster compact amount={info?.firstDeposit?.bonus} min={info?.firstDeposit?.min} />
    </div>
  );
}
