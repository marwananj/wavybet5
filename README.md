# WavyBet — crypto sportsbook

Full-stack sportsbook: real accounts, crypto deposits and withdrawals, real matches and odds, singles and parlays, automatic settlement, and an admin panel. Dark, mobile-first UI.

```
wavybet/
├── server/   Node + Express + TypeScript + Prisma (PostgreSQL)
├── client/   React + Vite + TypeScript, hand-written CSS
├── Dockerfile            one image that serves API + site on :4000
└── docker-compose.yml    app + Postgres
```

## What's inside

| Area | How it works |
|---|---|
| **Auth** | Email/username + bcrypt passwords. 15-min JWT access token + rotating httpOnly refresh cookie (reuse of a revoked token kills every session). 18+ check on date of birth, country block list, Cloudflare `cf-ipcountry` geo-block, rate-limited login/register. |
| **Wallet** | Double-entry style ledger (`Transaction` table, signed amounts, `balanceAfter`). Debits use a conditional `UPDATE … WHERE balance >= x`, so balances can never go negative even under concurrent requests. |
| **Deposits** | NOWPayments: user picks coin + USD amount → gets address, exact crypto amount and QR. The IPN webhook is HMAC-SHA512 verified and credits the balance exactly once (idempotent). Partial payments credit proportionally. The status page also polls NOWPayments, so a missed webhook self-heals. |
| **Withdrawals** | User request locks the funds immediately. Admin approves (manual mode: paste your tx hash; NOWPayments mode: payout is sent via API, with optional automatic 2FA) or rejects (auto-refund). Users can cancel before approval. |
| **Odds** | The Odds API: 1X2/moneyline + main totals line. Price = median across bookmakers minus your `HOUSE_MARGIN`. Pre-match only; markets suspend at kick-off. |
| **Betting** | Singles and parlays (up to 15 legs, no same-match legs). Server re-validates every price, rejects started events, enforces min/max stake and max payout. Odds-change policy: accept higher / any / ask. |
| **Settlement** | Scores job marks events live → completed and grades every open selection (1X2, over/under with push = void, two-way tie = void), then pays out. Admins can manually settle or void any match or bet. |
| **History** | My bets: Open / Won / Lost / Settled / All with P&L stats. Wallet history with filters. |
| **Responsible gambling** | Daily deposit limit (24h cool-off to raise), self-exclusion 24h–1 year, RG and terms pages. |
| **Admin** | Dashboard (deposits, withdrawals, GGR, liability, player balances, API quota), withdrawal queue, users (ban, KYC status, balance adjustments), events (feature, settle, void), sports toggles, manual sync. |

## Odds feed: API-Football (default)

Set `APIFOOTBALL_KEY` and the site uses API-Football for soccer: fixtures, team logos, pre-match odds (1X2, Over/Under, Both Teams to Score, Double Chance) and results. Prices are the median across bookmakers minus `HOUSE_MARGIN`. Bets settle on the 90-minute score; cancelled/abandoned matches (and postponed ones with no new date after 48h) are voided and stakes refunded.

Leagues: `APIFOOTBALL_LEAGUES=auto` picks every current competition with odds (popular ones first) up to `APIFOOTBALL_MAX_LEAGUES` (default 120). Expected use at 120 leagues: roughly 25,000–30,000 requests/day including live odds, inside the Ultra plan’s 75,000/day. Admin → Dashboard → **Check API key** shows the plan and today's usage. To add a league, find its ID on the API-Football dashboard and add it to `APIFOOTBALL_LEAGUES`.

## Manual payments (default)

With `PAYMENT_MODE=manual` no payment provider is needed:

- **Deposits** — set `DEPOSIT_WALLET_*` to your own addresses (e.g. `DEPOSIT_WALLET_USDT_TRC20`). Users pick a coin, see your address and QR, send the crypto, then submit the amount and TXID. You check the TXID (the admin table links to the block explorer) and approve in **Admin → Deposits**; the balance is credited instantly. You can correct the amount when approving.
- **Withdrawals** — the stake is locked when requested; you send the crypto yourself and paste the tx hash in **Admin → Withdrawals**, or reject to refund.
- **Secret code** — if `PAYMENT_CODE` is set, users must enter it to deposit or withdraw. Five wrong tries lock the user out for 15 minutes.

