import type { CSSProperties } from 'react';

export interface Silks {
  c1: string;
  c2: string;
  pattern: string;
}

/** saddle-cloth colours used on real race cards for numbers 1‥8 */
export const CLOTH = [
  { bg: '#e11d48', fg: '#fff' },
  { bg: '#f8fafc', fg: '#111' },
  { bg: '#2563eb', fg: '#fff' },
  { bg: '#facc15', fg: '#111' },
  { bg: '#16a34a', fg: '#fff' },
  { bg: '#111827', fg: '#facc15' },
  { bg: '#f97316', fg: '#111' },
  { bg: '#ec4899', fg: '#111' },
];
const COATS = ['#7b4a2a', '#a0522d', '#4a2c1a', '#8f8f97', '#2a2522', '#6b3d22', '#b8763f', '#3b2a20'];
const MANES = ['#1f130b', '#5e2f14', '#150c06', '#d8d8de', '#0e0c0b', '#2a170c', '#5a3312', '#120c08'];

/** Pattern fill for jockey silks (used by the sprite and the small silks icon). */
export function SilksPattern({ id, s }: { id: string; s: Silks }) {
  const { c1, c2, pattern } = s;
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="16" height="16">
      <rect width="16" height="16" fill={c1} />
      {pattern === 'hoops' && <rect y="5" width="16" height="6" fill={c2} />}
      {pattern === 'stripes' && <rect x="5" width="6" height="16" fill={c2} />}
      {pattern === 'chevron' && <path d="M0 4 L8 10 L16 4 L16 9 L8 15 L0 9Z" fill={c2} />}
      {pattern === 'sash' && <path d="M0 12 L12 0 L16 0 L16 4 L4 16 L0 16Z" fill={c2} />}
      {pattern === 'stars' && <path d="M8 3l1.4 3 3.3.3-2.5 2.2.8 3.2L8 10l-3 1.7.8-3.2-2.5-2.2 3.3-.3z" fill={c2} />}
      {pattern === 'halves' && <rect x="8" width="8" height="16" fill={c2} />}
      {pattern === 'diamonds' && <path d="M8 2 L13 8 L8 14 L3 8Z" fill={c2} />}
    </pattern>
  );
}

/** Small jersey + cap icon for the race card. */
export function SilksIcon({ s, uid }: { s: Silks; uid: string }) {
  const id = `si-${uid}`;
  return (
    <svg viewBox="0 0 40 40" className="silks-ico" aria-hidden>
      <defs>
        <SilksPattern id={id} s={s} />
      </defs>
      <path d="M12 10 L6 14 L3 24 L9 26 L11 20 L11 36 L29 36 L29 20 L31 26 L37 24 L34 14 L28 10 C26 13 14 13 12 10Z" fill={`url(#${id})`} stroke="rgba(0,0,0,.45)" strokeWidth="1" />
      <path d="M13 6 C13 1 27 1 27 6 L28 8 L12 8Z" fill={s.c2} stroke="rgba(0,0,0,.45)" strokeWidth="1" />
      <rect x="10" y="7.5" width="20" height="2.2" rx="1" fill={s.c1} />
    </svg>
  );
}

/**
 * Side-on galloping horse with jockey. Legs are separate groups rotated by CSS keyframes
 * (`.hs-gallop`), so each runner can gallop with its own phase and stride speed.
 */
