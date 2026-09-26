export interface User {
  id: string;
  email: string;
  username: string;
  role: 'USER' | 'ADMIN';
  balance: string;
  country: string;
  kycStatus: string;
  selfExcludedUntil: string | null;
  dailyDepositLimit: string | null;
  createdAt: string;
  emailVerified?: boolean;
  bonusWagerLeft?: string;
  firstDepositBonusClaimed?: boolean;
  hideInFeed?: boolean;
  oddsFormat?: 'decimal' | 'fractional' | 'american';
  tier?: string;
}

export interface Outcome {
  id: string;
  code: string;
  name: string;
  price: number;
  point: number | null;
  suspended?: boolean;
}
export interface Market {
  id: string;
  key: 'h2h' | 'totals' | string;
  suspended?: boolean;
  outcomes: Outcome[];
}
export interface SportEvent {
  id: string;
  sportKey: string;
  sportTitle: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  status: 'UPCOMING' | 'LIVE' | 'COMPLETED' | 'CANCELLED';
  homeScore: number | null;
  awayScore: number | null;
  featured: boolean;
  liveMinute?: number | null;
  bettingOpen?: boolean;
  lockReason?: 'blocked' | 'goal' | 'waiting' | null;
  /** total selections on the full book (lists only carry the 1X2) */
  marketCount?: number;
  htHome?: number | null;
  htAway?: number | null;
  cornersHome?: number | null;
  cornersAway?: number | null;
  markets: Market[];
}
export interface Sport {
  key: string;
  group: string;
  title: string;
  count: number;
}

export interface BetSel {
  id: string;
  eventId: string;
  marketKey: string;
  outcomeName: string;
  odds: string;
  status: BetStatus;
  eventLabel: string;
  sportTitle: string;
  commenceTime: string;
  /** paid early by the "2 goals ahead" rule */
  early?: boolean;
}
export type BetStatus = 'OPEN' | 'WON' | 'LOST' | 'VOID' | 'CASHOUT';
export interface Bet {
  id: string;
  type: 'SINGLE' | 'PARLAY' | 'BUILDER';
  stake: string;
  totalOdds: string;
  potentialPayout: string;
  payout: string | null;
  status: BetStatus;
  createdAt: string;
  settledAt: string | null;
  cashedOutAt?: string | null;
  insured?: boolean;
  insurancePaid?: string | null;
  selections: BetSel[];
}

export interface Tx {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'BET_STAKE' | 'BET_PAYOUT' | 'BET_REFUND' | 'ADJUSTMENT' | 'CASINO_BET' | 'CASINO_WIN' | 'BONUS';
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  amount: string;
  balanceAfter: string | null;
  cryptoCurrency: string | null;
  cryptoAmount: string | null;
  address: string | null;
  txHash: string | null;
  providerId: string | null;
  note: string | null;
  createdAt: string;
}

/** A pick held in the betslip */
export interface Pick {
  outcomeId: string;
  eventId: string;
  eventLabel: string;
  sportTitle: string;
  marketKey: string;
  outcomeName: string;
  odds: number;
  stake?: string;
  unavailable?: boolean;
  prevOdds?: number;
  live?: boolean;
}
