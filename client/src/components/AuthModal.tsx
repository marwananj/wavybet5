import { useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/state';
import { Logo, Modal, Spinner } from './ui';

const COUNTRIES: [string, string][] = [
  ['LB', 'Lebanon'], ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['EG', 'Egypt'], ['JO', 'Jordan'], ['TR', 'Türkiye'], ['CY', 'Cyprus'],
  ['DE', 'Germany'], ['IT', 'Italy'], ['PT', 'Portugal'], ['GR', 'Greece'], ['BR', 'Brazil'], ['AR', 'Argentina'], ['MX', 'Mexico'], ['CA', 'Canada'],
  ['IN', 'India'], ['NG', 'Nigeria'], ['KE', 'Kenya'], ['ZA', 'South Africa'], ['JP', 'Japan'], ['KR', 'South Korea'], ['PH', 'Philippines'],
  ['TH', 'Thailand'], ['VN', 'Vietnam'], ['NZ', 'New Zealand'], ['NO', 'Norway'], ['FI', 'Finland'], ['IE', 'Ireland'], ['AT', 'Austria'],
  ['CH', 'Switzerland'], ['PL', 'Poland'], ['CZ', 'Czechia'], ['RO', 'Romania'], ['RS', 'Serbia'], ['HR', 'Croatia'], ['CL', 'Chile'], ['PE', 'Peru'], ['CO', 'Colombia'],
];

export function AuthModal() {
  const { modal, openAuth, login, register } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ login: '', email: '', username: '', password: '', dob: '', country: 'LB', terms: false });
  if (!modal) return null;
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
