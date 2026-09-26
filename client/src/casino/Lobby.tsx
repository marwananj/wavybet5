import { useRef } from 'react';
import { LuChevronLeft, LuChevronRight, LuShieldCheck, LuSparkles, LuZap, LuInfinity } from 'react-icons/lu';
import { Link } from '../lib/router';
import { BackBar } from '../components/Layout';
import { GamePoster, PosterGrid } from './Posters';
import { GAMES } from './meta';
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
      <PosterGrid />
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
