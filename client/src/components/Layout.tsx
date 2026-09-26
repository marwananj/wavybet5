import { useEffect, useState } from 'react';
import { LuHouse, LuRadio, LuTicket, LuWallet, LuSearch, LuUser, LuLogOut, LuShield, LuHistory, LuSettings, LuMenu, LuChevronLeft, LuHeadphones, LuStar } from 'react-icons/lu';
import { api } from '../lib/api';
import { usd } from '../lib/format';
import { Link, useRouter } from '../lib/router';
import { useAuth, useSlip, useToast } from '../lib/state';
import { useGoalAlerts } from '../lib/goals';
import type { Sport } from '../lib/types';
import { Logo, SportIcon } from './ui';
import { LuDices, LuMessageCircle, LuCrown, LuLightbulb, LuGift } from 'react-icons/lu';

/** open the chat drawer from anywhere */
export const openChat = (tab: 'chat' | 'support' = 'chat') => window.dispatchEvent(new CustomEvent('wb-chat', { detail: tab }));
import { GAMES } from '../casino/meta';

export function useSports() {
  const [sports, setSports] = useState<Sport[]>([]);
  useEffect(() => {
    api<{ sports: Sport[] }>('/sports').then((d) => setSports(d.sports)).catch(() => {});
  }, []);
  return sports;
}

export function Header({ onMenu }: { onMenu: () => void }) {
  const { user, openAuth, logout } = useAuth();
  const { navigate } = useRouter();
  const [menu, setMenu] = useState(false);
  const toast = useToast();
  useGoalAlerts(toast, !!user); // "GOAL!" sound + toast for matches you follow
  useEffect(() => {
    if (!menu) return;
    const c = () => setMenu(false);
    window.addEventListener('click', c);
    return () => window.removeEventListener('click', c);
  }, [menu]);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-btn hide-mobile" onClick={onMenu} aria-label="Toggle menu">
          <LuMenu size={20} />
        </button>
        <Link to="/" className="brand">
          <Logo />
        </Link>
      </div>
      <div className="topbar-right">
        <button className="icon-btn" onClick={() => navigate('/search')} aria-label="Search">
          <LuSearch size={19} />
        </button>
        <button className="icon-btn chat-toggle" onClick={() => openChat('chat')} aria-label="Open chat">
          <LuMessageCircle size={19} />
        </button>
        {user ? (
          <>
            <div className="balance-pill">
              <span className="balance-amt">{usd(user.balance)}</span>
              <Link to="/wallet" className="btn btn-primary btn-sm">
                <LuWallet size={16} />
                <span className="hide-xs">Wallet</span>
              </Link>
            </div>
            <div className="user-menu">
              <button
                className="avatar"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu((m) => !m);
                }}
                aria-label="Account menu"
              >
                {user.username.slice(0, 2).toUpperCase()}
              </button>
              {menu && (
                <div className="dropdown">
                  <div className="dropdown-head">
                    <b>{user.username}</b>
                    <span>{user.email}</span>
                  </div>
                  <Link to="/bets" className="dropdown-item">
                    <LuTicket size={16} /> My bets
                  </Link>
                  <Link to="/vip" className="dropdown-item">
                    <LuCrown size={16} /> VIP booster
                  </Link>
                  <Link to="/wallet?tab=history" className="dropdown-item">
                    <LuHistory size={16} /> Transactions
                  </Link>
                  <Link to="/account" className="dropdown-item">
                    <LuSettings size={16} /> Settings & limits
                  </Link>
                  {user.role === 'ADMIN' && (
                    <Link to="/admin" className="dropdown-item">
                      <LuShield size={16} /> Admin panel
                    </Link>
                  )}
                  <button className="dropdown-item danger" onClick={() => logout().then(() => navigate('/'))}>
                    <LuLogOut size={16} /> Log out
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => openAuth('login')}>
              Log in
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => openAuth('register')}>
              Register
            </button>
          </>
        )}
      </div>
    </header>
  );
}

