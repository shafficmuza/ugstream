# ugstream on 95.111.232.148 — LIVE at https://ham.sentepos.com

Deployed 2026-07-21, migrated from Docker to PM2 on 2026-07-22 (see
"Why no containers" below). This still mirrors the imam-fresh-laundry
pattern for the reverse proxy — Apache in front — but the app processes
themselves run natively.

## Current layout
- **DNS**: no new record needed — `*.sentepos.com` in `/var/named/sentepos.com.db`
  already wildcards to this server.
- **Apache**: `/etc/apache2/conf.d/n-ham.sentepos.conf` — single hostname,
  `/api/` proxies to the backend (strips the `/api` prefix; backend's own
  global prefix is `/v1`), everything else proxies to the frontend.
  **Filename matters, in both directions**: it must sort alphabetically
  before `sentepos-tenants.conf`, whose `*.sentepos.com` `ServerAlias`
  would otherwise catch `ham.sentepos.com` first (Apache's name-based
  vhost matching here picks the first vhost by config *load order*, not
  specificity) — but it must sort *after* `imamlaundry.conf`, or it steals
  "default vhost for this IP" status from imamlaundry.com (affects bare-IP
  hits and SNI-less TLS connections server-wide). `n-ham.sentepos.conf`
  satisfies both: `i` < `n` < `s`.
- **TLS**: Let's Encrypt cert at `/etc/letsencrypt/live/ham.sentepos.com/`,
  issued via `certbot certonly --webroot -w /var/www/html`, auto-renews.
- **Processes** (`pm2 list`):
  - `ugstream-backend` → 127.0.0.1:4010, `/root/ugstream/backend/dist/src/main.js`
  - `ugstream-frontend` → 127.0.0.1:4011, `next start` via `npm start`
  - Managed by `/root/ugstream/ecosystem.config.js`. `pm2 startup` was
    already configured on this box (for `bula-saas`), so `pm2 save` alone
    is enough for these to survive a reboot.
- **Database**: `ugs_postgres` is still a Docker container
  (127.0.0.1:5434) — it's stable, rarely changes, and doesn't have the
  rebuild-friction problem below. `docker-compose.yml` now only defines
  this one service.
- **Secrets**: `/root/ugstream/backend/.env` (JWT secret, DB URL, OTP
  bypass — generated, not committed).

## Why no containers (for backend/frontend)
Docker image rebuilds (multi-stage Alpine build → export → unpack) were
taking 4-6 minutes *per change*, on a server already tight on RAM. For an
app whose code changes multiple times a day during active development,
that's the wrong tradeoff. Native PM2 processes redeploy in the time it
takes to run `npm run build` (~20-40s) and `pm2 restart` — no image layer
overhead. Postgres stays in Docker because it almost never needs a rebuild.

## Seven bugs hit and fixed during deployment (documented so they don't recur)
1. **`nest build` outputs to `dist/src/main.js`, not `dist/main.js`** —
   there's no `rootDir` override in tsconfig, so TS preserves the directory
   structure from the common root of all included files (which includes
   `prisma/seed.ts`, outside `src/`). Fixed in `package.json` scripts and
   `ecosystem.config.js`'s `script` path.
2. **Prisma's query engine needs OpenSSL** — irrelevant now that we don't
   build an Alpine image, but if containers ever come back:
   `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` in
   `schema.prisma`'s `generator client` block, plus `apk add openssl`.
3. **`JwtAuthGuard` (depends on `JwtService`) is applied via `@UseGuards()`
   in modules that never imported `JwtModule`** (GenresModule, EpisodesModule,
   etc.) — Nest resolves a guard's constructor deps from the module it's
   *used* in, not wherever the provider happens to live. Fixed by wrapping
   `JwtModule.register({})` in a small `@Global()` module
   (`src/common/jwt-global.module.ts`) imported once in `AppModule`.
4. **`VerifyOtpDto` required exactly 6 characters (`@Length(6, 6)`), which
   silently rejected the 4-digit `OTP_STATIC_CODE` bypass ("1234") with a
   400 before the request ever reached the auth logic** — this is what
   blocked login entirely until fixed. Now `@Length(4, 6)`.