Switch to automatic crypto processing later with `PAYMENT_MODE=nowpayments` and the NOWPayments keys.

## Sportsbook markets

Pre-match and in-play (API-Football), each only when the feed prices it:
1X2 (with **2UP early payout**), Double chance, Total goals (several lines), Both teams to score,
1st-half result, 1st-half goals, Correct score, Total corners, Most corners — plus **Bet Builder** (same-match combos, pre-match).

- **Early payout (2UP):** pre-match 1X2 picks are settled as winners the moment the team goes 2 goals ahead (parlay legs are marked won). Not applied to Bet Builder.
- **Bet Builder pricing:** a Poisson goals model fitted to the match's own 1X2 + goal-line prices (45/55 half split) and a corners model fitted to the corners line; the joint probability of all legs is summed exactly, price = (1 − `BUILDER_MARGIN`) ÷ P. Any void leg voids the builder.
- **Settlement data:** half-time score and corner counts are stored on the event (from the fixtures feed / match statistics). Markets whose data never arrives are voided.
- **Match tracker:** `/api/events/:id/tracker` — goals, cards, subs, VAR and live stats from `/fixtures?id=`, cached `TRACKER_CACHE_MS` per match. The pitch states are derived from that data: *Dangerous attack* = the team that had a shot or corner in the last ~90 s, *Attack* = clear possession edge, otherwise *Ball safe*.
- **Admin → `/api/admin/feed-bet-types`** lists every bet name the odds feeds have sent and which market it maps to (useful if a bookmaker renames a market).

## Accounts, rewards & community

- **Email verification (EmailJS):** new players get a 6-digit code by email (15 min, 5 tries, resend after 60 s) and must verify before depositing, betting or playing. Set `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY` (Render env only — never in GitHub). In EmailJS: *Account → Security → allow API for non-browser applications*; template "To Email" = `{{to_email}}`, body uses `{{username}}`, `{{code}}`, `{{minutes}}`. Without keys, verification is skipped and codes are printed in the server log.
- **Limits:** `MAX_STAKE` / `CASINO_MAX_STAKE` (3000) and `MAX_PAYOUT` / `CASINO_MAX_PAYOUT` (200000).
- **VIP booster:** tiers Bronze → Wavy Elite by lifetime wager; every `WAGER_REWARD_STEP` ($5,000) wagered pays `WAGER_REWARD_AMOUNT` ($20) real balance, claimed on `/vip`.
- **First deposit gift:** `FIRST_DEPOSIT_BONUS` ($25) on the first deposit ≥ `FIRST_DEPOSIT_MIN`; withdrawals unlock after wagering `FIRST_DEPOSIT_WAGER_X` × the gift.
- **Cash out:** singles, parlays and builders with open legs; value from current prices minus `CASHOUT_MARGIN`, live delay applied, accepted if the value moved ≤ 2%.
- **Tips of the day:** `/tips` — strongest-rated picks from margin-free prices plus a 3-leg acca, refreshed every 30 min.
- **Bet feed, community chat & live support:** chat is rate-limited with link filter and admin mute/delete; support threads are answered from *Admin → Support*.

## Wavy Originals (casino)

Twelve in-house games at `/casino`, all on the same wallet and ledger (`CASINO_BET` / `CASINO_WIN` transactions):