export function Sidebar({ collapsed, sports }: { collapsed: boolean; sports: Sport[] }) {
  const { path } = useRouter();
  // with 100+ competitions, only list those that currently have matches (busiest first)
  const groups = sports
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
    .reduce<Record<string, Sport[]>>((acc, s) => {
      (acc[s.group] ??= []).push(s);
      return acc;
    }, {});
  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Sports">
      <div className="side-section">
        <Link to="/" className={`side-item${path === '/' ? ' active' : ''}`} title="Home">
          <LuHouse size={18} />
          <span>Home</span>
        </Link>
        <Link to="/live" className={`side-item${path === '/live' ? ' active' : ''}`} title="Live">
          <LuRadio size={18} />
          <span>Live</span>
        </Link>
        <Link to="/bets" className={`side-item${path === '/bets' ? ' active' : ''}`} title="My bets">
          <LuTicket size={18} />
          <span>My bets</span>
        </Link>
        <Link to="/tips" className={`side-item${path === '/tips' ? ' active' : ''}`} title="Tips of the day">
          <LuLightbulb size={18} />
          <span>Tips of the day</span>
        </Link>
        <Link to="/vip" className={`side-item vip-link${path === '/vip' ? ' active' : ''}`} title="VIP booster">
          <LuCrown size={18} />
          <span>VIP booster</span>
        </Link>
        <Link to="/promotions" className={`side-item${path === '/promotions' ? ' active' : ''}`} title="Promotions">
          <LuGift size={18} />
          <span>Promotions</span>
        </Link>
      </div>
      <div className="side-label">Sports</div>
      <div className="side-section">
        {Object.entries(groups).map(([g, list]) => (
          <details key={g} className="side-group" open={list.some((s) => path === `/sport/${s.key}`)}>
            <summary className="side-item" title={g}>
              <SportIcon sportKey={list[0].key} />
              <span>{g}</span>
              <em>{list.reduce((a, s) => a + s.count, 0)}</em>
            </summary>
            {list.map((s) => (
              <Link key={s.key} to={`/sport/${s.key}`} className={`side-sub${path === `/sport/${s.key}` ? ' active' : ''}`}>
                <span className="ellipsis">{s.title}</span>
                <em>{s.count}</em>
              </Link>
            ))}
          </details>
        ))}
      </div>
      <div className="side-label">
        Wavy Originals <span className="new-pill">NEW</span>
      </div>
      <div className="side-section">
        <Link to="/casino" className={`side-item${path === '/casino' ? ' active' : ''}`} title="All Originals">
          <LuDices size={18} />
          <span>All games</span>
        </Link>
        {GAMES.map((g) => (
          <Link key={g.id} to={g.path} className={`side-sub casino-sub${path === g.path ? ' active' : ''}`}>
            <g.Icon size={15} />
            <span className="ellipsis">{g.name}</span>
          </Link>
        ))}
      </div>
      <div className="side-label">Help</div>
      <div className="side-section">
        <Link to="/responsible-gambling" className="side-item" title="Responsible gambling">
          <LuStar size={18} />
          <span>Responsible gambling</span>
        </Link>
        <button type="button" className="side-item" onClick={() => openChat('support')} title="Live support">
          <LuHeadphones size={18} />
          <span>Live support</span>
        </button>
        <button type="button" className="side-item" onClick={() => openChat('chat')} title="Community chat">
          <LuMessageCircle size={18} />
          <span>Community chat</span>
        </button>
      </div>
    </nav>
  );
}

/** Horizontal icon strip like the reference lobby */
export function SportStrip({ sports }: { sports: Sport[] }) {
  const { path } = useRouter();
  const groups = Array.from(new Map(sports.map((s) => [s.group, s])).values());
  return (
    <div className="sport-strip" role="navigation" aria-label="Sport shortcuts">
      <Link to="/" className={`strip-btn${path === '/' ? ' active' : ''}`} title="Home">
        <LuHouse size={20} />
      </Link>
      <Link to="/live" className={`strip-btn live${path === '/live' ? ' active' : ''}`} title="Live">
        <span className="live-tag">LIVE</span>
      </Link>
      <Link to="/bets" className={`strip-btn${path === '/bets' ? ' active' : ''}`} title="My bets">
        <LuTicket size={20} />
      </Link>
      <span className="strip-sep" />
      <Link to="/casino" className={`strip-btn strip-originals${path.startsWith('/casino') ? ' active' : ''}`} title="Wavy Originals">
        <LuDices size={19} />
        <span>Originals</span>
        <i>NEW</i>
      </Link>
      {groups.map((s) => (
        <Link key={s.group} to={`/group/${encodeURIComponent(s.group)}`} className={`strip-btn${path === `/group/${encodeURIComponent(s.group)}` ? ' active' : ''}`} title={s.group}>
          <SportIcon sportKey={s.key} size={21} />
        </Link>
      ))}
      <Link to="/search" className="strip-btn strip-search" title="Search">
        <LuSearch size={20} />
      </Link>
    </div>
  );
}

export function MobileNav() {
  const { path } = useRouter();
  const slip = useSlip();
  const { user, openAuth } = useAuth();
  return (
    <nav className="mobile-nav" aria-label="Main">
      <Link to="/" className={path === '/' ? 'on' : ''}>
        <LuHouse size={21} />
        <span>Sports</span>
      </Link>
      <Link to="/live" className={path === '/live' ? 'on' : ''}>
        <LuRadio size={21} />
        <span>Live</span>
      </Link>
      <button className={`mnav-slip${slip.open ? ' on' : ''}`} onClick={() => slip.setOpen(!slip.open)}>
        <span className="mnav-slip-icon">
          <LuTicket size={22} />
          {slip.picks.length > 0 && <i>{slip.picks.length}</i>}
        </span>
        <span>Betslip</span>
      </button>
      <Link to="/bets" className={path === '/bets' ? 'on' : ''}>
        <LuHistory size={21} />
        <span>My bets</span>
      </Link>
      {user ? (
        <Link to="/account" className={path === '/account' ? 'on' : ''}>
          <LuUser size={21} />
          <span>Account</span>
        </Link>
      ) : (
        <button onClick={() => openAuth('login')}>
          <LuUser size={21} />
          <span>Log in</span>
        </button>
      )}
    </nav>
  );
}

export function BackBar({ title }: { title: string }) {
  return (
    <div className="backbar">
      <button className="icon-btn" onClick={() => window.history.back()} aria-label="Back">
        <LuChevronLeft size={20} />
      </button>
      <h1>{title}</h1>
    </div>
  );
}
