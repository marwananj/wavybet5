import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { usd } from '../lib/format';
import { recentGames, useFavs } from '../lib/favs';
import { LuChevronLeft, LuChevronRight, LuShieldCheck, LuSparkles, LuZap, LuInfinity, LuSearch, LuStar, LuHistory, LuTrophy } from 'react-icons/lu';
import { Link } from '../lib/router';
import { BackBar } from '../components/Layout';
import { GamePoster, PosterArt, PosterGrid } from './Posters';
import { GAMES, SLOTS } from './meta';
import { BetFeed } from '../components/BetFeed';

export function CasinoLobby() {
  return (
    <div className="page casino-page">
      <BackBar title="Wavy Originals" />
      <section className="orig-hero">
        <div className="orig-hero-glow" />
        <div className="orig-hero-dice" aria-hidden>
          <div className="cube">
            {[1, 2, 3, 4, 5, 6].map((f) => (
              <span key={f} className={`cf cf${f}`}>
                {Array.from({ length: f }).map((_, i) => (
                  <i key={i} />
                ))}
              </span>
            ))}
          </div>
        </div>
        <div className="orig-hero-text">
          <span className="hero-kicker">
            <LuSparkles size={13} /> NEW · {GAMES.length} GAMES
          </span>
          <h2>Wavy Originals</h2>
          <p>In-house casino games with instant results, a 1% house edge on most games, and provably fair outcomes you can verify yourself.</p>
          <div className="orig-badges">
            <span>
              <LuShieldCheck size={15} /> Provably fair
            </span>
            <span>
              <LuZap size={15} /> Instant payouts
            </span>
            <span>
              <LuInfinity size={15} /> Up to 99% RTP
            </span>
          </div>
        </div>
      </section>
      <SlotsShowcase />
      <LobbyGames />
      <BigWins />
      <BetFeed title="Live casino bets" />
    </div>
  );
}

/** Home page row: "Wavy Originals" with NEW posters. */
export function OriginalsRow() {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (d: number) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <section className="originals-row">
      <div className="section-head">
        <h3>
          <LuSparkles size={18} className="accent" /> Wavy Originals <span className="new-pill">NEW</span>
        </h3>
        <div className="carousel-arrows show">
          <Link to="/casino" className="btn btn-ghost btn-sm">
            View all
          </Link>
          <button className="icon-btn" onClick={() => scroll(-1)} aria-label="Previous">
            <LuChevronLeft size={18} />
          </button>
          <button className="icon-btn" onClick={() => scroll(1)} aria-label="Next">
            <LuChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="poster-row" ref={ref}>
        {GAMES.map((g) => (
          <GamePoster key={g.id} g={g} />
        ))}
      </div>
    </section>
  );
}

