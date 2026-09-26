import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LuMailCheck } from 'react-icons/lu';
import { api, ApiError } from '../lib/api';
import type { User } from '../lib/types';
import { useAuth } from '../lib/state';
import { Logo, Modal, Spinner } from './ui';

const COUNTRIES: [string, string][] = [
  ['LB', 'Lebanon'], ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['EG', 'Egypt'], ['JO', 'Jordan'], ['TR', 'Türkiye'], ['CY', 'Cyprus'],
  ['DE', 'Germany'], ['IT', 'Italy'], ['PT', 'Portugal'], ['GR', 'Greece'], ['BR', 'Brazil'], ['AR', 'Argentina'], ['MX', 'Mexico'], ['CA', 'Canada'],
  ['IN', 'India'], ['NG', 'Nigeria'], ['KE', 'Kenya'], ['ZA', 'South Africa'], ['JP', 'Japan'], ['KR', 'South Korea'], ['PH', 'Philippines'],
  ['TH', 'Thailand'], ['VN', 'Vietnam'], ['NZ', 'New Zealand'], ['NO', 'Norway'], ['FI', 'Finland'], ['IE', 'Ireland'], ['AT', 'Austria'],
  ['CH', 'Switzerland'], ['PL', 'Poland'], ['CZ', 'Czechia'], ['RO', 'Romania'], ['RS', 'Serbia'], ['HR', 'Croatia'], ['CL', 'Chile'], ['PE', 'Peru'], ['CO', 'Colombia'],
];

/** 6-digit e-mail code (sent by the server through EmailJS). */
function VerifyEmail() {
  const { user, setUser, openAuth } = useAuth();
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  useEffect(() => refs.current[0]?.focus(), []);
  if (!user) return null;
  const code = digits.join('');
  const submit = async (c = code) => {
    if (c.length !== 6) return;
    setBusy(true);
    setErr(null);
    try {
      const d = await api<{ user: User }>('/auth/verify', { body: { code: c } });
      setUser(d.user);
      openAuth(null);
    } catch (e) {
      setErr((e as ApiError).message);
      setDigits(Array(6).fill(''));
      refs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  };
  const put = (i: number, v: string) => {
    const clean = v.replace(/\D/g, '');
    if (clean.length > 1) {
      // pasted the whole code
      const next = clean.slice(0, 6).split('');
      while (next.length < 6) next.push('');
      setDigits(next);
      if (clean.length >= 6) submit(clean.slice(0, 6));
      return;
    }
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) refs.current[i + 1]?.focus();
    if (next.join('').length === 6) submit(next.join(''));
  };
  const resend = async () => {
    setErr(null);
    try {
      await api('/auth/verify/send', { method: 'POST' });
      setInfo('A new code is on its way — check your inbox and spam folder.');
      setWait(60);
    } catch (e) {
      setErr((e as ApiError).message);
    }
  };
  return (
    <div className="verify">
      <div className="verify-ico">
        <LuMailCheck size={30} />
      </div>
      <h3>Verify your e-mail</h3>
      <p>
        We sent a 6-digit code to <b>{user.email}</b>. Enter it below to unlock deposits, betting and the casino.
      </p>
      <div className="otp">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => void (refs.current[i] = el)}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={6}
            value={d}
            onChange={(e) => put(i, e.target.value)}
            onKeyDown={(e) => e.key === 'Backspace' && !d && i > 0 && refs.current[i - 1]?.focus()}
          />
        ))}
      </div>
      {err && <div className="form-error">{err}</div>}
      {info && !err && <div className="form-info">{info}</div>}
      <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6} onClick={() => submit()}>
        {busy ? <Spinner /> : 'Verify & start playing'}
      </button>
      <button className="btn btn-ghost btn-block" disabled={wait > 0} onClick={resend}>
        {wait > 0 ? `Resend code in ${wait}s` : "Didn't get it? Resend code"}
      </button>
      <button className="link-btn" onClick={() => openAuth(null)}>
        I'll do it later
      </button>
    </div>
  );
}

export function AuthModal() {
  const { modal, openAuth, login, register } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ login: '', email: '', username: '', password: '', dob: '', country: 'LB', terms: false });
  if (!modal) return null;
  if (modal === 'verify')
    return (
      <Modal onClose={() => openAuth(null)}>
        <VerifyEmail />
      </Modal>
    );
  const set = (k: keyof typeof f) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (modal === 'login') await login(f.login, f.password);
      else
        await register({
          email: f.email,
          username: f.username,
          password: f.password,
          dateOfBirth: f.dob,
          country: f.country,
          acceptTerms: f.terms,
        });
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={() => openAuth(null)}>
      <div className="auth">
        <div className="auth-side">
          <Logo />
          <h3>{modal === 'login' ? 'Welcome back' : 'Ride the wave'}</h3>
          <p>Crypto deposits, fast withdrawals, sharp odds on thousands of matches.</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <div className="seg">
            <button type="button" className={modal === 'login' ? 'on' : ''} onClick={() => openAuth('login')}>
              Log in
            </button>
            <button type="button" className={modal === 'register' ? 'on' : ''} onClick={() => openAuth('register')}>
              Register
            </button>
          </div>

          {modal === 'login' ? (
            <>
              <label className="field">
                <span>Email or username</span>
                <input autoComplete="username" value={f.login} onChange={set('login')} required />
              </label>
              <label className="field">
                <span>Password</span>
                <input type="password" autoComplete="current-password" value={f.password} onChange={set('password')} required />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>Email</span>
                <input type="email" autoComplete="email" value={f.email} onChange={set('email')} required />
              </label>
              <label className="field">
                <span>Username</span>
                <input autoComplete="nickname" value={f.username} onChange={set('username')} required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]+" />
              </label>
              <label className="field">
                <span>Password</span>
                <input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required minLength={8} />
                <small>8+ characters with a letter and a number</small>
              </label>
              <div className="field-row">
                <label className="field">
                  <span>Date of birth</span>
                  <input type="date" value={f.dob} onChange={set('dob')} required max={new Date(Date.now() - 18 * 365.25 * 86400_000).toISOString().slice(0, 10)} />
                </label>
                <label className="field">
                  <span>Country</span>
                  <select value={f.country} onChange={set('country')}>
                    {COUNTRIES.map(([c, n]) => (
                      <option key={c} value={c}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="check">
                <input type="checkbox" checked={f.terms} onChange={set('terms')} required />
                <span>
                  I am 18 or older and accept the <a href="/terms" target="_blank">Terms</a> and <a href="/responsible-gambling" target="_blank">Responsible Gambling policy</a>.
                </span>
              </label>
            </>
          )}

          {err && <div className="form-error">{err}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? <Spinner /> : modal === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    </Modal>
  );
}