export function HorseSprite({ no, silks, uid, running, style }: { no: number; silks: Silks; uid: string; running: boolean; style?: CSSProperties }) {
  const coat = COATS[(no * 5 + uid.length) % COATS.length];
  const mane = MANES[(no * 5 + uid.length) % MANES.length];
  const cloth = CLOTH[(no - 1) % 8];
  const pid = `hp-${uid}`;
  const shade = `hsh-${uid}`;
  const leg = (cls: string, x: number, y: number, far: boolean) => (
    <g className={`hleg ${cls}`} style={{ transformOrigin: `${x}px ${y}px` }}>
      <path d={`M${x - 5} ${y - 4} L${x + 5} ${y - 4} L${x + 3} ${y + 18} L${x - 3} ${y + 18}Z`} fill={far ? mane : coat} opacity={far ? 0.85 : 1} />
      <g className="hshin" style={{ transformOrigin: `${x}px ${y + 17}px` }}>
        <path d={`M${x - 2.6} ${y + 16} L${x + 2.6} ${y + 16} L${x + 2} ${y + 33} L${x - 2} ${y + 33}Z`} fill={far ? mane : coat} opacity={far ? 0.85 : 1} />
        <path d={`M${x - 3.2} ${y + 32} L${x + 4.5} ${y + 32} L${x + 4.5} ${y + 36} L${x - 3.2} ${y + 36}Z`} fill="#1a1410" />
      </g>
    </g>
  );
  return (
    <svg viewBox="0 0 170 130" className={`horse-svg ${running ? 'hs-gallop' : 'hs-idle'}`} style={style} aria-hidden>
      <defs>
        <SilksPattern id={pid} s={silks} />
        <linearGradient id={shade} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".22" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".35" />
        </linearGradient>
      </defs>
      <ellipse cx="85" cy="124" rx="52" ry="5" fill="rgba(0,0,0,.35)" className="hshadow" />
      <g className="hbody">
        {/* far legs */}
        {leg('lf far', 112, 74, true)}
        {leg('lb far', 52, 74, true)}
        {/* tail */}
        <path className="htail" d="M40 56 C 26 54, 16 64, 10 84 C 20 78, 30 72, 42 66 Z" fill={mane} />
        {/* body */}
        <path d="M38 54 C 46 40, 96 36, 114 44 C 126 49, 128 64, 118 72 C 102 81, 60 83, 44 76 C 33 71, 31 61, 38 54 Z" fill={coat} />
        <path d="M38 54 C 46 40, 96 36, 114 44 C 126 49, 128 64, 118 72 C 102 81, 60 83, 44 76 C 33 71, 31 61, 38 54 Z" fill={`url(#${shade})`} />
        {/* neck + head */}
        <path d="M106 50 C 114 36, 120 25, 131 18 L 142 25 C 136 34, 130 46, 122 62 Z" fill={coat} />
        <path d="M129 16 C 135 10, 146 11, 156 22 C 161 28, 158 34, 151 34 C 144 33, 137 31, 132 30 Z" fill={coat} />
        <path d="M131 14 L 134 5 L 138 13Z" fill={coat} />
        <path d="M110 44 C 116 32, 122 24, 131 17 L 128 24 C 122 30, 117 38, 113 48Z" fill={mane} />
        <circle cx="141" cy="20" r="1.8" fill="#0b0b0b" />
        <path d="M151 30 L 156 27" stroke="#111" strokeWidth="1.3" />
        {/* bridle + reins */}
        <path d="M136 16 L 142 30 M132 24 L 154 26" stroke="#2a1a10" strokeWidth="1.6" fill="none" />
        <path d="M150 28 C 132 36, 112 36, 100 40" stroke="#2a1a10" strokeWidth="1.3" fill="none" />
        {/* saddle cloth */}
        <path d="M66 44 L 96 42 L 98 62 L 64 64 Z" fill={cloth.bg} stroke="rgba(0,0,0,.3)" strokeWidth="1" />
        <text x="81" y="57" textAnchor="middle" fontSize="13" fontWeight="900" fill={cloth.fg} fontFamily="Montserrat, sans-serif">
          {no}
        </text>
        {/* jockey */}
        <g className="hjockey">
          <path d="M76 40 L 86 42 L 92 52 L 86 54 L 80 46Z" fill="#f4f4f5" />
          <path d="M86 52 L 94 52 L 93 58 L 86 57Z" fill="#111" />
          <path d="M70 22 C 76 14, 94 14, 102 22 L 100 34 C 92 38, 80 40, 72 38 Z" fill={`url(#${pid})`} stroke="rgba(0,0,0,.35)" strokeWidth="1" />
          <path d="M98 26 C 104 28, 108 32, 110 38" stroke={`url(#${pid})`} strokeWidth="5" strokeLinecap="round" fill="none" />
          <circle cx="111" cy="39" r="2.6" fill="#f1c9a5" />
          <circle cx="104" cy="15" r="6.5" fill="#f1c9a5" />
          <path d="M97 13 C 97 5, 112 5, 112 13 L 115 14 L 97 15Z" fill={silks.c2} stroke="rgba(0,0,0,.35)" strokeWidth=".8" />
          <path d="M106 16 L 111 17" stroke="#111" strokeWidth="1.4" />
        </g>
        {/* near legs */}
        {leg('lf near', 108, 72, false)}
        {leg('lb near', 48, 72, false)}
      </g>
    </svg>
  );
}

/** Starting stalls drawn in front of the field before the off. */
export function Stalls({ open }: { open: boolean }) {
  return (
    <div className={`stalls ${open ? 'open' : ''}`} aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="stall" style={{ '--i': i } as CSSProperties}>
          <span className="stall-door" />
        </div>
      ))}
    </div>
  );
}