5. **`NEXT_PUBLIC_API_BASE` was never actually set at build time** —
   Next.js inlines `NEXT_PUBLIC_*` vars into the bundle *at build*, not
   read from the runtime environment. Setting it as a Docker `environment:`
   var did nothing; the frontend silently fell back to a broken default
   the entire time it was running, showing empty catalog/branding
   regardless of what was in the database. Fixed by committing
   `frontend/.env.production` (Next.js loads this automatically for
   `next build`).
6. **Admin-editable settings (app name, logo) appeared stale even after
   fixing #5 and confirming the DB had the right values** — Next's Full
   Route Cache can still cache a route's rendered HTML even when its
   fetches use `cache: 'no-store'`, unless the route explicitly opts out.
   Fixed with `export const dynamic = 'force-dynamic'` in the root layout.
7. **Cloudflare Stream signed playback URLs returned a silent 401** — the
   hand-rolled JWT (`sub` + `exp` claims, `kid` in the header) looked
   spec-compliant but Cloudflare actually requires `kid` in the **payload**
   too, plus `exp`/`nbf` as **strings** not numbers, undocumented in the
   places I checked. Fixed by dropping manual JWT signing entirely and
   calling Cloudflare's own `POST /accounts/{id}/stream/{uid}/token`
   endpoint, which issues a correct token directly — simpler and more
   robust than reimplementing their signing scheme.
   Related: Cloudflare's simple direct-upload POST endpoint silently
   `413`s on files over roughly 200MB. For anything already hosted at a
   public URL (as opposed to an admin's local file), `POST
   /accounts/{id}/stream/copy` with `{"url": "..."}` has Cloudflare fetch
   the source directly — no size limit hit, and no bandwidth spent on this
   server relaying the bytes.

## Two more bugs hit adding Stripe (2026-07-22)
8. **`esModuleInterop` was never actually enabled** — `tsconfig.json` had
   `allowSyntheticDefaultImports: true` (type-checking leniency only) but
   not `esModuleInterop` (which emits the actual runtime interop wrapper).
   Every prior import used `import * as X` or named exports, so this never
   surfaced — Stripe was the first `import Stripe from 'stripe'` default
   import of a plain-CJS package, and it silently compiled to
   `new stripe_1.default(...)` with no wrapper, so `.default` was
   `undefined`. Fixed by actually adding `esModuleInterop: true` — the
   standard NestJS default that this scaffold's tsconfig was missing.
9. **Stripe does not treat UGX as zero-decimal for this account** —
   assumed it did (UGX is commonly listed as zero-decimal for many
   providers) but empirically `unit_amount: 8000, currency: 'ugx'` was
   read back by Stripe as **80.00 UGX** (≈$0.02), under Stripe's ~$0.50
   Checkout minimum. Fixed by charging in USD instead, converting from the
   stored UGX price via `STRIPE_UGX_PER_USD` (backend/.env, static config
   value — not a live FX feed, update it as rates drift). Flutterwave
   still charges in native UGX; only the Stripe path converts.

10. **A real customer paid for real before `STRIPE_WEBHOOK_SECRET` was set**
    — Stripe showed the session as `paid`, but our webhook rejected every
    delivery attempt (missing secret → `constructEvent` throws → 400), so
    the payment sat `pending` forever and no subscription was granted
    despite the successful charge. Manually reconciled that one payment.
    To stop this depending solely on the webhook ever arriving: `getStatus()`
    now self-heals — if a Stripe payment is still `pending` and has a
    stored session id, it asks Stripe directly before returning, so even
    a missed/delayed webhook resolves within the frontend's existing 2s
    poll after checkout. Verified by hand-signing a fake webhook payload
    with the real secret (Stripe's HMAC scheme: `HMAC_SHA256(secret,
    "${t}.${payload}")`) and confirming it reaches the business logic
    rather than getting rejected, plus confirming a bad signature is
    still correctly rejected.

11. **Cloudflare's `ready` webhook silently missed events** — an episode
    (Elephants Dream) finished transcoding on Cloudflare's side (confirmed
    `readyToStream: true`, 654s duration) but our webhook never fired, so
    the episode sat `cfStatus: 'uploading'` indefinitely even though it was
    actually playable. Same class of bug as #10, just for episodes instead
    of payments. Fixed with the same self-heal pattern: added
    `CloudflareStreamService.getVideoStatus()` to ask Cloudflare directly,
    and `EpisodesService.syncStatus()` to call it whenever an episode is
    still `uploading`/`pending` — wired into both the playback path
    (`play()`) and the admin title-detail endpoint, so status corrects
    itself the next time anyone looks at the episode (no-op, one extra
    Cloudflare API call, for episodes already `ready`/`error`). Verified by
    forcing episode id=5 back to `cf_status='uploading'` in the DB and
    confirming `GET /admin/titles/9` returned it to `ready` with the
    correct duration/thumbnail.

## Payments: three providers now
- **Flutterwave** — MTN/Airtel Mobile Money + card, native UGX.
  **Hidden from the UI for now** (button removed from `/account/subscribe`,
  code path untouched) — no secret key configured, not urgent per user.
- **Stripe** — card only, **LIVE mode** (real charges), USD (see bug #9
  above). Fully configured and verified end-to-end: `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET` (endpoint `https://ham.sentepos.com/api/v1/webhooks/stripe`),
  and the self-healing status check (bug #10) are all live.
- **MTN MoMo** — Collections API (Request-to-Pay), **SANDBOX credentials**
  reused from the Sente POS app (`/home/sentepos/public_html/sentepos/config.php`
  — `MOMO_SUBSCRIPTION_KEY`/`MOMO_API_USER`/`MOMO_API_KEY`). Sandbox only:
  test-mode approvals, no real money moves. Architecturally different from
  the other two — no hosted checkout page; MTN pushes an approval prompt
  straight to the customer's phone, so `/payments/checkout` returns
  `{checkoutUrl: null, requiresPhoneApproval: true}` instead of a redirect
  URL, and the frontend shows an inline "check your phone" screen that
  polls status every 2s (this polling *is* the primary confirmation path
  here — MoMo has no signed-webhook equivalent to fall back on the way
  Stripe/Flutterwave do). Verified end-to-end against MTN's real sandbox:
  token exchange, 202-Accepted request-to-pay, and MTN's sandbox
  auto-approving the request — self-heal correctly detected `SUCCESSFUL`
  and granted the subscription automatically.
  **Going live for real customers requires separate production credentials**
  from MTN (sandbox keys don't "upgrade" — production is its own manual
  onboarding/approval process with MTN). Switch `MOMO_ENV=production` in
  `backend/.env` once you have them; currency switches from EUR to UGX
  automatically (`momo.service.ts`'s `currency` getter).

## Temporary: OTP bypass (no SMS provider yet)
`OTP_STATIC_CODE="1234"` in `backend/.env` means **every** phone number
receives the same fixed code — `/auth/otp/request` doesn't send a real SMS,
and `/auth/otp/verify` accepts "1234" for any number. This is a real
account-takeover risk (anyone who knows a phone number, or just guesses
one, can log in as that user) — acceptable short-term while there's no
real SMS provider, not acceptable to leave on indefinitely.

**To turn it off**: set `OTP_STATIC_CODE=""` in `backend/.env` once a real
SMS provider is wired into `backend/src/auth/sms.service.ts`, then
`pm2 restart ugstream-backend`.

## Still pending — you need to supply this
`FLUTTERWAVE_SECRET_KEY` / `FLUTTERWAVE_WEBHOOK_SECRET_HASH` in
`backend/.env` are still empty — payment checkout will throw "Missing
config" until they're filled in. Cloudflare Stream is fully configured
(see below) and working in production.

## Cloudflare Stream — configured and verified working
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_API_TOKEN`,
`CLOUDFLARE_CUSTOMER_CODE`, and `CLOUDFLARE_STREAM_WEBHOOK_SECRET` are set
in `backend/.env`. Account ID, customer code, and the webhook were all
obtained/configured via the Cloudflare API directly using the token —
no dashboard clicking needed beyond enabling Stream itself (it has no free
tier; needs a payment method attached before the API will do anything —
you'll get an explicit "Cloudflare Stream not enabled" error until then).

**No signing key needed** — see bug #7 above; playback tokens come from
Cloudflare's own token-issuing endpoint now, not a locally-held key.

## Seeded content
Real, legally-clear titles only (public domain films + Creative Commons
shorts — not fictional placeholders, and not pirated commercial content):
- **Big Buck Bunny** (2008, CC-BY, free) — Blender Foundation short
- **Sintel** (2010, CC-BY, free) — Blender Foundation short
- **Elephants Dream** (2006, CC-BY, free) — Blender Foundation short
- **Tears of Steel** (2012, CC-BY, free) — Blender Foundation short
- **Night of the Living Dead** (1968, public domain, subscription-gated)
- **His Girl Friday** (1940, public domain, purchase-gated, UGX 1,500)
- **The Cabinet of Dr. Caligari** (1920, public domain, subscription-gated)
- **Nosferatu** (1922, public domain, sub-or-purchase-gated)
- **Caminandes 1: Llama Drama** (2013, CC-BY, free, genre Kids) — Blender Foundation short
- **Caminandes 2: Gran Dillama** (2013, CC-BY, free, genre Kids) — Blender Foundation short
- **Caminandes 3: Llamigos** (2016, CC-BY, free, genre Kids) — Blender Foundation short

All titles above have real video fully uploaded, transcoded, and
verified playable through the app's actual entitlement-gated playback
endpoint. Sourced from archive.org / the Blender Foundation; posters
are either archive.org thumbnails or (for the Caminandes trilogy) a
1080p frame pulled from the source video with `ffmpeg -ss <t> -frames:v 1`
for a sharper result — copied into `backend/uploads/images/` so the app
doesn't depend on archive.org staying up. Manage via `/v1/admin/titles`
or the admin UI at `/admin/titles`.

A separate title, **"Humpty Dumpty Grocery Store | CoComelon Nursery
Rhymes & Kids Songs"** (id 13), was added directly by the site owner —
note this is commercial CoComelon content, not public-domain/CC, kept
live at the owner's explicit direction (acknowledged risk).

Large files (>~200MB) hit Cloudflare's direct-upload size limit — use
`POST /accounts/{id}/stream/copy` with a source URL instead of the app's
normal admin-upload flow (see bug #7) when re-adding large content this way.

## Company settings (name, logo, tagline, contact info)
Admin-editable at **https://ham.sentepos.com/admin/settings** — requires
an admin-role account (see below). Backed by `GET /v1/settings` (public,
drives the site header/title everywhere) and `PATCH /v1/admin/settings` +
`POST /v1/admin/settings/logo` (admin-only). Uploaded logos land in
`backend/uploads/logos/` on the host filesystem (real path now, not a
Docker volume).

## Making yourself admin
```bash
cd /root/ugstream
# Log in once via https://ham.sentepos.com/login (phone + code "1234"
# while the bypass is active), then:
docker compose exec postgres psql -U ugstream_user -d ugstream_db \
  -c "UPDATE users SET role = 'admin' WHERE phone = '+256XXXXXXXXX';"
```

## Redeploying after a code change
```bash
cd /root/ugstream/backend   # or frontend
npm run build               # nest build / next build
pm2 restart ugstream-backend   # or ugstream-frontend
# If the Prisma schema changed:
cd /root/ugstream/backend
DATABASE_URL="postgresql://ugstream_user:$(grep POSTGRES_PASSWORD ../.env | cut -d= -f2)@127.0.0.1:5434/ugstream_db" \
  npx prisma migrate dev --name <describe_the_change>
```

## Verify it's alive
```bash
curl https://ham.sentepos.com/api/v1/plans     # seeded plans as JSON
curl https://ham.sentepos.com/api/v1/home      # seeded placeholder movies
curl https://ham.sentepos.com/                 # 200, <title>ugstream</title>
pm2 list                                       # both ugstream-* processes "online"
```
