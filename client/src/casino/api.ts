import { api } from '../lib/api';

export interface Fair {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  serverSeed: string | null;
}
export type RoundStatus = 'ACTIVE' | 'WON' | 'LOST' | 'PUSH' | 'CASHED';
export interface Round<V = any> {
  id: string;
  game: string;
  stake: string;
  payout: string;
  multiplier: number;
  status: RoundStatus;
  createdAt: string;
  finishedAt: string | null;
  fair: Fair;
  view?: V;
}
export interface PlayRes<R> {
  round: Round<R>;
  result: R;
  balance: string;
}
export interface StateRes<V> {
  round: Round<V>;
  balance: string;
}
export interface CasinoConfig {
  enabled: boolean;
  minStake: number;
  maxStake: number;
  maxPayout: number;
  keno: { tables: Record<string, Record<string, number[]>> };
  rps: { win: number };
  coinflip: { win: number };
  roulette: { order: number[] };
  chicken: Record<string, { lanes: number; death: number; ladder: number[] }>;
  wheel: { tables: Record<string, Record<string, number[]>> };
  tower: { floors: number; levels: Record<string, { tiles: number; safe: number; ladder: number[] }> };
  holdem: { hands: string[]; ante: number[]; aa: number[] };
}

export const casino = {
  play: <R>(game: string, body: object) => api<PlayRes<R>>(`/casino/play/${game}`, { body }),
  start: <V>(game: string, body: object) => api<StateRes<V>>(`/casino/${game}/start`, { body }),
  act: <V>(game: string, id: string, action: string, body: object = {}) => api<StateRes<V>>(`/casino/${game}/${id}/${action}`, { body }),
  active: <V>(game: string) => api<{ round: Round<V> | null }>(`/casino/${game}/active`),
  rounds: (game: string) => api<{ rounds: Round[] }>(`/casino/rounds?game=${game}&limit=15`),
  horseCard: <C>() => api<{ card: C; rtp: number }>('/casino/horses/card'),
  fair: () => api<Fair & { previous: (Fair & { serverSeed: string }) | null }>('/casino/fair'),
  rotate: (clientSeed?: string) => api<{ previous: Fair; current: Fair }>('/casino/fair/rotate', { body: { clientSeed } }),
};

let cfg: Promise<CasinoConfig> | null = null;
export const loadCasinoConfig = () => (cfg ??= api<CasinoConfig>('/casino/config').catch((e) => ((cfg = null), Promise.reject(e))));

export const mult = (m: number) => `${m.toFixed(2)}×`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['♠', '♥', '♦', '♣'];
export interface Card {
  rank: number;
  suit: number;
}
