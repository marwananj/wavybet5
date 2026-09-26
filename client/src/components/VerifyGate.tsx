import { useEffect, useRef, useState } from 'react';
import { LuArrowLeft, LuCheck, LuHeadphones, LuLogOut, LuMail, LuPencil } from 'react-icons/lu';
import { api, ApiError } from '../lib/api';
import { takeVerifyError, useAuth } from '../lib/state';
import type { User } from '../lib/types';
import { Logo, Spinner } from './ui';
import { SUPPORT_EMAIL } from '../lib/site';
import { openChat } from './Layout';

/**
 * Full-screen gate: a player whose e-mail is not verified cannot enter the site until they type the
 * 6-digit code we e-mailed them. They can resend the code, fix a typo in the address, contact support
 * or log out.
 */
export function VerifyGate() {
  const { user, setUser, logout } = useAuth();
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [wait, setWait] = useState(0);
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [sending, setSending] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const e = takeVerifyError();
    if (e) setErr(`We couldn't send your code: ${e}. Tap “Resend code”.`);
    else setWait(45);
    refs.current[0]?.focus();
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  if (!user) return null;
  const code = digits.join('');

  const fail = (msg: string) => {
    setErr(msg);
    setInfo(null);
    setShake((s) => s + 1);
  };

  const submit = async (c = code) => {
    if (c.length !== 6 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const d = await api<{ user: User }>('/auth/verify', { body: { code: c } });
      setDone(true);
      setTimeout(() => setUser(d.user), 1100); // short success animation, then into the site
    } catch (e) {
      fail((e as ApiError).message);
      setDigits(Array(6).fill(''));
      refs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  };

  const put = (i: number, v: string) => {
    const clean = v.replace(/\D/g, '');
    if (clean.length > 1) {
      const next = clean.slice(0, 6).split('');
      while (next.length < 6) next.push('');
      setDigits(next);
      refs.current[Math.min(clean.length, 5)]?.focus();
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
    setInfo(null);
    setSending(true);
    try {
      await api('/auth/verify/send', { method: 'POST' });
      setInfo('New code sent — check your inbox and spam folder.');
      setWait(60);
      setDigits(Array(6).fill(''));
      refs.current[0]?.focus();
    } catch (e) {
      fail((e as ApiError).message);
    } finally {
      setSending(false);
    }
  };

  const changeEmail = async () => {
    setErr(null);
    setSending(true);
    try {
      const d = await api<{ user: User }>('/auth/verify/email', { body: { email: newEmail } });
      setUser(d.user);
      setEditing(false);
      setInfo(`Code sent to ${d.user.email}`);
      setWait(60);
      setDigits(Array(6).fill(''));
    } catch (e) {
      fail((e as ApiError).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="vg">
      <div className="vg-waves" aria-hidden />
      <header className="vg-top">
        <Logo />
        <button type="button" className="vg-link" onClick={() => logout()}>
          <LuLogOut size={15} /> Log out
        </button>
      </header>

      <main className="vg-card">
        <ol className="vg-steps" aria-label="Sign-up steps">
          <li className="ok">
            <i>
              <LuCheck size={12} />
            </i>
            Account
          </li>
          <li className={done ? 'ok' : 'on'}>
            <i>{done ? <LuCheck size={12} /> : 2}</i>
            Verify e-mail
          </li>
          <li className={done ? 'on' : ''}>
            <i>3</i>
            Play
          </li>
        </ol>

        <div className={`vg-ico ${done ? 'done' : ''}`}>{done ? <LuCheck size={34} /> : <LuMail size={32} />}</div>

        {done ? (
          <>
            <h1>You're verified!</h1>
            <p className="vg-sub">Welcome to WavyBet, {user.username}. Taking you in…</p>
          </>
        ) : editing ? (
          <>
            <h1>Change e-mail</h1>
            <p className="vg-sub">Enter the correct address and we'll send a new code.</p>
            <input
              className="vg-email-input"
              type="email"
              inputMode="email"
              autoFocus
              placeholder="you@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && changeEmail()}
            />
            {err && <div className="vg-msg err">{err}</div>}
            <button type="button" className="btn btn-primary btn-block vg-btn" disabled={sending || !newEmail.includes('@') || wait > 0} onClick={changeEmail}>
              {sending ? <Spinner /> : wait > 0 ? `Send code in ${wait}s` : 'Send code'}
            </button>
            <button type="button" className="vg-link center" onClick={() => (setEditing(false), setErr(null))}>
              <LuArrowLeft size={14} /> Back
            </button>
          </>
        ) : (
          <>
            <h1>Check your e-mail</h1>
            <p className="vg-sub">Enter the 6-digit code we sent to</p>
            <div className="vg-email">
              <b>{user.email}</b>
              <button type="button" onClick={() => (setEditing(true), setNewEmail(user.email), setErr(null), setInfo(null))} aria-label="Change e-mail">
                <LuPencil size={13} /> Change
              </button>
            </div>

            <div className="vg-otp" key={shake} data-shake={shake > 0 && !!err}>
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => void (refs.current[i] = el)}
                  className={d ? 'filled' : ''}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  aria-label={`Digit ${i + 1}`}
                  maxLength={6}
                  value={d}
                  disabled={busy}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => put(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !d && i > 0) refs.current[i - 1]?.focus();
                    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
                    if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
                  }}
                />
              ))}
            </div>

            {err && <div className="vg-msg err">{err}</div>}
            {info && !err && <div className="vg-msg ok">{info}</div>}

            <button type="button" className="btn btn-primary btn-block vg-btn" disabled={busy || code.length !== 6} onClick={() => submit()}>
              {busy ? <Spinner /> : 'Verify & start playing'}
            </button>
            <div className="vg-resend">
              Didn't get it?{' '}
              <button type="button" disabled={wait > 0 || sending} onClick={resend}>
                {sending ? 'Sending…' : wait > 0 ? `Resend in ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}` : 'Resend code'}
              </button>
            </div>
            <p className="vg-hint">The code expires in 15 minutes. Check your spam or promotions folder too.</p>
          </>
        )}

        <div className="vg-gift">
          <span>🎁</span>
          <div>
            <b>$25 welcome gift</b>
            <small>Verify, then make your first deposit of $20+ to get it.</small>
          </div>
        </div>
      </main>

      <button type="button" className="vg-help" onClick={() => openChat('support')}>
        <LuHeadphones size={16} /> Need help? Live support
      </button>
      <a className="vg-mail" href={`mailto:${SUPPORT_EMAIL}`}>
        or e-mail {SUPPORT_EMAIL}
      </a>
    </div>
  );
}
