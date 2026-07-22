# ugstream

Ugandan movies & series streaming platform. **Live at
https://ham.sentepos.com** (deployed 2026-07-21 on 95.111.232.148). See
`/root/streaming-app-plan.md` and `/root/streaming-app-schema.md` for the
full business/architecture writeup this was built from, and
`deploy/README.md` for exactly how it's running in production, including
real bugs hit and fixed along the way.

**Stack:** NestJS + Prisma + Postgres (backend), Next.js (frontend),
Cloudflare Stream (video), Flutterwave (MTN MoMo / Airtel Money / card
payments). Backend and frontend run natively via **PM2** (not Docker —
image rebuilds were too slow for active development); Postgres stays in
a Docker container since it rarely changes.

## Structure
```
backend/    NestJS API — auth (phone+OTP), catalog, entitlements, payments, settings
frontend/   Next.js app — browse, login, playback, subscribe, admin settings
deploy/     Apache vhost + production deploy/redeploy instructions
ecosystem.config.js   PM2 process definitions for backend + frontend
docker-compose.yml    Postgres only
```

## Local development

**Backend**
```bash
cd backend
cp .env.example .env        # fill in DATABASE_URL at minimum to start
npm install                  # already done in this scaffold
npx prisma migrate dev       # creates the schema in your local Postgres
npx prisma db seed           # seeds plans + genres
npm run start:dev            # http://localhost:4001/v1
```
Cloudflare/Flutterwave env vars can stay empty for local auth/catalog work —
they're only required once you hit upload or checkout endpoints.
`OTP_STATIC_CODE="1234"` bypasses real SMS — see the security note below.

**Frontend**
```bash
cd frontend
npm install
npm run dev                  # http://localhost:3000
```
Set `NEXT_PUBLIC_API_BASE=http://localhost:4001/v1` and
`PUBLIC_ASSET_PREFIX=""` (not `/api`) for local dev.

## What's implemented
- Phone + OTP auth (JWT access token + rotating refresh token, device-limit
  enforcement, session listing/revocation) — **currently bypassed to a
  fixed code "1234"** until a real SMS provider is wired in, see below
- Catalog: browse/search/genres, title detail, homepage rails
- Admin CRUD for titles/genres, Cloudflare Stream direct-upload wiring
- **Full admin panel** at `/admin` (admin-role accounts only):
  - **Dashboard** — user count, active subscriptions, revenue, title counts
  - **Titles** — create/edit/publish/delete movies & series, genre
    checkboxes, poster/banner upload (real files, no Cloudflare needed)
  - **Episodes/video** — per-title episode management (season/number for
    series), video upload straight to Cloudflare Stream with progress bar
    (needs Cloudflare credentials to actually work)
  - **Genres** — create/delete, shows title-count per genre
  - **Plans** — create subscription plans, toggle active/inactive
  - **Users** — search, promote/demote admin, ban/unban
  - **Payments** — read-only transaction history
  - **Settings** — app name, logo, tagline, support contact (drives the
    site header/title everywhere)
- Entitlement engine (free / subscription / purchase), derived live —
  no cached flags to go stale
- Playback: signed, hour-scoped Stream tokens gated on entitlement; resume
  position tracking
- Flutterwave checkout + webhook (signature-verified, re-verifies the
  transaction server-to-server before granting anything, idempotent)
- Cloudflare Stream webhook (HMAC-verified) marking episodes ready/errored

## Security note: OTP is bypassed right now
`OTP_STATIC_CODE="1234"` in `backend/.env` means **any** phone number logs
in with code `1234` — no real SMS is sent or checked. This is intentional
short-term scaffolding (no reliable SMS provider yet) but is a real
account-takeover risk. Turn it off (`OTP_STATIC_CODE=""`) the moment
`backend/src/auth/sms.service.ts` sends real messages.

## What's NOT implemented yet (see streaming-app-plan.md §6 for the full v2 list)
- SMS provider is a stub that logs the OTP instead of sending it — wire
  Africa's Talking or Yo! SMS in `backend/src/auth/sms.service.ts`
- Native Android app, offline downloads, DRM beyond signed URLs
- Flutterwave payment keys — checkout will error until they're added

## Content
Cloudflare Stream is fully configured and working. 4 real titles are live
with actual uploaded/transcoded video — public domain films (*Night of the
Living Dead*, *His Girl Friday*) and Creative Commons shorts (*Big Buck
Bunny*, *Sintel*), not fictional placeholders and not pirated commercial
content. See `deploy/README.md` for sourcing details and how to add more.

## Deploying
Already live at https://ham.sentepos.com, running via PM2 (`pm2 list`).
See `deploy/README.md` for the current setup and exactly how to redeploy
after a code change (no image rebuild needed — just `npm run build` +
`pm2 restart`).
