import type { IconType } from 'react-icons';
import { LuDices, LuCircleDot } from 'react-icons/lu';
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

export const GAMES: GameMeta[] = [
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
