# Streaming Platform — Database Schema & API Design (MVP)

*Companion to streaming-app-plan.md · Postgres + REST · 2026-07-21*

---

## 1. Database Schema (Postgres)

```sql
-- ============ AUTH ============
CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    phone         VARCHAR(15) UNIQUE NOT NULL,   -- E.164, e.g. +2567XXXXXXXX
    display_name  VARCHAR(100),
    role          VARCHAR(10) NOT NULL DEFAULT 'user',  -- user | admin
    status        VARCHAR(10) NOT NULL DEFAULT 'active', -- active | banned
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
    id          BIGSERIAL PRIMARY KEY,
    phone       VARCHAR(15) NOT NULL,
    code_hash   VARCHAR(255) NOT NULL,          -- never store the raw code
    expires_at  TIMESTAMPTZ NOT NULL,           -- ~5 min TTL
    consumed_at TIMESTAMPTZ,
    attempts    SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX idx_otp_phone ON otp_codes (phone, expires_at);

-- Refresh-token sessions; also enforces the device limit
CREATE TABLE sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_hash  VARCHAR(255) NOT NULL,
    device_label  VARCHAR(100),                 -- "Tecno Spark 10, Chrome"
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at    TIMESTAMPTZ
);
CREATE INDEX idx_sessions_user ON sessions (user_id) WHERE revoked_at IS NULL;

-- ============ CATALOG ============
CREATE TABLE titles (
    id            BIGSERIAL PRIMARY KEY,
    kind          VARCHAR(10) NOT NULL,          -- movie | series
    name          VARCHAR(200) NOT NULL,
    slug          VARCHAR(220) UNIQUE NOT NULL,
    description   TEXT,
    language      VARCHAR(30),                   -- luganda | swahili | english ...
    vj_name       VARCHAR(100),                  -- NULL if not VJ-translated
    release_year  SMALLINT,
    poster_url    TEXT,
    banner_url    TEXT,
    -- pricing / entitlement
    access        VARCHAR(12) NOT NULL DEFAULT 'subscription',
                  -- free | subscription | purchase | sub_or_purchase
    price_ugx     INTEGER,                       -- for pay-per-title kinds
    rental_hours  INTEGER DEFAULT 72,            -- purchase validity window
    published     BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_titles_browse ON titles (published, kind, language);

-- One row per playable video. Movies have exactly one; series have many.
CREATE TABLE episodes (
    id              BIGSERIAL PRIMARY KEY,
    title_id        BIGINT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    season          SMALLINT NOT NULL DEFAULT 1,
    number          SMALLINT NOT NULL DEFAULT 1,
    name            VARCHAR(200),
    -- Cloudflare Stream linkage
    cf_video_uid    VARCHAR(64) UNIQUE,          -- Stream's video UID
    cf_status       VARCHAR(15) NOT NULL DEFAULT 'pending',
                    -- pending | uploading | ready | error
    duration_secs   INTEGER,
    thumbnail_url   TEXT,
    UNIQUE (title_id, season, number)
);

CREATE TABLE genres (
    id    SMALLSERIAL PRIMARY KEY,
    name  VARCHAR(50) UNIQUE NOT NULL,           -- Action, Comedy, Local Drama...
    slug  VARCHAR(60) UNIQUE NOT NULL
);

CREATE TABLE title_genres (
    title_id BIGINT REFERENCES titles(id) ON DELETE CASCADE,
    genre_id SMALLINT REFERENCES genres(id) ON DELETE CASCADE,
    PRIMARY KEY (title_id, genre_id)
);

-- ============ BILLING ============
CREATE TABLE plans (
    id            SMALLSERIAL PRIMARY KEY,
    name          VARCHAR(50) NOT NULL,          -- "Monthly", "Weekly"
    price_ugx     INTEGER NOT NULL,              -- 30000
    duration_days SMALLINT NOT NULL,             -- 30, 7
    active        BOOLEAN NOT NULL DEFAULT true
);

-- Every money movement, regardless of purpose. Flutterwave is source of truth.
CREATE TABLE payments (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES users(id),
    amount_ugx    INTEGER NOT NULL,
    purpose       VARCHAR(12) NOT NULL,          -- subscription | title
    plan_id       SMALLINT REFERENCES plans(id), -- when purpose = subscription
    title_id      BIGINT REFERENCES titles(id),  -- when purpose = title
    provider      VARCHAR(20) NOT NULL DEFAULT 'flutterwave',
    provider_ref  VARCHAR(100) UNIQUE,           -- tx_ref sent to Flutterwave
    provider_txid VARCHAR(100),                  -- Flutterwave's transaction id
    status        VARCHAR(12) NOT NULL DEFAULT 'pending',
                  -- pending | successful | failed | refunded
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at  TIMESTAMPTZ
);
CREATE INDEX idx_payments_user ON payments (user_id, status);

CREATE TABLE subscriptions (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id),
    plan_id     SMALLINT NOT NULL REFERENCES plans(id),
    payment_id  BIGINT NOT NULL REFERENCES payments(id),
    starts_at   TIMESTAMPTZ NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL
);
-- "Is user subscribed?" = EXISTS (... WHERE user_id = ? AND expires_at > now())
CREATE INDEX idx_subs_active ON subscriptions (user_id, expires_at DESC);

-- Pay-per-title entitlements (rentals)
CREATE TABLE purchases (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id),
    title_id    BIGINT NOT NULL REFERENCES titles(id),
    payment_id  BIGINT NOT NULL REFERENCES payments(id),
    expires_at  TIMESTAMPTZ NOT NULL              -- purchase time + rental_hours
);
CREATE INDEX idx_purchases_active ON purchases (user_id, title_id, expires_at DESC);

-- ============ ENGAGEMENT ============
CREATE TABLE watch_history (
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    episode_id    BIGINT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    position_secs INTEGER NOT NULL DEFAULT 0,
    completed     BOOLEAN NOT NULL DEFAULT false,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, episode_id)
);
```

