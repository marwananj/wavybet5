import { useMemo } from 'react';
import { color, ORDER, SECTION_NUMBERS } from '../rouletteBets';

/**
 * French racetrack: the wheel's numbers laid around a stadium, with the classic
 * Tiers / Orphelins / Voisins / Zéro sections in the middle.
 * Tap a number = that number plus N neighbours either side; tap a section = its standard chip pattern.
 * Geometry is built in a horizontal frame and rotated for the tall (phone) version.
 */
type Pt = [number, number];

/** stadium geometry in a horizontal frame (the tall version is built wider-band and rotated) */
function geometry(W: number, H: number, T: number) {
  const R = H / 2;
  const A = (W - H) / 2; // half straight
  const RC = R - T / 2; // centreline radius
  const L = 2 * A;
  const P = 2 * L + 2 * Math.PI * RC;
  const at = (s: number, d: number): Pt => {
    s = ((s % P) + P) % P;
    const r = RC + d;
    if (s < L) return [-A + s, -r];
    s -= L;
    if (s < Math.PI * RC) {
      const t = s / RC - Math.PI / 2;
      return [A + r * Math.cos(t), r * Math.sin(t)];
    }
    s -= Math.PI * RC;
    if (s < L) return [A - s, r];
    s -= L;
    const t = s / RC + Math.PI / 2;
    return [-A + r * Math.cos(t), r * Math.sin(t)];
  };
  const inner = RC - T / 2 - 4;
  const left = -A - inner;
  const right = A + inner;
  const cuts = [left, -A * 0.42, A * 0.12, A * 0.72, right];
  return {
    W, H, T, R, A, at, inner,
    CELL: P / 37,
    ZERO_S: L + (Math.PI * RC) / 2, // zero sits on the right-hand apex
    SECTIONS: [
      { id: 'tiers', label: 'TIER', x0: cuts[0], x1: cuts[1] },
      { id: 'orphelins', label: 'ORPHELINS', x0: cuts[1], x1: cuts[2] },
      { id: 'voisins', label: 'VOISINS', x0: cuts[2], x1: cuts[3] },
      { id: 'zero', label: 'ZERO', x0: cuts[3], x1: cuts[4] },
    ],
  };
}
const WIDE = geometry(760, 210, 46);
const TALL = geometry(600, 250, 50);

export function Racetrack({
  tall,
  count,
  hover,
  lucky,
  win,
  onNumber,
  onSection,
  onHover,
  chips,
}: {
  tall: boolean;
  count: number;
  hover: Set<number>;
  lucky: Map<number, number>;
  win: number | null;
  onNumber: (n: number) => void;
  onSection: (id: string) => void;
  onHover: (nums: number[] | null) => void;
  chips: Map<number, number>; // straight-up totals shown on the track
}) {
  const G = tall ? TALL : WIDE;
  const { W, H, T, R, A, at, CELL, ZERO_S, SECTIONS } = G;
  const map = (p: Pt): Pt => (tall ? [-p[1], p[0]] : p); // rotate 90° for phones
  const pts = (list: Pt[]) => list.map((p) => map(p).map((x) => x.toFixed(1)).join(',')).join(' ');
  const vb = tall ? `${-H / 2 - 4} ${-W / 2 - 4} ${H + 8} ${W + 8}` : `${-W / 2 - 4} ${-H / 2 - 4} ${W + 8} ${H + 8}`;

  const cells = useMemo(
    () =>
      ORDER.map((n, i) => {
        const s0 = ZERO_S + (i - 0.5) * CELL;
        const s1 = ZERO_S + (i + 0.5) * CELL;
        const outer: Pt[] = [];
        const inner: Pt[] = [];
        for (let j = 0; j <= 6; j++) {
          const s = s0 + ((s1 - s0) * j) / 6;
          outer.push(at(s, T / 2));
          inner.unshift(at(s, -T / 2));
        }
        return { n, poly: [...outer, ...inner], c: at(ZERO_S + i * CELL, 0) };
      }),
    [G] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const innerR = G.inner;

  return (
    <div className={`racetrack ${tall ? 'tall' : ''}`}>
      <svg viewBox={vb} className="rt-svg" onPointerLeave={() => onHover(null)}>
        <defs>
          <linearGradient id="rt-felt" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#123b6b" />
            <stop offset="1" stopColor="#0b2346" />
          </linearGradient>
        </defs>
        {/* inner field */}
        <path
          d={(() => {
            const a = map([-A, -innerR]);
            const b = map([A, -innerR]);
            const c = map([A, innerR]);
            const d = map([-A, innerR]);
            return `M${a} L${b} A${innerR} ${innerR} 0 0 1 ${c} L${d} A${innerR} ${innerR} 0 0 1 ${a} Z`;
          })()}
          fill="url(#rt-felt)"
          stroke="rgba(255,215,140,.35)"
          strokeWidth="1.5"
        />
        <clipPath id={`rt-clip-${tall ? 't' : 'w'}`}>
          <path
            d={(() => {
              const a = map([-A, -innerR]);
              const b = map([A, -innerR]);
              const c = map([A, innerR]);
              const d = map([-A, innerR]);
              return `M${a} L${b} A${innerR} ${innerR} 0 0 1 ${c} L${d} A${innerR} ${innerR} 0 0 1 ${a} Z`;
            })()}
          />
        </clipPath>
        <g clipPath={`url(#rt-clip-${tall ? 't' : 'w'})`}>
          {SECTIONS.map((sec) => {
            const nums = SECTION_NUMBERS[sec.id];
            const on = nums.some((n) => hover.has(n)) && nums.every((n) => hover.has(n));
            const c = map([(sec.x0 + sec.x1) / 2, 0]);
            return (
              <g
                key={sec.id}
                className={`rt-sec ${on ? 'on' : ''}`}
                onClick={() => onSection(sec.id)}
                onPointerEnter={() => onHover(nums)}
              >
                <polygon points={pts([[sec.x0, -R], [sec.x1, -R], [sec.x1, R], [sec.x0, R]])} />
                <text x={c[0]} y={c[1]} textAnchor="middle" dominantBaseline="central">
                  {sec.label}
                </text>
              </g>
            );
          })}
        </g>
        {cells.map(({ n, poly, c }) => {
          const [cx, cy] = map(c);
          const amt = chips.get(n);
          return (
            <g
              key={n}
              data-n={n}
              className={`rt-cell ${color(n)} ${hover.has(n) ? 'hl' : ''} ${win === n ? 'win' : ''} ${lucky.has(n) ? 'lucky' : ''}`}
              onClick={() => onNumber(n)}
              onPointerEnter={() => {
                const i = ORDER.indexOf(n);
                onHover(Array.from({ length: count * 2 + 1 }, (_, j) => ORDER[(i - count + j + 74) % 37]));
              }}
            >
              <polygon points={pts(poly)} />
              {amt ? <circle cx={cx} cy={cy} r="12.5" className="rt-chip" /> : null}
              <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
                {n}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
