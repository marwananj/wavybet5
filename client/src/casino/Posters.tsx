import { useRef, type CSSProperties, type MouseEvent } from 'react';
import { Link } from '../lib/router';
import { GAMES, type GameMeta } from './meta';

/* Original poster illustrations — pure SVG, no external art. */

const Defs = ({ id }: { id: string }) => (
  <defs>
    <linearGradient id={`${id}-g1`} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#fff" />
      <stop offset="1" stopColor="#cfd8ff" />
    </linearGradient>
    <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#ffe28a" />
      <stop offset=".5" stopColor="#f5b820" />
      <stop offset="1" stopColor="#b8780a" />
    </linearGradient>
    <filter id={`${id}-sh`} x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#000" floodOpacity=".45" />
    </filter>
  </defs>
);

function DiceArt() {
  const pip = (x: number, y: number) => <circle cx={x} cy={y} r="6.5" fill="#0b1a5c" />;
  return (
    <svg viewBox="0 0 200 200">
      <Defs id="dice" />
      <g filter="url(#dice-sh)">
        <g transform="translate(34 70) rotate(-16)">
          <rect width="78" height="78" rx="18" fill="url(#dice-g1)" />
          <path d="M8 6h62a10 10 0 0 1 10 10" stroke="#fff" strokeWidth="3" fill="none" opacity=".8" />
          {pip(20, 20)}
          {pip(58, 20)}
          {pip(39, 39)}
          {pip(20, 58)}
          {pip(58, 58)}
        </g>
        <g transform="translate(100 46) rotate(14)">
          <rect width="70" height="70" rx="16" fill="url(#dice-g1)" />
          {pip(18, 18)}
          {pip(52, 52)}
          {pip(35, 35)}
        </g>
      </g>
    </svg>
  );
}

function RouletteArt() {
  const segs = Array.from({ length: 18 }, (_, i) => {
    const a0 = (i / 18) * Math.PI * 2;
    const a1 = ((i + 1) / 18) * Math.PI * 2;
    const r = 70;
    const p = (a: number, rr: number) => `${100 + rr * Math.sin(a)} ${100 - rr * Math.cos(a)}`;
    return <path key={i} d={`M100 100 L${p(a0, r)} A${r} ${r} 0 0 1 ${p(a1, r)} Z`} fill={i === 0 ? '#16a34a' : i % 2 ? '#e11d48' : '#111827'} />;
  });
  return (
    <svg viewBox="0 0 200 200">
      <Defs id="rl" />
      <g filter="url(#rl-sh)">
        <circle cx="100" cy="100" r="84" fill="url(#rl-gold)" />
        <circle cx="100" cy="100" r="76" fill="#3b0a18" />
        {segs}
        <circle cx="100" cy="100" r="44" fill="#5a1024" />
        <circle cx="100" cy="100" r="36" fill="url(#rl-gold)" />
        <path d="M100 70v60M70 100h60" stroke="#7a4b00" strokeWidth="5" strokeLinecap="round" />
        <circle cx="100" cy="100" r="9" fill="#ffe28a" />
        <circle cx="146" cy="56" r="8" fill="#fff" />
      </g>
    </svg>
  );
}