| Game | Rules | RTP |
|---|---|---|
| Dice | Roll 0.00–99.99, over/under a target, multiplier = 99 / win chance | 99% |
| Keno | 40 numbers, 10 drawn, 1–10 picks, Easy / Medium / Hard / Expert paytables | ≈99% |
| Rock Paper Scissors | Win 1.96×, draw returns the stake | 98.7% |
| Coin Flip | 50/50, pays 1.98× | 99% |
| Roulette | European single zero. Live-style 3D wheel, full table with splits, streets, corners, six lines and first four, plus a French racetrack (neighbours ±1–5, Voisins, Tiers, Orphelins, Jeu zéro). **Thunder** table: 1–5 lucky numbers struck each round at 50×–500×, straight-ups otherwise 29:1 | 97.3% (Thunder straight-up 97.33%) |
| Blackjack | Infinite deck, 3:2, dealer stands on 17, double any two, one split, dealer peeks | ≈99.4% |
| HiLo | Higher/lower on the next card, 1% edge per guess, cash out any time | 99% per guess |
| Chicken Road | Cross lanes (Easy 24 … Expert 15), multiplier 0.99/(1−p)^lanes, cash out any time | 99% |
| Wheel | 10–50 equal segments, Easy / Medium / Hard tables (Hard pays up to 49.5×) | 99% exactly |
| Casino Hold'em | Ante vs dealer, flop then Fold or Call 2×; dealer qualifies with 4s; Ante pays 100/20/10/3/2/1; AA Bonus side bet (hole + flop, pair of Aces or better, 7:1 … 100:1) | Ante ≈97.8% with optimal play, AA Bonus 93.7% |
| Wavy Horse Racing | Virtual 8-runner races (1200m) with a race card, live 3D-style race, spoken commentary. Win, Place (top 3), Forecast (exact 1-2) and Quinella (1-2 any order); every price is 0.97 ÷ true probability. The card comes from the public client seed + round number, the finishing order from the provably fair server seed (Plackett–Luce) | 97% |
| Tower | 9 floors, pick one tile per floor (Easy 3 of 4 safe … Expert 1 of 3), multiplier 0.99/p^floors, cash out any time | 99% |

RTPs were checked by simulating millions of rounds against the engine code in `server/src/casino/engine`. The Hold'em hand evaluator was verified against the exact counts of all 2,598,960 five-card hands, and the AA Bonus return was computed exactly (93.74%).

Every game has synthesized sound effects (Web Audio, no files) with a mute button in the game header; the choice is remembered per browser.

