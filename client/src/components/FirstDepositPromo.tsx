import type { CSSProperties } from 'react';
import { Link } from '../lib/router';
import { useAuth } from '../lib/state';

/**
 * Animated first-deposit poster (pure SVG/CSS animation — crisp on every screen, no image files):
 * a gift box bursts open, coins fly out and the $25 badge pulses.
 */
export function FirstDepositPoster({ compact = false, amount = 25, min = 20 }: { compact?: boolean; amount?: number; min?: number }) {
  const { user, openAuth } = useAuth();
  if (user?.firstDepositBonusClaimed) return null;
  const cta = user ? (
    <Link to="/wallet" className="fdp-cta">
      Deposit now
    </Link>
  ) : (
    <button type="button" className="fdp-cta" onClick={() => openAuth('register')}>
      Join & claim
    </button>
  );
  return (
    <section className={`fdp ${compact ? 'compact' : ''}`}>
      <div className="fdp-rays" aria-hidden />
      <div className="fdp-copy">
        <span className="fdp-kicker">Welcome gift</span>
        <h2>
          Get <b className="fdp-amt">${amount}</b> free
        </h2>
        <p>On your first deposit of ${min} or more — credited instantly to your balance.</p>
        {cta}
        <small>Gift must be wagered 10× before withdrawing. 18+ · T&amp;Cs apply.</small>
      </div>
      <div className="fdp-art" aria-hidden>
        <svg viewBox="0 0 220 200">
          <defs>
            <linearGradient id="fdp-box" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3ad0ff" />
              <stop offset="1" stopColor="#1466e0" />
            </linearGradient>
            <linearGradient id="fdp-rib" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#ffe28a" />
              <stop offset=".5" stopColor="#f5b820" />
              <stop offset="1" stopColor="#c47f0a" />
            </linearGradient>
            <radialGradient id="fdp-coin" cx="35%" cy="30%" r="70%">
              <stop offset="0" stopColor="#fff4c4" />
              <stop offset=".5" stopColor="#f5c542" />
              <stop offset="1" stopColor="#b8780a" />
            </radialGradient>
          </defs>
          {Array.from({ length: 9 }, (_, i) => (
            <g key={i} className="fdp-coin" style={{ '--i': i, '--dx': `${(i - 4) * 16}px`, '--r': `${(i - 4) * 40}deg` } as CSSProperties}>
              <circle cx="110" cy="112" r="11" fill="url(#fdp-coin)" stroke="#8a5a0a" strokeWidth="1.5" />
              <text x="110" y="116" textAnchor="middle" fontSize="11" fontWeight="900" fill="#8a5a0a">$</text>
            </g>
          ))}
          <g className="fdp-box">
            <rect x="58" y="112" width="104" height="72" rx="10" fill="url(#fdp-box)" />
            <rect x="102" y="112" width="16" height="72" fill="url(#fdp-rib)" />
            <rect x="58" y="126" width="104" height="10" fill="rgba(0,0,0,.18)" />
          </g>
          <g className="fdp-lid">
            <rect x="50" y="96" width="120" height="22" rx="7" fill="url(#fdp-box)" />
            <rect x="102" y="96" width="16" height="22" fill="url(#fdp-rib)" />
            <path d="M110 96 C 90 70, 70 84, 88 96 Z M110 96 C 130 70, 150 84, 132 96 Z" fill="url(#fdp-rib)" />
          </g>
          {Array.from({ length: 6 }, (_, i) => (
            <path key={i} className="fdp-spark" style={{ '--i': i } as CSSProperties} d="M0 -7 L2 -2 L7 0 L2 2 L0 7 L-2 2 L-7 0 L-2 -2Z" fill="#fff" transform={`translate(${30 + i * 32} ${30 + (i % 3) * 22})`} />
          ))}
        </svg>
        <div className="fdp-badge">
          <b>${amount}</b>
          <span>FREE</span>
        </div>
      </div>
    </section>
  );
}