/** featured Wavy Slots row */
function SlotsShowcase() {
  return (
    <section className="slots-showcase">
      <div className="section-head">
        <h3>
          🎰 Wavy Slots <span className="new-pill">NEW</span>
        </h3>
        <small className="muted">Original 3D slot machines · free spins · up to 5000×</small>
      </div>
      <div className="slots-cards">
        {SLOTS.map((g) => (
          <Link key={g.id} to={g.path} className="slot-card" style={{ ['--c1' as string]: g.c1, ['--c2' as string]: g.c2 }}>
            <span className="slot-card-art">
              <PosterArt id={g.id} />
            </span>
            <span className="slot-card-txt">
              <b>{g.name}</b>
              <small>{g.tag}</small>
              <em>{g.edge}</em>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

const CATS: { id: string; label: string; ids: string[] }[] = [
  { id: 'slots', label: 'Slots', ids: ['slot-fruits', 'slot-gems', 'slot-pharaoh'] },
  { id: 'tv', label: 'Wavy TV', ids: ['tv-dice', 'tv-war'] },
  { id: 'cards', label: 'Cards & tables', ids: ['blackjack', 'holdem', 'videopoker', 'hilo', 'roulette'] },
  { id: 'risk', label: 'Cash-out games', ids: ['bomb', 'tower', 'chicken', 'hilo'] },
  { id: 'instant', label: 'Instant', ids: ['plinko', 'dice', 'limbo', 'wheel', 'keno', 'coinflip', 'rps'] },
];

function LobbyGames() {
  const favs = useFavs('games');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'all' | 'fav' | 'recent' | string>('all');
  const recent = useMemo(() => recentGames(), []);
  const list = useMemo(() => {
    let g = GAMES;
    if (tab === 'fav') g = GAMES.filter((x) => favs.has(x.id));
    else if (tab === 'recent') g = recent.map((id) => GAMES.find((x) => x.id === id)).filter((x): x is (typeof GAMES)[number] => !!x);
    else if (tab !== 'all') g = GAMES.filter((x) => CATS.find((c) => c.id === tab)?.ids.includes(x.id));
    const s = q.trim().toLowerCase();
    if (s) g = g.filter((x) => x.name.toLowerCase().includes(s) || x.tag.toLowerCase().includes(s));
    return g;
  }, [q, tab, favs.list.join(','), recent]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="lobby-games">
      <div className="lobby-bar">
        <label className="lobby-search">
          <LuSearch size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${GAMES.length} games…`} />
        </label>
        <div className="lobby-tabs">
          <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
            All
          </button>
          <button className={tab === 'fav' ? 'on' : ''} onClick={() => setTab('fav')}>
            <LuStar size={13} /> Favourites{favs.list.length ? ` ${favs.list.length}` : ''}
          </button>
          <button className={tab === 'recent' ? 'on' : ''} onClick={() => setTab('recent')}>
            <LuHistory size={13} /> Recent
          </button>
          {CATS.map((c) => (
            <button key={c.id} className={tab === c.id ? 'on' : ''} onClick={() => setTab(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {list.length ? (
        <PosterGrid games={list} />
      ) : (
        <p className="lobby-empty">
          {tab === 'fav' ? 'Tap ☆ on any game to add it to your favourites.' : tab === 'recent' ? 'Games you play will show up here.' : 'No games match your search.'}
        </p>
      )}
    </section>
  );
}

interface Win {
  id: string;
  game: string;
  gameName: string;
  user: string;
  stake: number;
  payout: number;
  multiplier: number;
}
function BigWins() {
  const [d, setD] = useState<{ biggest: Win[]; luckiest: Win[] } | null>(null);
  const [tab, setTab] = useState<'biggest' | 'luckiest'>('biggest');
  useEffect(() => {
    const load = () => api<{ biggest: Win[]; luckiest: Win[] }>('/casino/bigwins').then(setD).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  const rows = d?.[tab] ?? [];
  if (d && !d.biggest.length) return null;
  return (
    <section className="bigwins">
      <div className="section-head">
        <h3>
          <LuTrophy size={18} className="accent" /> Today's top wins
        </h3>
        <div className="seg seg-sm">
          <button className={tab === 'biggest' ? 'on' : ''} onClick={() => setTab('biggest')}>
            Biggest
          </button>
          <button className={tab === 'luckiest' ? 'on' : ''} onClick={() => setTab('luckiest')}>
            Luckiest
          </button>
        </div>
      </div>
      <div className="bw-row">
        {rows.map((w, i) => {
          const g = GAMES.find((x) => x.id === w.game);
          return (
            <Link key={w.id} to={g?.path ?? '/casino'} className="bw-card" style={{ ['--c1' as string]: g?.c1 ?? '#3b82ff', ['--c2' as string]: g?.c2 ?? '#0a1a6b' }}>
              <span className="bw-rank">#{i + 1}</span>
              <span className="bw-ico">{g && <g.Icon size={22} />}</span>
              <b>{tab === 'biggest' ? usd(w.payout) : `${w.multiplier.toFixed(2)}×`}</b>
              <small>{tab === 'biggest' ? `${w.multiplier.toFixed(2)}×` : usd(w.payout)} · {w.gameName}</small>
              <em>{w.user}</em>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
