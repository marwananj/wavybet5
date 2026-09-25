import { useEffect, useMemo, useRef, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuFlame, LuRadio, LuClock, LuZap } from 'react-icons/lu';
import { api } from '../lib/api';
import { mergeEvents, useLiveUpdates } from '../lib/live';
import { Link, useRouter } from '../lib/router';
import { useAuth } from '../lib/state';
import type { Sport, SportEvent } from '../lib/types';
import { EventCard, FeaturedCard } from '../components/EventCard';
import { SportStrip } from '../components/Layout';
import { OriginalsRow } from '../casino/Lobby';
import { Empty, Skeleton, SportIcon } from '../components/ui';

const SLIDES: { kicker: string; title: string; text: string; cta: string; to: string; tone: string; open?: boolean }[] = [
  {
    kicker: 'NEW · WAVY ORIGINALS',
    title: 'Casino games, made by us',
    text: 'Dice, Roulette, Blackjack, Chicken Road, Keno, HiLo, Coin Flip and RPS — provably fair with up to 99% RTP.',
    cta: 'Play Originals',
    to: '/casino',
    tone: 'violet',
    open: true,
  },
  {
    kicker: 'CRYPTO SPORTSBOOK',
    title: 'Bet on the wave',
    text: 'Deposit with BTC, ETH, USDT and more. Credited automatically after network confirmation.',
    cta: 'Deposit now',
    to: '/wallet',
    tone: 'blue',
  },
  {
    kicker: 'PARLAYS',
    title: 'Stack up to 15 legs',
    text: 'Combine picks across soccer, basketball, tennis and MMA into a single high-odds ticket.',
    cta: 'Build a parlay',
    to: '/group/Soccer',
    tone: 'violet',
  },
  {
    kicker: 'FAST PAYOUTS',
    title: 'Winnings straight to your wallet',
    text: 'Bets settle automatically from official results. Withdraw to any supported coin.',
    cta: 'See how it works',
    to: '/responsible-gambling',
    tone: 'teal',
  },
];

function Hero() {
  const [i, setI] = useState(0);
  const { user, openAuth } = useAuth();
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % SLIDES.length), 6000);
    return () => clearInterval(t);
  }, []);
  const s = SLIDES[i];
  return (
    <section className={`hero hero-${s.tone}`}>
      <div className="hero-waves" aria-hidden>
        <svg viewBox="0 0 600 200" preserveAspectRatio="none">
          <path d="M0 120 C100 60 200 180 300 120 S500 60 600 120 V200 H0Z" />
          <path d="M0 150 C100 90 200 210 300 150 S500 90 600 150 V200 H0Z" />
          <path d="M0 175 C120 130 220 215 330 175 S520 130 600 170 V200 H0Z" />
        </svg>
      </div>
      <div className="hero-content" key={i}>
        <span className="hero-kicker">{s.kicker}</span>
        <h2>{s.title}</h2>
        <p>{s.text}</p>
        {user || s.open ? (
          <Link to={s.to} className="btn btn-white">
            {s.cta}
          </Link>
        ) : (
          <button className="btn btn-white" onClick={() => openAuth('register')}>
            Join WavyBet
          </button>
        )}
      </div>
      <div className="hero-dots">
        {SLIDES.map((_, k) => (
          <button key={k} className={k === i ? 'on' : ''} onClick={() => setI(k)} aria-label={`Slide ${k + 1}`} />
        ))}
      </div>
    </section>
  );
}

function Carousel({ events }: { events: SportEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (d: number) => ref.current?.scrollBy({ left: d * (ref.current.clientWidth * 0.8), behavior: 'smooth' });
  return (
    <section className="carousel-wrap">
      <div className="section-head">
        <h3>
          <LuFlame size={18} className="accent" /> Top matches
        </h3>
        <div className="carousel-arrows">
          <button className="icon-btn" onClick={() => scroll(-1)} aria-label="Previous">
            <LuChevronLeft size={18} />
          </button>
          <button className="icon-btn" onClick={() => scroll(1)} aria-label="Next">
            <LuChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="carousel" ref={ref}>
        {events.map((e) => (
          <FeaturedCard key={e.id} ev={e} />
        ))}
      </div>
    </section>
  );
}

export function HomePage({ sports }: { sports: Sport[] }) {
  const { search, navigate } = useRouter();
  const tab = (search.get('tab') as 'popular' | 'live' | 'upcoming') ?? 'popular';
  const [featured, setFeatured] = useState<SportEvent[] | null>(null);
  const [events, setEvents] = useState<SportEvent[] | null>(null);
  const groups = useMemo(() => Array.from(new Map(sports.map((s) => [s.group, s])).values()), [sports]);
  const [group, setGroup] = useState<string>('');
  useLiveUpdates((incoming) => {
    setEvents((cur) => mergeEvents(cur, incoming, tab === 'live'));
    setFeatured((cur) => mergeEvents(cur, incoming));
  });

  useEffect(() => {
    api<{ events: SportEvent[] }>('/events/featured').then((d) => setFeatured(d.events)).catch(() => setFeatured([]));
  }, []);
  useEffect(() => {
    if (!group && groups.length) setGroup(groups[0].group);
  }, [groups, group]);
  useEffect(() => {
    setEvents(null);
    const status = tab === 'live' ? 'live' : 'upcoming';
    const qs = new URLSearchParams({ status, limit: '40', ...(group && tab !== 'live' ? { group } : {}) });
    const load = () =>
      api<{ events: SportEvent[] }>(`/events?${qs}`)
        .then((d) => setEvents(tab === 'live' ? [...d.events].sort((a, b) => Number(b.markets.length > 0) - Number(a.markets.length > 0)) : d.events))
        .catch(() => setEvents([]));
    load();
    const t = setInterval(load, tab === 'live' ? 20_000 : 60_000);
    return () => clearInterval(t);
  }, [tab, group]);

  return (
    <div className="page">
      <SportStrip sports={sports} />
      <div className="pill-tabs">
        {[
          ['popular', 'Popular', <LuFlame key="f" size={15} />],
          ['live', 'Live', <LuRadio key="l" size={15} />],
          ['upcoming', 'Upcoming', <LuClock key="u" size={15} />],
        ].map(([k, label, icon]) => (
          <button key={k as string} className={tab === k ? 'on' : ''} onClick={() => navigate(`/?tab=${k}`, true)}>
            {icon}
            {label}
          </button>
        ))}
      </div>

      {tab === 'popular' && <Hero />}
      {tab === 'popular' && <OriginalsRow />}
      {tab === 'popular' && (featured === null ? <div className="carousel"><Skeleton h={190} count={3} /></div> : featured.length > 0 && <Carousel events={featured} />)}

      {tab !== 'live' && (
        <div className="chips" role="tablist">
          {groups.map((s) => (
            <button key={s.group} className={`chip${group === s.group ? ' on' : ''}`} onClick={() => setGroup(s.group)}>
              <SportIcon sportKey={s.key} size={15} />
              {s.group}
            </button>
          ))}
        </div>
      )}

      <div className="grid-events">
        {events === null ? (
          <Skeleton h={170} count={6} />
        ) : events.length === 0 ? (
          <Empty
            icon={tab === 'live' ? <LuRadio size={34} /> : <LuZap size={34} />}
            title={tab === 'live' ? 'No live matches right now' : 'No matches yet'}
            text={tab === 'live' ? 'Check back soon — games in play appear here with live scores and in-play odds.' : 'Odds sync runs every few minutes. Enable more sports in the admin panel.'}
          />
        ) : (
          events.map((e) => <EventCard key={e.id} ev={e} />)
        )}
      </div>
    </div>
  );
}
