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
