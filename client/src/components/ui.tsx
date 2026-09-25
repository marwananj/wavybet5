import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MdSportsSoccer, MdSportsBasketball, MdSportsTennis, MdSportsMma, MdSportsHockey, MdSportsFootball, MdSportsBaseball, MdSportsCricket, MdSportsRugby, MdSportsGolf, MdSportsHandball } from 'react-icons/md';
import { GiBoxingGlove } from 'react-icons/gi';
import { LuLock, LuTrophy, LuX } from 'react-icons/lu';
import type { IconType } from 'react-icons';
import { initials, teamColor, odds as fmtOdds } from '../lib/format';
import { useSlip } from '../lib/state';
import type { Outcome, SportEvent } from '../lib/types';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="logo" aria-label="WavyBet">
      <svg viewBox="0 0 64 40" className="logo-mark" aria-hidden>
        <defs>
          <linearGradient id="wbg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3ad0ff" />
            <stop offset="1" stopColor="#2a6bff" />
          </linearGradient>
        </defs>
        <path d="M4 28c6-10 12-10 18 0s12 10 18 0 12-10 20-4" fill="none" stroke="url(#wbg)" strokeWidth="7" strokeLinecap="round" />
        <path d="M4 14c6-10 12-10 18 0s12 10 18 0 12-10 20-4" fill="none" stroke="#fff" strokeOpacity=".9" strokeWidth="5" strokeLinecap="round" />
      </svg>
      {!compact && (
        <span className="logo-word">
          wavy<b>bet</b>
        </span>
      )}
    </span>
  );
}

const ICONS: Record<string, IconType> = {
  soccer: MdSportsSoccer,
  basketball: MdSportsBasketball,
  tennis: MdSportsTennis,
  mma: MdSportsMma,
  boxing: GiBoxingGlove,
  icehockey: MdSportsHockey,
  americanfootball: MdSportsFootball,
  baseball: MdSportsBaseball,
  cricket: MdSportsCricket,
  rugbyleague: MdSportsRugby,
  rugbyunion: MdSportsRugby,
  aussierules: MdSportsRugby,
  golf: MdSportsGolf,
  handball: MdSportsHandball,
};
export function SportIcon({ sportKey, size = 18 }: { sportKey: string; size?: number }) {
  const group = sportKey.split('_')[0].toLowerCase().replace(/\s+/g, '');
  const I = ICONS[group] ?? LuTrophy;
  return <I size={size} />;
}

export function TeamBadge({ name, size = 26, logo }: { name: string; size?: number; logo?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (logo && !broken) {
    return (
      <span className="team-logo" style={{ width: size, height: size }}>
        <img src={logo} alt="" loading="lazy" width={size} height={size} onError={() => setBroken(true)} />
      </span>
    );
  }
  const c = teamColor(name);
  return (
    <span className="team-badge" style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, ${c}, ${c}99)` }} aria-hidden>
      {initials(name) || '?'}
    </span>
  );
}

export function OddsButton({ ev, marketKey, o, label, compact, locked }: { ev: SportEvent; marketKey: string; o?: Outcome; label: string; compact?: boolean; locked?: boolean }) {
  const slip = useSlip();
  // flash green/red when the price moves
  const prev = useRef<number | undefined>(o?.price);
  const [move, setMove] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (o == null) return;
    const before = prev.current;
    prev.current = o.price;
    if (before == null || before === o.price) return;
    setMove(o.price > before ? 'up' : 'down');
    const t = setTimeout(() => setMove(null), 2200);
    return () => clearTimeout(t);
  }, [o?.price]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!o) {
    return (
      <button className="odds-btn" disabled>
        <span className="odds-label">{label}</span>
        <span className="odds-val">—</span>
      </button>
    );
  }
  const active = slip.has(o.id);
  const isLocked = locked || o.suspended || ev.bettingOpen === false;
  return (
    <button
      className={`odds-btn${active ? ' active' : ''}${compact ? ' compact' : ''}${move ? ` move-${move}` : ''}${isLocked ? ' locked' : ''}`}
      disabled={isLocked && !active}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isLocked && !active) return;
        slip.toggle(ev, marketKey, o);
      }}
      aria-pressed={active}
      title={isLocked ? 'Suspended' : undefined}
    >
      <span className="odds-label">{label}</span>
      {isLocked ? (
        <span className="odds-val odds-lock" aria-label="Suspended">
          <LuLock size={14} />
        </span>
      ) : (
        <span className="odds-val">
          {move && <i className="odds-arrow">{move === 'up' ? '▲' : '▼'}</i>}
          {fmtOdds(o.price)}
        </span>
      )}
    </button>
  );
}

export function Modal({ onClose, children, title, wide }: { onClose: () => void; children: ReactNode; title?: string; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', k);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal onMouseDown={(e) => e.stopPropagation()}>
        <button className="icon-btn modal-close" onClick={onClose} aria-label="Close">
          <LuX size={20} />
        </button>
        {title && <h2 className="modal-title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 120, count = 4 }: { h?: number; count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: h }} />
      ))}
    </>
  );
}