**Provably fair:** each round uses `HMAC_SHA256(serverSeed, "clientSeed:nonce:cursor")`. Players see the SHA-256 of their server seed, can set their own client seed, and changing seeds reveals the previous server seed (Fairness button in every game). Multi-step games (Blackjack, HiLo, Chicken, Tower, Hold'em) are fixed at the start of the round and stored server-side; concurrent requests are guarded with optimistic locking.

Limits: `CASINO_MIN_STAKE`, `CASINO_MAX_STAKE`, `CASINO_MAX_PAYOUT`; `CASINO_ENABLED=false` closes the casino. Self-excluded players can't play.

## Live in-play betting

With API-Football, matches in play get live odds (1X2, main Over/Under line, Both Teams to Score) refreshed every `LIVE_ODDS_INTERVAL_MS` (5 s) from `/odds/live`, and the official score and minute every `LIVE_SCORE_INTERVAL_MS` (10 s) from `/fixtures?live=all`. Every change is pushed instantly to open browsers over Server-Sent Events (`/api/live/stream`); the pages also poll slowly as a fallback. Markets suspend automatically when:

- the feed marks the match blocked/stopped (dangerous attack, penalty, VAR, injury), or a single price as suspended;
- a goal is detected — everything locks for `LIVE_GOAL_COOLDOWN_MS`;
- no fresh live data arrives for `LIVE_STALE_MS`;
- the match reaches `LIVE_CUTOFF_MINUTE`.

Live bets are held for `LIVE_BET_DELAY_MS`, then price and suspension are checked again before the stake is taken. Over/Under selections are tied to their line (e.g. `over_2.5`), so a pick can never silently move to a new line. Live bets settle exactly like pre-match bets, on the 90-minute result. The server log prints each live bet type the feed sends (`[live] bet type seen: …`), which helps if a market doesn't appear.

## 1. Accounts you need

1. **The Odds API** — https://the-odds-api.com → get an API key. The free tier (500 requests/month) is only enough for testing. Rough cost: each sport costs 2 requests per odds sync. With the defaults (6 sports, every 30 min) that's ~17k/month, so the **20K plan** fits; add sports or sync more often and you'll need the 100K plan.
2. **NOWPayments** — https://nowpayments.io → create an account, add your payout wallets, generate an **API key** and an **IPN secret** (Settings → Payments). Use the sandbox (`https://api-sandbox.nowpayments.io/v1`) while testing. Confirm with them that your gambling license is accepted.
3. **A server + domain** with HTTPS (Hetzner, DigitalOcean, etc.), ideally behind Cloudflare so geo-blocking works.

## 2. Run locally

```bash
# Postgres (or use your own)
docker run -d --name wavydb -e POSTGRES_USER=wavybet -e POSTGRES_PASSWORD=wavybet -e POSTGRES_DB=wavybet -p 5432:5432 postgres:16-alpine

# API
cd server
cp .env.example .env          # fill in ODDS_API_KEY, NOWPAYMENTS_*, JWT_ACCESS_SECRET, ADMIN_*
npm install
npx prisma db push            # creates the tables
npm run seed                  # creates your admin account
npm run dev                   # http://localhost:4000

# Site (new terminal)
cd client
npm install
npm run dev                   # http://localhost:5173 (proxies /api to :4000)
```

Log in with your admin account → avatar menu → **Admin panel** → *Sync sports* then *Sync odds*. Matches appear in the lobby.

To test deposits locally, NOWPayments must reach your webhook: run `npx localtunnel --port 4000` (or ngrok) and set `PUBLIC_API_URL` to that URL.

## 3. Deploy (Docker)

```bash
cp server/.env.example server/.env    # production values, NODE_ENV=production
docker compose up -d --build
```

The container creates/updates the schema, creates the admin from `ADMIN_*`, and serves the site and API on port 4000. Put Nginx/Caddy or Cloudflare in front for HTTPS. Set `CLIENT_URL` and `PUBLIC_API_URL` to your real domain (e.g. `https://wavybet.com`).

Once the schema is stable, switch from `db push` to migrations: `npx prisma migrate dev --name init` locally, commit `prisma/migrations`, and use `npm run db:migrate` in production.

## 4. Before taking real money

- **License**: put your Curaçao/Anjouan license number in the footer (`client/src/main.tsx`) and replace the terms page with your lawyer-approved terms. Set `BLOCKED_COUNTRIES` to exactly what your license requires.
- **KYC**: the `kycStatus` field and admin controls are in place; connect a provider (Sumsub, Veriff) and require `VERIFIED` before withdrawals if your license demands it (one check in `server/src/routes/wallet.ts` → `/withdraw`).
- **Secrets**: long random `JWT_ACCESS_SECRET`, strong admin password, never commit `.env`.
- **Backups**: daily Postgres backups (`pg_dump`) — the ledger is your source of truth.
- **Test the money path in sandbox**: deposit → bet → settle → withdraw, and check that the sum of the `Transaction` ledger per user equals their balance.
- **Monitor** API quota (shown on the admin dashboard) and pending withdrawals daily.

## API reference (short)

| Method | Path | |
|---|---|---|
| POST | `/api/auth/register` `login` `refresh` `logout` | auth |
| GET | `/api/auth/me` | current user |
| POST | `/api/auth/change-password`, `/api/auth/responsible` | settings, limits, self-exclusion |
| GET | `/api/sports`, `/api/events?sport&group&status&q`, `/api/events/featured`, `/api/events/:id` | catalogue |
| POST | `/api/outcomes` | refresh betslip prices |
| POST / GET | `/api/bets`, `/api/bets?status=open\|won\|lost\|settled\|all` | place / history |
| GET | `/api/wallet/currencies`, `/api/wallet/balance`, `/api/wallet/transactions` | wallet |
| POST | `/api/wallet/deposit`, GET `/api/wallet/deposit/:id` | deposits |
| POST | `/api/wallet/withdraw`, `/api/wallet/withdraw/:id/cancel` | withdrawals |
| POST | `/api/wallet/ipn`, `/api/wallet/ipn-payout` | NOWPayments webhooks |
| * | `/api/admin/*` | admin (stats, users, withdrawals, events, sports, sync) |