function CardsArt({ id, cards }: { id: string; cards: [string, string, boolean][] }) {
  return (
    <svg viewBox="0 0 200 200">
      <Defs id={id} />
      <g filter={`url(#${id}-sh)`}>
        {cards.map(([rank, suit, red], i) => (
          <g key={i} transform={`translate(${56 - (cards.length - 2) * 22 + i * 34} ${46 + i * 6}) rotate(${-14 + i * 16} 40 56)`}>
            <rect width="80" height="112" rx="10" fill="#fff" />
            <text x="10" y="26" fontSize="22" fontWeight="800" fill={red ? '#e11d48' : '#0b1020'} fontFamily="Montserrat, sans-serif">
              {rank}
            </text>
            <text x="40" y="76" fontSize="42" textAnchor="middle" fill={red ? '#e11d48' : '#0b1020'}>
              {suit}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function ChickenArt() {
  return (
    <svg viewBox="0 0 200 200">
      <Defs id="ck" />
      <rect x="0" y="120" width="200" height="80" fill="#2b2f45" />
      <path d="M0 158h200" stroke="#ffd34d" strokeWidth="4" strokeDasharray="16 14" />
      <g filter="url(#ck-sh)">
        <ChickenSprite x={62} y={40} scale={1.25} />
      </g>
      <g>
        <ellipse cx="160" cy="168" rx="22" ry="8" fill="#555b77" />
        <text x="160" y="172" fontSize="10" fontWeight="800" textAnchor="middle" fill="#ffd34d" fontFamily="Montserrat, sans-serif">
          2.4×
        </text>
      </g>
    </svg>
  );
}

export function ChickenSprite({ x = 0, y = 0, scale = 1, dead = false }: { x?: number; y?: number; scale?: number; dead?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx="40" cy="58" rx="30" ry="26" fill={dead ? '#c9ccd6' : '#fff'} />
      <path d="M14 52c-10 2-12 14-4 18" fill={dead ? '#c9ccd6' : '#fff'} stroke="#e6e9f2" strokeWidth="2" />
      <circle cx="54" cy="34" r="16" fill={dead ? '#c9ccd6' : '#fff'} />
      <path d="M46 20c0-8 6-10 8-4 2-6 9-5 8 2 5-2 8 4 2 7z" fill="#ef3b3b" />
      <path d="M68 34l12 4-12 5z" fill="#ffb020" />
      <path d="M62 44c2 6-2 9-4 6" fill="#ef3b3b" />
      {dead ? (
        <path d="M54 29l6 6M60 29l-6 6" stroke="#1a1f36" strokeWidth="2.5" strokeLinecap="round" />
      ) : (
        <>
          <circle cx="58" cy="31" r="3.4" fill="#1a1f36" />
          <circle cx="59.2" cy="29.8" r="1.1" fill="#fff" />
        </>
      )}
      <path d="M30 62c8 6 18 6 24-2" stroke="#e6e9f2" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M34 82v10m-5 0h10M48 82v10m-5 0h10" stroke="#ffb020" strokeWidth="3.5" strokeLinecap="round" />
    </g>
  );
}

function KenoArt() {
  const hits = new Set([2, 6, 9, 13, 17]);
  return (
    <svg viewBox="0 0 200 200">
      <Defs id="kn" />
      <g filter="url(#kn-sh)" transform="translate(30 38)">
        {Array.from({ length: 20 }, (_, i) => {
          const x = (i % 5) * 29;
          const y = Math.floor(i / 5) * 32;
          const h = hits.has(i);
          return (
            <g key={i} transform={`translate(${x} ${y})`}>
              <rect width="25" height="28" rx="6" fill={h ? '#22e39a' : 'rgba(255,255,255,.14)'} />
              {h && <path d="M12.5 7l6 6-6 9-6-9z" fill="#063d2a" />}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function HiloArt() {
  return (
    <svg viewBox="0 0 200 200">
      <Defs id="hl" />
      <g filter="url(#hl-sh)">
        <g transform="translate(58 42)">
          <rect width="84" height="118" rx="11" fill="#fff" />
          <text x="11" y="28" fontSize="24" fontWeight="800" fill="#e11d48" fontFamily="Montserrat, sans-serif">
            7
          </text>
          <text x="42" y="82" fontSize="46" textAnchor="middle" fill="#e11d48">
            ♥
          </text>
        </g>
        <path d="M28 96l14-18 14 18z" fill="#22e39a" />
        <path d="M144 88l14 18 14-18z" fill="#ff5a7a" />
      </g>
    </svg>
  );
}

function CoinArt() {
  return (
    <svg viewBox="0 0 200 200">
      <Defs id="cn" />
      <g filter="url(#cn-sh)">
        <ellipse cx="100" cy="112" rx="66" ry="66" fill="#b8780a" />
        <circle cx="100" cy="104" r="66" fill="url(#cn-gold)" />
        <circle cx="100" cy="104" r="52" fill="none" stroke="#fff3c4" strokeWidth="3" opacity=".7" />
        <path d="M62 112c8-13 16-13 24 0s16 13 24 0 16-13 24-5" fill="none" stroke="#7a4b00" strokeWidth="9" strokeLinecap="round" />
        <path d="M62 94c8-13 16-13 24 0s16 13 24 0 16-13 24-5" fill="none" stroke="#fff6d6" strokeWidth="7" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function RpsArt() {
  return (
    <svg viewBox="0 0 200 200">
      <Defs id="rp" />
      <g filter="url(#rp-sh)" fontSize="52" textAnchor="middle">
        <circle cx="62" cy="78" r="36" fill="rgba(255,255,255,.16)" />
        <circle cx="138" cy="78" r="36" fill="rgba(255,255,255,.16)" />
        <circle cx="100" cy="142" r="36" fill="rgba(255,255,255,.16)" />
        <text x="62" y="96">✊</text>
        <text x="138" y="96">✋</text>
        <text x="100" y="160">✌️</text>
      </g>
    </svg>
  );
}

function WheelArt() {
  const cols = ['#ff3d6e', '#2b3260', '#16c79a', '#2b3260', '#ffd24a', '#2b3260', '#ff8a3d', '#2b3260', '#16c79a', '#2b3260', '#c9d3ff', '#2b3260'];
  const C = 100;
  const seg = 360 / cols.length;
  const pt = (d: number, r: number) => [C + r * Math.sin((d * Math.PI) / 180), 108 - r * Math.cos((d * Math.PI) / 180)];
  return (
    <svg viewBox="0 0 200 200">
      <Defs id="wh" />
      <g filter="url(#wh-sh)">
        <ellipse cx="100" cy="116" rx="70" ry="70" fill="#0b0f2a" />
        {cols.map((c, i) => {
          const [x0, y0] = pt(i * seg, 66);
          const [x1, y1] = pt((i + 1) * seg, 66);
          const [x2, y2] = pt((i + 1) * seg, 36);
          const [x3, y3] = pt(i * seg, 36);
          return <path key={i} d={`M${x0} ${y0} A66 66 0 0 1 ${x1} ${y1} L${x2} ${y2} A36 36 0 0 0 ${x3} ${y3}Z`} fill={c} stroke="#0b0f2a" strokeWidth="2" />;
        })}
        <circle cx="100" cy="108" r="36" fill="#141a44" />
        <text x="100" y="116" textAnchor="middle" fontSize="20" fontWeight="900" fill="#fff" fontFamily="Montserrat, sans-serif">
          49×
        </text>
        <path d="M100 52 l-10 -20 h20z" fill="#fff" />
      </g>
    </svg>
  );
}

function TowerArt() {
  const rows = [0, 1, 2, 3];
  return (
    <svg viewBox="0 0 200 200">
      <Defs id="tw" />
      <g filter="url(#tw-sh)">
        <path d="M52 40 L100 12 L148 40Z" fill="url(#tw-gold)" />
        {rows.map((r) =>
          [0, 1, 2].map((c) => {
            const bomb = (r === 1 && c === 2) || (r === 3 && c === 0);
            const lit = r === 0 ? c !== 1 : false;
            return (
              <g key={`${r}${c}`} transform={`translate(${52 + c * 34} ${46 + r * 36})`}>
                <rect width="30" height="30" rx="7" fill={bomb ? '#3b1030' : lit ? '#1b8fd6' : 'rgba(255,255,255,.18)'} />
                <rect width="30" height="6" y="24" rx="3" fill="rgba(0,0,0,.25)" />
                {lit && <path d="M8 10h14l5 6-12 11L3 16z" fill="#8ce6ff" />}
                {bomb && <circle cx="15" cy="15" r="8" fill="#f1f3ff" />}
              </g>
            );
          })
        )}
      </g>
    </svg>
  );
}

function HorseArt() {
  return (
    <svg viewBox="0 0 200 200">
      <Defs id="hr" />
      <g filter="url(#hr-sh)">
        <path d="M0 150 Q100 120 200 150 L200 200 L0 200Z" fill="rgba(0,0,0,.18)" />
        <g transform="translate(18 44) scale(1.02)">
          <path d="M38 54 C 46 40, 96 36, 114 44 C 126 49, 128 64, 118 72 C 102 81, 60 83, 44 76 C 33 71, 31 61, 38 54 Z" fill="#6b3d22" />
          <path d="M106 50 C 114 36, 120 25, 131 18 L 142 25 C 136 34, 130 46, 122 62 Z" fill="#6b3d22" />
          <path d="M129 16 C 135 10, 146 11, 156 22 C 161 28, 158 34, 151 34 C 144 33, 137 31, 132 30 Z" fill="#6b3d22" />
          <path d="M110 44 C 116 32, 122 24, 131 17 L 128 24 C 122 30, 117 38, 113 48Z" fill="#1f130b" />
          <path d="M40 56 C 26 54, 16 64, 10 84 C 20 78, 30 72, 42 66 Z" fill="#1f130b" />
          <path d="M108 70 l14 22 l-4 18 M112 70 l-10 20 l10 18 M48 72 l-18 18 l-2 20 M52 72 l10 20 l-6 18" stroke="#6b3d22" strokeWidth="8" strokeLinecap="round" fill="none" />
          <path d="M66 44 L 96 42 L 98 62 L 64 64 Z" fill="#e11d48" />
          <text x="81" y="57" textAnchor="middle" fontSize="13" fontWeight="900" fill="#fff" fontFamily="Montserrat, sans-serif">1</text>
          <path d="M70 22 C 76 14, 94 14, 102 22 L 100 34 C 92 38, 80 40, 72 38 Z" fill="#facc15" />
          <path d="M70 26 H102 M72 32 H100" stroke="#2563eb" strokeWidth="4" />
          <circle cx="104" cy="15" r="6.5" fill="#f1c9a5" />
          <path d="M97 13 C 97 5, 112 5, 112 13 L 115 14 L 97 15Z" fill="#2563eb" />
        </g>
      </g>
    </svg>
  );
}

const ART: Record<string, () => JSX.Element> = {
  dice: DiceArt,
  roulette: RouletteArt,
  blackjack: () => <CardsArt id="bj" cards={[['A', '♠', false], ['K', '♥', true]]} />,
  chicken: ChickenArt,
  keno: KenoArt,
  hilo: HiloArt,
  coinflip: CoinArt,
  rps: RpsArt,
  wheel: WheelArt,
  tower: TowerArt,
  horses: HorseArt,
  holdem: () => <CardsArt id="he" cards={[['A', '♦', true], ['A', '♣', false], ['K', '♦', true]]} />,
};

export function GamePoster({ g, isNew = true }: { g: GameMeta; isNew?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const Art = ART[g.id];
  const move = (e: MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--ry', `${x * 16}deg`);
    el.style.setProperty('--rx', `${-y * 16}deg`);
    el.style.setProperty('--mx', `${(x + 0.5) * 100}%`);
    el.style.setProperty('--my', `${(y + 0.5) * 100}%`);
  };
  const leave = () => {
    ref.current?.style.setProperty('--rx', '0deg');
    ref.current?.style.setProperty('--ry', '0deg');
  };
  return (
    <Link to={g.path} className="poster-link" title={g.name}>
      <span ref={ref} className="poster" style={{ '--c1': g.c1, '--c2': g.c2 } as CSSProperties} onMouseMove={move} onMouseLeave={leave}>
        <span className="poster-bg" />
        <span className="poster-waves" aria-hidden>
          <svg viewBox="0 0 200 60" preserveAspectRatio="none">
            <path d="M0 30 C40 5 60 55 100 30 S160 5 200 30 V60 H0Z" />
          </svg>
        </span>
        <span className="poster-art">
          <Art />
        </span>
        {isNew && <span className="poster-new">NEW</span>}
        <span className="poster-meta">
          <small>WAVY ORIGINALS</small>
          <b>{g.name}</b>
        </span>
        <span className="poster-shine" />
      </span>
    </Link>
  );
}

export function PosterGrid() {
  return (
    <div className="poster-grid">
      {GAMES.map((g) => (
        <GamePoster key={g.id} g={g} />
      ))}
    </div>
  );
}
