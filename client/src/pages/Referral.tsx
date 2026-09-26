import { useEffect, useState } from 'react';
import { LuCheck, LuCopy, LuLink, LuUsers, LuWallet } from 'react-icons/lu';
import { api, type ApiError } from '../lib/api';
import { usd } from '../lib/format';
import { useAuth, useToast } from '../lib/state';
import { BackBar } from '../components/Layout';
import { Skeleton, Spinner } from '../components/ui';
import { sfx } from '../casino/sound';

interface Ref {
  code: string;
  link: string;
  rate: number;
  minClaim: number;
  friends: number;
  friendsWagered: number;
  earned: number;
  paid: number;
  claimable: number;
  recent: { user: string; joined: string; wagered: number }[];
}

export function ReferralPage() {
  const { user, openAuth, setBalance } = useAuth();
  const toast = useToast();
  const [r, setR] = useState<Ref | null>(null);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (user) api<Ref>('/rewards/referral').then(setR).catch(() => {});
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async (what: 'link' | 'code') => {
    if (!r) return;
    try {
      await navigator.clipboard.writeText(what === 'link' ? r.link : r.code);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast('err', 'Copy failed — select the text instead');
    }
  };
  const claim = async () => {
    setBusy(true);
    try {
      const d = await api<{ claimed: number; balance: string }>('/rewards/referral/claim', { method: 'POST' });
      setBalance(d.balance);
      sfx.cashout();
      toast('ok', `${usd(d.claimed)} commission added to your balance`);
      setR((x) => (x ? { ...x, paid: x.paid + d.claimed, claimable: 0 } : x));
    } catch (e) {
      toast('err', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  const text = r ? `Join me on WavyBet — sports, live betting and Wavy Originals. Sign up with my link: ${r.link}` : '';

  return (
    <div className="page ref-page">
      <BackBar title="Refer & Earn" />
      <section className="ref-hero">
        <div className="ref-ico" aria-hidden>
          <LuUsers size={34} />
        </div>
        <h2>Invite friends. Earn on every bet they place.</h2>
        <p>
          You get <b>{r ? `${(r.rate * 100).toFixed(2)}%` : '0.25%'}</b> of everything your friends wager — sports and Originals, win or lose, for life. Claim any time from{' '}
          {r ? usd(r.minClaim) : '$1'}.
        </p>
      </section>
      {!user ? (
        <button className="btn btn-primary btn-block" onClick={() => openAuth('login')}>
          Log in to get your invite link
        </button>
      ) : !r ? (
        <Skeleton h={120} />
      ) : (
        <>
          <div className="ref-link">
            <label>Your invite link</label>
            <div className="ref-row">
              <input readOnly value={r.link} onFocus={(e) => e.target.select()} />
              <button className="btn btn-primary" onClick={() => copy('link')}>
                {copied === 'link' ? <LuCheck size={16} /> : <LuLink size={16} />} {copied === 'link' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="ref-code">
              Code: <b>{r.code}</b>
              <button onClick={() => copy('code')} aria-label="Copy code">
                {copied === 'code' ? <LuCheck size={14} /> : <LuCopy size={14} />}
              </button>
            </div>
            <div className="ref-share">
              <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="wa">
                WhatsApp
              </a>
              <a href={`https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent('Join me on WavyBet!')}`} target="_blank" rel="noreferrer" className="tg">
                Telegram
              </a>
              <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="x">
                X
              </a>
            </div>
          </div>
          <div className="ref-stats">
            <div>
              <small>Friends joined</small>
              <b>{r.friends}</b>
            </div>
            <div>
              <small>Friends wagered</small>
              <b>{usd(r.friendsWagered)}</b>
            </div>
            <div>
              <small>Total earned</small>
              <b>{usd(r.earned)}</b>
            </div>
            <div className="hl">
              <small>Ready to claim</small>
              <b>{usd(r.claimable)}</b>
            </div>
          </div>
          <button className="btn btn-primary btn-block" disabled={busy || r.claimable < r.minClaim} onClick={claim}>
            {busy ? <Spinner /> : (
              <>
                <LuWallet size={16} /> {r.claimable >= r.minClaim ? `Claim ${usd(r.claimable)}` : `Claim from ${usd(r.minClaim)}`}
              </>
            )}
          </button>
          {r.recent.length > 0 && (
            <section className="ref-list">
              <h3>Your friends</h3>
              {r.recent.map((f, i) => (
                <div key={i}>
                  <span>{f.user}</span>
                  <small>{new Date(f.joined).toLocaleDateString()}</small>
                  <b>{usd(f.wagered)} wagered</b>
                </div>
              ))}
            </section>
          )}
        </>
      )}
      <section className="ref-how">
        <h3>How it works</h3>
        <ol>
          <li>Share your link or code.</li>
          <li>Your friend signs up with it and verifies their e-mail.</li>
          <li>Every time they bet, you earn a commission — claim it to your balance.</li>
        </ol>
        <small className="muted">Self-referrals and duplicate accounts are not allowed and forfeit commission.</small>
      </section>
    </div>
  );
}
