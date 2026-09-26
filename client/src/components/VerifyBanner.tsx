import { LuMailWarning } from 'react-icons/lu';
import { useAuth } from '../lib/state';

/** Shown until the player confirms their e-mail. */
export function VerifyBanner() {
  const { user, openAuth } = useAuth();
  if (!user || user.emailVerified !== false) return null;
  return (
    <div className="verify-banner">
      <LuMailWarning size={18} />
      <span>
        Confirm your e-mail to start playing — we sent a code to <b>{user.email}</b>.
      </span>
      <button className="btn btn-primary btn-sm" onClick={() => openAuth('verify')}>
        Enter code
      </button>
    </div>
  );
}
