import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import './casino/casino.css';
import { RouterProvider, match, useRouter } from './lib/router';
import { AuthProvider, SlipProvider, ToastProvider } from './lib/state';
import { Header, MobileNav, openChat, Sidebar, useSports } from './components/Layout';
import { Betslip } from './components/Betslip';
import { AuthModal } from './components/AuthModal';
import { HomePage } from './pages/Home';
import { EventPage, LivePage, SearchPage, SportPage } from './pages/Sports';
import { BetsPage } from './pages/Bets';
import { WalletPage } from './pages/Wallet';
import { AccountPage, InfoPage } from './pages/Account';
import { AdminPage } from './pages/Admin';
import { CasinoLobby } from './casino/Lobby';
import { DiceGame } from './casino/games/Dice';
import { KenoGame } from './casino/games/Keno';
import { RpsGame } from './casino/games/Rps';
import { CoinFlipGame } from './casino/games/CoinFlip';
import { RouletteGame } from './casino/games/Roulette';
import { BlackjackGame } from './casino/games/Blackjack';
import { HiloGame } from './casino/games/HiLo';
import { ChickenGame } from './casino/games/Chicken';
import { WheelGame } from './casino/games/Wheel';
import { TowerGame } from './casino/games/Tower';
import { HoldemGame } from './casino/games/Holdem';
import { HorsesGame } from './casino/games/Horses';

const CASINO: Record<string, () => JSX.Element> = {
  dice: DiceGame,
  keno: KenoGame,
  rps: RpsGame,
  coinflip: CoinFlipGame,
  roulette: RouletteGame,
  blackjack: BlackjackGame,
  hilo: HiloGame,
  chicken: ChickenGame,
  wheel: WheelGame,
  tower: TowerGame,
  holdem: HoldemGame,
  horses: HorsesGame,
};
import { Empty } from './components/ui';
import { Link } from './lib/router';
import type { Sport } from './lib/types';
import { VerifyGate } from './components/VerifyGate';
import { SUPPORT_EMAIL } from './lib/site';
import { useAuth } from './lib/state';
import { ChatPanel } from './components/ChatPanel';
import { VipPage } from './pages/Vip';
import { TipsPage } from './pages/Tips';
import { PromotionsPage } from './pages/Promotions';

function Routes({ sports }: { sports: Sport[] }) {
  const { path } = useRouter();
  let m: Record<string, string> | null;
  if (path === '/') return <HomePage sports={sports} />;
  if (path === '/live') return <LivePage />;
  if (path === '/search') return <SearchPage />;
  if (path === '/bets') return <BetsPage />;
  if (path === '/wallet') return <WalletPage />;
  if (path === '/account') return <AccountPage />;
  if (path === '/admin') return <AdminPage />;
  if (path === '/casino') return <CasinoLobby />;
  if (path === '/vip') return <VipPage />;
  if (path === '/tips') return <TipsPage />;
  if (path === '/promotions') return <PromotionsPage />;
  if (path === '/terms') return <InfoPage kind="terms" />;
  if (path === '/responsible-gambling') return <InfoPage kind="responsible" />;
  if ((m = match('/sport/:key', path))) return <SportPage key={m.key} sportKey={m.key} sports={sports} />;
  if ((m = match('/group/:group', path))) return <SportPage key={m.group} group={m.group} sports={sports} />;
  if ((m = match('/event/:id', path))) return <EventPage key={m.id} id={m.id} />;
  if ((m = match('/casino/:game', path)) && CASINO[m.game]) {
    const G = CASINO[m.game];
    return <G key={m.game} />;
  }
  return <div className="page"><Empty title="Page not found" action={<Link to="/" className="btn btn-primary">Go home</Link>} /></div>;
}

function Shell() {
  const [collapsed, setCollapsed] = useState(false);
  const [chat, setChat] = useState<{ open: boolean; tab: 'chat' | 'support' }>({ open: false, tab: 'chat' });
  const sports = useSports();
  useEffect(() => {
    const h = (e: Event) => setChat({ open: true, tab: (e as CustomEvent<'chat' | 'support'>).detail });
    window.addEventListener('wb-chat', h);
    return () => window.removeEventListener('wb-chat', h);
  }, []);
  const { user } = useAuth();
  // players must confirm their e-mail code before they can enter the site
  if (user && user.emailVerified === false)
    return (
      <>
        <VerifyGate />
        <ChatPanel open={chat.open} initialTab="support" onClose={() => setChat((c) => ({ ...c, open: false }))} />
      </>
    );
  return (
    <div className={`app${collapsed ? ' side-collapsed' : ''}`}>
      <Header onMenu={() => setCollapsed((c) => !c)} />
      <Sidebar collapsed={collapsed} sports={sports} />
      <main className="main">
        <Routes sports={sports} />
        <footer className="site-foot">
          <div className="foot-badges">
            <span className="age">18+</span>
            <span>Play responsibly · Only bet what you can afford to lose</span>
          </div>
          <div className="foot-links">
            <Link to="/terms">Terms</Link>
            <Link to="/responsible-gambling">Responsible gambling</Link>
            <button type="button" className="link-btn" onClick={() => openChat('support')}>
              Live support
            </button>
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </div>
          <small>© {new Date().getFullYear()} WavyBet. Gambling can be addictive — set limits and bet only what you can afford to lose.</small>
        </footer>
      </main>
      <Betslip />
      <MobileNav />
      <AuthModal />
      <ChatPanel open={chat.open} initialTab={chat.tab} onClose={() => setChat((c) => ({ ...c, open: false }))} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <RouterProvider>
    <ToastProvider>
      <AuthProvider>
        <SlipProvider>
          <Shell />
        </SlipProvider>
      </AuthProvider>
    </ToastProvider>
  </RouterProvider>
);
