import 'dotenv/config';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing env var ${name}`);
  return v;
}
const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const list = (name: string, fallback = '') =>
  (process.env[name] ?? fallback).split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: num('PORT', 4000),
  clientUrl: req('CLIENT_URL', 'http://localhost:5173'),
  publicApiUrl: req('PUBLIC_API_URL', 'http://localhost:4000'),

  jwtAccessSecret: req('JWT_ACCESS_SECRET', process.env.NODE_ENV === 'production' ? undefined : 'dev-access-secret-change-me'),
  jwtRefreshDays: num('JWT_REFRESH_DAYS', 30),

  blockedCountries: list('BLOCKED_COUNTRIES', 'US,GB,FR,NL,ES,AU,CW,AN'),
  minAge: num('MIN_AGE', 18),

  // Betting limits
  minStake: num('MIN_STAKE', 0.5),
  maxStake: num('MAX_STAKE', 5000),
  maxPayout: num('MAX_PAYOUT', 50000),
  maxParlayLegs: num('MAX_PARLAY_LEGS', 15),
  houseMargin: num('HOUSE_MARGIN', 0.05),

  /** Which odds/results feed drives the book. */
  provider: (process.env.ODDS_PROVIDER ?? (process.env.APIFOOTBALL_KEY ? 'apifootball' : 'theoddsapi')) as 'apifootball' | 'theoddsapi',

  // API-Football (api-sports.io)
  afKey: process.env.APIFOOTBALL_KEY ?? '',
  afBase: process.env.APIFOOTBALL_BASE ?? 'https://v3.football.api-sports.io',
  // "auto" = every current competition with odds (popular first), capped at APIFOOTBALL_MAX_LEAGUES.
  // Or a comma-separated list of league IDs.
  afLeagues: list('APIFOOTBALL_LEAGUES', 'auto'),
  afMaxLeagues: num('APIFOOTBALL_MAX_LEAGUES', 120),
  /** Always included in auto mode (and ranked first), if they currently have odds. */
  afPriority: list(
    'APIFOOTBALL_PRIORITY',
    // national teams & continental
    '1,4,5,6,9,10,32,29,30,34,31,36,2,3,848,13,11,17,12,' +
      // big 5 + cups + second tiers
      '39,140,135,78,61,40,45,48,143,137,81,66,141,136,79,62,41,42,' +
      // rest of Europe
      '94,88,203,144,179,197,218,207,119,113,103,106,235,333,210,283,345,' +
      // Americas
      '253,71,128,262,239,265,268,' +
      // Middle East, Africa, Asia, Oceania
      '307,233,200,202,301,305,290,98,292,188,169'
  ),
  afDaysAhead: num('APIFOOTBALL_DAYS_AHEAD', 21),
  afOddsCron: process.env.APIFOOTBALL_ODDS_CRON ?? '*/30 * * * *',
  afScoresCron: process.env.APIFOOTBALL_SCORES_CRON ?? '*/2 * * * *',

  // Live in-play betting (API-Football /odds/live)
  liveBetting: (process.env.LIVE_BETTING ?? 'true') === 'true',
  liveOddsIntervalMs: num('LIVE_ODDS_INTERVAL_MS', 5000),
  /** Official live score + match minute refresh (fixtures feed) */
  liveScoreIntervalMs: num('LIVE_SCORE_INTERVAL_MS', 10000),
  liveStaleMs: num('LIVE_STALE_MS', 30000),
  liveGoalCooldownMs: num('LIVE_GOAL_COOLDOWN_MS', 45000),
  liveBetDelayMs: num('LIVE_BET_DELAY_MS', 5000),
  liveCutoffMinute: num('LIVE_CUTOFF_MINUTE', 89),
  liveMargin: num('LIVE_MARGIN', 0.06),
  /** Bet Builder margin on top of the modelled probability */
  builderMargin: num('BUILDER_MARGIN', 0.12),
  /** match tracker cache (ms) — one API call per watched live match per interval */
  trackerCacheMs: num('TRACKER_CACHE_MS', 15000),

  // The Odds API
  oddsApiKey: process.env.ODDS_API_KEY ?? '',
  oddsApiBase: process.env.ODDS_API_BASE ?? 'https://api.the-odds-api.com/v4',
  oddsRegions: process.env.ODDS_REGIONS ?? 'eu',
  oddsSports: list(
    'ODDS_SPORTS',
    'soccer_epl,soccer_spain_la_liga,soccer_italy_serie_a,soccer_uefa_champs_league,basketball_nba,mma_mixed_martial_arts'
  ),
  oddsSyncCron: process.env.ODDS_SYNC_CRON ?? '*/30 * * * *',
  scoresSyncCron: process.env.SCORES_SYNC_CRON ?? '*/10 * * * *',
  jobsEnabled: (process.env.JOBS_ENABLED ?? 'true') === 'true',

  /**
   * manual: deposits go to your own wallets (DEPOSIT_WALLET_*), you approve them in the admin panel.
   * nowpayments: automatic crypto gateway. Defaults to manual when no NOWPayments key is set.
   */
  paymentMode: (process.env.PAYMENT_MODE ?? (process.env.NOWPAYMENTS_API_KEY ? 'nowpayments' : 'manual')) as 'manual' | 'nowpayments',
  /** Secret code users must type to deposit or withdraw. Empty = not required. */
  paymentCode: process.env.PAYMENT_CODE ?? '',
  /** DEPOSIT_WALLET_BTC, DEPOSIT_WALLET_USDT_TRC20, … → { btc: addr, usdttrc20: addr } */
  manualWallets: Object.fromEntries(
    Object.entries(process.env)
      .filter(([k, v]) => k.startsWith('DEPOSIT_WALLET_') && !k.endsWith('_MEMO') && v && v.trim())
      .map(([k, v]) => [k.slice('DEPOSIT_WALLET_'.length).toLowerCase().replace(/_/g, ''), v!.trim()])
  ) as Record<string, string>,
  /** Optional memo/tag per coin: DEPOSIT_WALLET_XRP_MEMO=123456 */
  manualWalletMemos: Object.fromEntries(
    Object.entries(process.env)
      .filter(([k, v]) => k.startsWith('DEPOSIT_WALLET_') && k.endsWith('_MEMO') && v && v.trim())
      .map(([k, v]) => [k.slice('DEPOSIT_WALLET_'.length, -'_MEMO'.length).toLowerCase().replace(/_/g, ''), v!.trim()])
  ) as Record<string, string>,

  // Wavy Originals (casino)
  casinoEnabled: (process.env.CASINO_ENABLED ?? 'true') === 'true',
  casinoMinStake: num('CASINO_MIN_STAKE', 0.1),
  casinoMaxStake: num('CASINO_MAX_STAKE', 1000),
  casinoMaxPayout: num('CASINO_MAX_PAYOUT', 20000),

  // NOWPayments
  npApiKey: process.env.NOWPAYMENTS_API_KEY ?? '',
  npIpnSecret: process.env.NOWPAYMENTS_IPN_SECRET ?? '',
  npBase: process.env.NOWPAYMENTS_BASE_URL ?? 'https://api.nowpayments.io/v1',
  npEmail: process.env.NOWPAYMENTS_EMAIL ?? '',
  npPassword: process.env.NOWPAYMENTS_PASSWORD ?? '',
  np2faSecret: process.env.NOWPAYMENTS_2FA_SECRET ?? '',
  cryptoCurrencies: list('CRYPTO_CURRENCIES', 'btc,eth,usdttrc20,usdterc20,ltc,sol,trx'),
  minDeposit: num('MIN_DEPOSIT', 10),
  minWithdrawal: num('MIN_WITHDRAWAL', 20),
  withdrawalMode: (process.env.WITHDRAWAL_MODE ?? 'manual') as 'manual' | 'nowpayments',
};
