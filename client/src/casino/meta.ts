import type { IconType } from 'react-icons';
import { LuDices, LuCircleDot } from 'react-icons/lu';
import { GiRollingDices, GiCrossedSwords } from 'react-icons/gi';
import { GiBombingRun, GiRocket, GiCardJoker, GiDropletSplash, GiCherry, GiCutDiamond, GiPharoah } from 'react-icons/gi';
import { GiCardAceSpades, GiChicken, GiTwoCoins, GiCardRandom, GiPokerHand, GiCartwheel, GiStoneTower, GiHorseHead } from 'react-icons/gi';
import { FaHandScissors } from 'react-icons/fa';
import { MdGridOn } from 'react-icons/md';

export interface GameMeta {
  id: string;
  name: string;
  path: string;
  tag: string;
  c1: string;
  c2: string;
  edge: string;
  Icon: IconType;
}

export const SLOTS: GameMeta[] = [
  { id: 'slot-fruits', name: 'Wavy Fruits', path: '/casino/slot-fruits', tag: 'Classic 5×3 · 20 lines · free spins', c1: '#ff4d6d', c2: '#5a0a1f', edge: '96% RTP', Icon: GiCherry },
  { id: 'slot-gems', name: 'Neon Gems', path: '/casino/slot-gems', tag: 'Glowing gems · free spins ×3', c1: '#a855f7', c2: '#170a3d', edge: '96% RTP', Icon: GiCutDiamond },
  { id: 'slot-pharaoh', name: "Pharaoh's Wave", path: '/casino/slot-pharaoh', tag: 'High volatility · up to 5000×', c1: '#f59e0b', c2: '#3b1d02', edge: '96% RTP', Icon: GiPharoah },
];

export const TV: GameMeta[] = [
  { id: 'tv-dice', name: 'Dice Duel · TV', path: '/casino/tv-dice', tag: 'Live draw every 40s · red vs blue', c1: '#ef4444', c2: '#1e3a8a', edge: '96.7% RTP', Icon: GiRollingDices },
  { id: 'tv-war', name: 'Card War · TV', path: '/casino/tv-war', tag: 'Live draw every 40s · player vs dealer', c1: '#10b981', c2: '#064e3b', edge: '96% RTP', Icon: GiCrossedSwords },
];

export const GAMES: GameMeta[] = [
  ...SLOTS,
  ...TV,
  { id: 'plinko', name: 'Plinko', path: '/casino/plinko', tag: 'Drop the ball · up to 1,000×', c1: '#ec4899', c2: '#4a0a2e', edge: '99% RTP', Icon: GiDropletSplash },
  { id: 'bomb', name: 'Wavy Bomb', path: '/casino/bomb', tag: 'Cash out before the blast', c1: '#ff5a1f', c2: '#3a0d00', edge: '99% RTP', Icon: GiBombingRun },
  { id: 'limbo', name: 'Limbo', path: '/casino/limbo', tag: 'Pick a target · up to 1,000,000×', c1: '#14b8a6', c2: '#053b36', edge: '99% RTP', Icon: GiRocket },
  { id: 'videopoker', name: 'Video Poker', path: '/casino/videopoker', tag: 'Jacks or Better 9/6', c1: '#8b5cf6', c2: '#241054', edge: '99.5% RTP', Icon: GiCardJoker },
  { id: 'horses', name: 'Wavy Horse Racing', path: '/casino/horses', tag: 'Virtual races · live commentary', c1: '#22c55e', c2: '#0b3b1f', edge: '97% RTP', Icon: GiHorseHead },
  { id: 'wheel', name: 'Wheel', path: '/casino/wheel', tag: 'Spin up to 49.5×', c1: '#ff8a3d', c2: '#5c1a00', edge: '99% RTP', Icon: GiCartwheel },
  { id: 'holdem', name: "Casino Hold'em", path: '/casino/holdem', tag: 'Poker vs dealer · AA Bonus 7:1', c1: '#e11d48', c2: '#3d0716', edge: 'Ante 97.8% RTP', Icon: GiPokerHand },
  { id: 'tower', name: 'Tower', path: '/casino/tower', tag: 'Climb 9 floors · dodge skulls', c1: '#6366f1', c2: '#1a1650', edge: '99% RTP', Icon: GiStoneTower },
  { id: 'dice', name: 'Dice', path: '/casino/dice', tag: 'Roll over or under', c1: '#3b82ff', c2: '#0a1a6b', edge: '99% RTP', Icon: LuDices },
  { id: 'roulette', name: 'Roulette', path: '/casino/roulette', tag: 'European single zero', c1: '#ff4d6d', c2: '#5a0a1f', edge: '97.3% RTP', Icon: LuCircleDot },
  { id: 'blackjack', name: 'Blackjack', path: '/casino/blackjack', tag: 'Beat the dealer to 21', c1: '#16c79a', c2: '#063d33', edge: '99.4% RTP', Icon: GiCardAceSpades },
  { id: 'chicken', name: 'Chicken Road', path: '/casino/chicken', tag: 'Cross. Cash out. Repeat.', c1: '#ffb020', c2: '#6b3200', edge: '99% RTP', Icon: GiChicken },
  { id: 'keno', name: 'Keno', path: '/casino/keno', tag: 'Pick up to 10 numbers', c1: '#a855f7', c2: '#2e0a5c', edge: '99% RTP', Icon: MdGridOn },
  { id: 'hilo', name: 'HiLo', path: '/casino/hilo', tag: 'Higher or lower?', c1: '#22d3ee', c2: '#063a4d', edge: '99% RTP', Icon: GiCardRandom },
  { id: 'coinflip', name: 'Coin Flip', path: '/casino/coinflip', tag: 'Heads or tails · 1.98×', c1: '#f5c542', c2: '#5c4200', edge: '99% RTP', Icon: GiTwoCoins },
  { id: 'rps', name: 'Rock Paper Scissors', path: '/casino/rps', tag: 'Beat the house', c1: '#f472b6', c2: '#4d0a33', edge: '98.7% RTP', Icon: FaHandScissors },
];
