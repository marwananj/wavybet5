import type { IconType } from 'react-icons';
import {
  GiAmethyst, GiAnkh, GiCat, GiCherry, GiCobra, GiCrown, GiCrystalBall, GiCrystalCluster, GiCutDiamond, GiEgyptianSphinx, GiEmerald, GiEyeOfHorus, GiGrapes, GiLemon,
  GiLotusFlower, GiOrange, GiPharoah, GiPolarStar, GiRingingBell, GiRupee, GiScarabBeetle, GiTopaz, GiWatermelon,
} from 'react-icons/gi';
import type { CSSProperties } from 'react';

export interface SymDef {
  name: string;
  Icon?: IconType;
  text?: string;
  c1: string; // tile colours
  c2: string;
  ink: string; // icon colour
}

const WILD = (c1: string, c2: string): SymDef => ({ name: 'Wild', text: 'WILD', c1, c2, ink: '#fff' });

export interface Theme {
  id: string;
  name: string;
  tagline: string;
  symbols: SymDef[]; // 0–6 regular, 7 wild, 8 scatter
  cabinet: [string, string, string]; // frame, glow, background
  reelBg: string;
  bulbs: string;
}

export const THEMES: Record<string, Theme> = {
  'slot-fruits': {
    id: 'slot-fruits',
    name: 'Wavy Fruits',
    tagline: 'Classic fruit machine · 20 lines · free spins ×2',
    symbols: [
      { name: 'Cherry', Icon: GiCherry, c1: '#ff5d73', c2: '#8a0f24', ink: '#fff' },
      { name: 'Lemon', Icon: GiLemon, c1: '#ffe45c', c2: '#b88a00', ink: '#fff' },
      { name: 'Orange', Icon: GiOrange, c1: '#ffab4a', c2: '#a34700', ink: '#fff' },
      { name: 'Grapes', Icon: GiGrapes, c1: '#b57bff', c2: '#4b1591', ink: '#fff' },
      { name: 'Watermelon', Icon: GiWatermelon, c1: '#5ee38a', c2: '#136b33', ink: '#fff' },
      { name: 'Bell', Icon: GiRingingBell, c1: '#ffd84a', c2: '#9c6400', ink: '#fff7d1' },
      { name: 'Lucky 7', text: '7', c1: '#ff3b3b', c2: '#5e0000', ink: '#ffd84a' },
      WILD('#3ad0ff', '#0a3fb0'),
      { name: 'Star (scatter)', Icon: GiPolarStar, c1: '#ff4fd8', c2: '#6a0a74', ink: '#fff6a8' },
    ],
    cabinet: ['#e11d48', '#ff8fa3', '#2a0610'],
    reelBg: 'linear-gradient(180deg, #fff7ea, #ffe8c9)',
    bulbs: '#ffd84a',
  },
  'slot-gems': {
    id: 'slot-gems',
    name: 'Neon Gems',
    tagline: 'Glowing gems · 20 lines · free spins ×3',
    symbols: [
      { name: 'Amethyst', Icon: GiAmethyst, c1: '#a78bfa', c2: '#3b1c8c', ink: '#f3e8ff' },
      { name: 'Topaz', Icon: GiTopaz, c1: '#fbbf24', c2: '#7c4a03', ink: '#fffbeb' },
      { name: 'Emerald', Icon: GiEmerald, c1: '#34d399', c2: '#065f46', ink: '#ecfdf5' },
      { name: 'Rupee', Icon: GiRupee, c1: '#fb7185', c2: '#881337', ink: '#fff1f2' },
      { name: 'Diamond', Icon: GiCutDiamond, c1: '#67e8f9', c2: '#0e5f75', ink: '#ecfeff' },
      { name: 'Crystal', Icon: GiCrystalCluster, c1: '#c084fc', c2: '#1e3a8a', ink: '#fff' },
      { name: 'Crown', Icon: GiCrown, c1: '#fde047', c2: '#92400e', ink: '#fff' },
      WILD('#22d3ee', '#7c3aed'),
      { name: 'Crystal ball (scatter)', Icon: GiCrystalBall, c1: '#f0abfc', c2: '#581c87', ink: '#fff' },
    ],
    cabinet: ['#7c3aed', '#22d3ee', '#0b0620'],
    reelBg: 'radial-gradient(120% 90% at 50% 0%, #1d1147, #07041a)',
    bulbs: '#22d3ee',
  },
  'slot-pharaoh': {
    id: 'slot-pharaoh',
    name: "Pharaoh's Wave",
    tagline: 'Treasures of the Nile · 20 lines · free spins ×3',
    symbols: [
      { name: 'Lotus', Icon: GiLotusFlower, c1: '#60a5fa', c2: '#1e3a8a', ink: '#eff6ff' },
      { name: 'Cat', Icon: GiCat, c1: '#94a3b8', c2: '#1f2937', ink: '#fef3c7' },
      { name: 'Cobra', Icon: GiCobra, c1: '#4ade80', c2: '#14532d', ink: '#fefce8' },
      { name: 'Ankh', Icon: GiAnkh, c1: '#f59e0b', c2: '#78350f', ink: '#fff7ed' },
      { name: 'Eye of Horus', Icon: GiEyeOfHorus, c1: '#38bdf8', c2: '#0c4a6e', ink: '#fef9c3' },
      { name: 'Scarab', Icon: GiScarabBeetle, c1: '#2dd4bf', c2: '#134e4a', ink: '#fde68a' },
      { name: 'Pharaoh', Icon: GiPharoah, c1: '#fcd34d', c2: '#7c2d12', ink: '#1e3a8a' },
      WILD('#fbbf24', '#b45309'),
      { name: 'Sphinx (scatter)', Icon: GiEgyptianSphinx, c1: '#fb923c', c2: '#7f1d1d', ink: '#fff7ed' },
    ],
    cabinet: ['#d4a017', '#fde68a', '#1c1204'],
    reelBg: 'linear-gradient(180deg, #2a1e0a, #120b02)',
    bulbs: '#fde68a',
  },
};

/** a glossy 3D symbol tile */
export function SymbolTile({ theme, s, className = '', style }: { theme: Theme; s: number; className?: string; style?: CSSProperties }) {
  const d = theme.symbols[s];
  const kind = s === 7 ? 'wild' : s === 8 ? 'scatter' : s >= 5 ? 'high' : 'low';
  return (
    <div className={`sym sym-${kind} ${className}`} style={{ '--c1': d.c1, '--c2': d.c2, '--ink': d.ink, ...style } as CSSProperties} title={d.name}>
      <span className="sym-face">
        {d.Icon ? <d.Icon className="sym-icon" /> : <b className={`sym-text ${d.text === 'WILD' ? 'wild' : ''}`}>{d.text}</b>}
      </span>
    </div>
  );
}
