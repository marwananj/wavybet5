import { useState, type FormEvent } from 'react';
import { LuLogOut, LuShield, LuTicket, LuWallet } from 'react-icons/lu';
import { api, ApiError, setAccessToken } from '../lib/api';
import { usd } from '../lib/format';
import { Link, useRouter } from '../lib/router';
import { useAuth, useToast } from '../lib/state';
import type { User } from '../lib/types';
import { BackBar } from '../components/Layout';
import { Empty, Spinner } from '../components/ui';

export function AccountPage() {
  const { user, ready, openAuth, logout, setUser } = useAuth();
  const { navigate } = useRouter();
  const toast = useToast();
  const [pw, setPw] = useState({ current: '', next: '' });
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  if (ready && !user) return <div className="page"><Empty title="Log in to manage your account" action={<button className="btn btn-primary" onClick={() => openAuth('login')}>Log in</button>} /></div>;
  if (!user) return null;

  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('pw');
    try {
      const d = await api<{ accessToken: string }>('/auth/change-password', { body: pw });
      setAccessToken(d.accessToken);
      setPw({ current: '', next: '' });
      toast('ok', 'Password updated');
    } catch (e) {
      toast('err', (e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  const setResp = async (body: Record<string, unknown>, msg: string) => {
    setBusy('rg');
    try {
      const d = await api<{ user: User }>('/auth/responsible', { body });
      setUser(d.user);
      toast('ok', msg);
      if (body.selfExcludeDays) {
        await logout();
        navigate('/');
      }
    } catch (e) {
      toast('err', (e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page page-narrow">
      <BackBar title="Account" />
      <div className="profile-card">
        <div className="avatar big">{user.username.slice(0, 2).toUpperCase()}</div>
        <div>
          <b>{user.username}</b>
          <span>{user.email}</span>
          <small>
            Member since {new Date(user.createdAt).toLocaleDateString()} · KYC: {user.kycStatus.toLowerCase()}
          </small>
        </div>
      </div>
      <div className="quick-links">
        <Link to="/wallet" className="ql"><LuWallet size={20} /> Wallet <b>{usd(user.balance)}</b></Link>
        <Link to="/bets" className="ql"><LuTicket size={20} /> My bets</Link>
        {user.role === 'ADMIN' && <Link to="/admin" className="ql"><LuShield size={20} /> Admin</Link>}
      </div>

      <section className="panel">
        <h3>Change password</h3>
        <form onSubmit={changePw} className="stack">
          <label className="field"><span>Current password</span><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></label>
          <label className="field"><span>New password</span><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required minLength={8} /></label>
          <button className="btn btn-primary" disabled={busy === 'pw'}>{busy === 'pw' ? <Spinner /> : 'Update password'}</button>
        </form>
      </section>

      <section className="panel">
        <h3>Responsible gambling</h3>
        <p className="muted">Set a daily deposit limit. Lowering it applies immediately; raising or removing it is allowed 24h after your last change.</p>
        <div className="inline-form">
          <div className="amount-input">
            <b>$</b>
            <input inputMode="decimal" placeholder={user.dailyDepositLimit ? `Current: ${usd(user.dailyDepositLimit)}` : 'No limit'} value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ''))} />
          </div>
          <button className="btn btn-primary" disabled={!limit || busy === 'rg'} onClick={() => setResp({ dailyDepositLimit: Number(limit) }, 'Deposit limit saved')}>Save</button>
          {user.dailyDepositLimit && <button className="btn btn-ghost" onClick={() => setResp({ dailyDepositLimit: null }, 'Limit removed')}>Remove</button>}
        </div>
        <h4>Take a break</h4>
        <p className="muted">Self-exclusion locks deposits and betting for the chosen period. It cannot be undone early.</p>
        <div className="chips">
          {[[1, '24 hours'], [7, '1 week'], [30, '1 month'], [180, '6 months'], [365, '1 year']].map(([d, l]) => (
            <button key={d} className="chip" onClick={() => window.confirm(`Self-exclude for ${l}? You will be logged out and cannot bet or deposit until it ends.`) && setResp({ selfExcludeDays: d }, `Self-excluded for ${l}`)}>{l}</button>
          ))}
        </div>
      </section>

      <button className="btn btn-ghost btn-block" onClick={() => logout().then(() => navigate('/'))}>
        <LuLogOut size={16} /> Log out
      </button>
    </div>
  );
}

export function InfoPage({ kind }: { kind: 'terms' | 'responsible' }) {
  return (
    <div className="page page-narrow prose">
      <BackBar title={kind === 'terms' ? 'Terms & Conditions' : 'Responsible Gambling'} />
      {kind === 'terms' ? (
        <>
          <p className="muted">Replace this page with the terms approved by your licensing authority and legal counsel before launch.</p>
          <h3>1. Eligibility</h3>
          <p>You must be at least 18 years old (or the legal age in your jurisdiction, if higher) and located in a country where WavyBet is permitted. Accounts from restricted territories will be closed.</p>
          <h3>2. Accounts</h3>
          <p>One account per person. You are responsible for keeping your credentials secure. We may request identity verification (KYC) before processing withdrawals.</p>
          <h3>3. Deposits & withdrawals</h3>
          <p>Deposits are made in cryptocurrency and credited in USD at the rate quoted at the time of payment. Withdrawals are paid in the cryptocurrency you choose; network fees apply.</p>
          <h3>4. Betting rules</h3>
          <p>Bets are accepted pre-match only and settled on the official full-time result as reported by our data provider. Postponed or abandoned matches are void and stakes returned. Palpable odds errors may be voided. Maximum payout per bet applies.</p>
          <h3>5. Closure</h3>
          <p>We may suspend accounts involved in fraud, bonus abuse, multiple accounts or collusion.</p>
        </>
      ) : (
        <>
          <p>Betting should be entertainment, never a way to make money or escape problems.</p>
          <h3>Tools on WavyBet</h3>
          <ul>
            <li><b>Deposit limits</b> — cap how much you can deposit every 24 hours (Account → Responsible gambling).</li>
            <li><b>Self-exclusion</b> — lock your account from 24 hours up to a year.</li>
            <li><b>Bet history</b> — every stake and payout is visible under My bets and Wallet → History.</li>
          </ul>
          <h3>Warning signs</h3>
          <ul>
            <li>Chasing losses or betting more to feel the same excitement</li>
            <li>Betting with money meant for bills or borrowing to bet</li>
            <li>Hiding your betting from family or friends</li>
          </ul>
          <h3>Get help</h3>
          <p>Free, confidential support: <a href="https://www.gamblingtherapy.org" target="_blank" rel="noreferrer">Gambling Therapy</a> (worldwide, multilingual) and <a href="https://www.begambleaware.org" target="_blank" rel="noreferrer">BeGambleAware</a>.</p>
        </>
      )}
    </div>
  );
}