### Design notes
- **Movies are single-episode titles.** One playback path, one history table, series support free.
- **Entitlement is derived, never stored on the user**: subscription row not expired, OR purchase row not expired, OR `titles.access = 'free'`. No sync bugs.
- **Payments are append-only**; webhooks flip `status` and *then* create the subscription/purchase row in the same transaction — idempotent on `provider_txid`.
- Phone+OTP only, no passwords — matches mobile-money UX and halves auth attack surface.

---

## 2. REST API Design

Base: `https://api.<domain>/v1` · Auth: `Authorization: Bearer <JWT>` (15-min access token + refresh token). JSON everywhere.

### Auth
| Method | Path | Body / Notes |
|---|---|---|
| POST | `/auth/otp/request` | `{phone}` → sends SMS code. Rate-limit: 3/phone/hour. |
| POST | `/auth/otp/verify` | `{phone, code, device_label}` → `{access_token, refresh_token, user}`. Creates user on first login. |
| POST | `/auth/refresh` | `{refresh_token}` → new token pair. |
| POST | `/auth/logout` | Revokes current session. |
| GET | `/me` | Profile + `{subscription: {plan, expires_at} \| null}` + active device count. |
| GET/DELETE | `/me/sessions`, `/me/sessions/:id` | List / kick devices (enforce max 2–3 active). |

### Catalog (public — browsing works logged-out; playback doesn't)
| Method | Path | Notes |
|---|---|---|
| GET | `/titles` | `?kind=&genre=&language=&q=&sort=newest&page=&per_page=20`. Returns cards: id, slug, name, poster, access, price. |
| GET | `/titles/:slug` | Full detail + episodes list (locked/unlocked flag per user). |
| GET | `/genres` | For nav chips. |
| GET | `/home` | Curated rails: `[{rail: "New This Week", titles: [...]}, ...]` — one call renders the homepage (saves data). |

### Playback (the entitlement gate)
| Method | Path | Notes |
|---|---|---|
| POST | `/episodes/:id/play` | Checks entitlement → 402 with `{reason, options: [plans/price]}` if not entitled; else returns **short-lived signed Cloudflare Stream token**: `{playback_url, token, expires_in: 3600, resume_at}` |
| PUT | `/episodes/:id/progress` | `{position_secs}` — fire every ~15s from the player. |
| GET | `/me/continue-watching` | Recent incomplete episodes with positions. |

### Billing
| Method | Path | Notes |
|---|---|---|
| GET | `/plans` | Active plans. |
| POST | `/payments/checkout` | `{purpose: "subscription"\|"title", plan_id?\|title_id?}` → creates pending payment, returns `{flw_link}` (Flutterwave hosted checkout) — user pays via MTN/Airtel prompt. |
| GET | `/payments/:id` | Client polls status after checkout redirect. |
| POST | `/webhooks/flutterwave` | **Server-to-server.** Verify signature header → verify tx with Flutterwave API (never trust the webhook body alone) → mark payment successful + grant entitlement in one transaction. Idempotent. |

### Admin (`role = admin`)
| Method | Path | Notes |
|---|---|---|
| POST | `/admin/titles` / PATCH `/admin/titles/:id` | CRUD incl. publish toggle. |
| POST | `/admin/titles/:id/episodes` | Creates episode → calls Cloudflare `direct_upload` → returns one-time upload URL; admin browser uploads the file **straight to Cloudflare** (never through your server). |
| POST | `/webhooks/cloudflare-stream` | Stream notifies when transcoding finishes → set `cf_status = 'ready'`, store duration + thumbnail. |
| GET | `/admin/stats` | Signups, active subs, revenue, top titles. |

### Playback security flow (Cloudflare Stream)
1. Videos uploaded with `requireSignedURLs: true` — raw Stream URLs are unplayable.
2. `/episodes/:id/play` verifies entitlement, then signs a JWT with your Stream signing key (1-hour expiry, video-scoped).
3. Player fetches HLS manifest with that token. Sharing a link dies within the hour; the API endpoint itself requires a logged-in, entitled user.

---

## 3. Suggested build order
1. Auth (OTP + JWT) → 2. Catalog models + admin CRUD → 3. Cloudflare direct upload + webhook → 4. Playback with signed URLs → 5. Flutterwave checkout + webhook → 6. Entitlement gate on play → 7. History/continue-watching → 8. Homepage rails + search.
