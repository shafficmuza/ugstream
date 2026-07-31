# Mobile app — backend integration spec

Analysis of the ham/ugstream backend for building the native mobile app.
The backend is **API-first** (REST/JSON + JWT), so a native app is a
first-class client — no server changes required to start.

## 1. Connection

- **Base URL:** `https://ham.sentepos.com/api/v1` (Apache proxies `/api` →
  NestJS on :4010, global prefix `v1`).
- **Format:** JSON. Auth via `Authorization: Bearer <accessToken>`.
- **CORS is irrelevant for native apps** (only browsers enforce it) — the
  app calls the API directly.
- BigInt ids are serialized as **strings** everywhere.

## 2. Auth (phone + OTP + JWT)

| Endpoint | Body | Returns |
|---|---|---|
| `POST /auth/otp/request` | `{ phone }` | `{ expiresInSeconds: 300 }` (throttled 3/min) |
| `POST /auth/otp/verify` | `{ phone, code, deviceLabel? }` | `{ accessToken, refreshToken, user }` |
| `POST /auth/refresh` | `{ refreshToken }` | new `{ accessToken, refreshToken }` |
| `POST /auth/logout` | (auth) | revokes the session |
| `GET /auth/sessions` / `DELETE /auth/sessions/:id` | (auth) | device management |

- **Access token: 15 min. Refresh token: 30 days.** App must store both in
  **secure storage** (Keychain / Keystore) and auto-refresh on 401.
- Every authenticated request loads the user server-side: **banned → 403**,
  and role is attached. A revoked/expired session is rejected immediately.
- ⚠️ **OTP is currently a static bypass code (`1234`) — no real SMS provider
  is wired.** A real launch needs an SMS gateway (see `sms.service.ts`,
  `OTP_STATIC_CODE`). Until then the app "login" won't receive real codes.

## 3. Content (browse / detail) — all public GET

| Endpoint | Purpose |
|---|---|
| `GET /home` | Landing screen: `{ billboard, rails:[{key,rail,titles:[card]}], newest, movies, series, top10, genres }` |
| `GET /titles?kind=&genre=&language=&q=&page=&per_page=` | Browse + **search** (`q`), paginated `{ items:[card], page, ... }` |
| `GET /titles/:slug` | Detail: `{ id, name, slug, kind, description, genres[], episodes[], posterUrl, bannerUrl, access, priceUgx, ... }` |
| `GET /titles/:slug/similar` | Related titles |
| `GET /genres`, `GET /kinds` | Filter chips / sections |
| `GET /settings` | Branding: `{ appName, logoUrl, tagline, mobileMoneyProvider }` |

**Card shape:** `{ id, slug, name, kind, posterUrl, access, priceUgx, releaseYear, firstEpisodeId }`.
`firstEpisodeId` is what you pass to the play endpoint for a movie / the
"Play" button.

## 4. Playback — native-friendly

`POST /episodes/:id/play` (auth). Gated by entitlement.

Returns: `{ provider, playbackUrl, expiresIn, resumeAt, title:{name,slug,kind}, episode:{season,number,name} }`

| provider | playbackUrl | Player |
|---|---|---|
| `cloudflare` | signed HLS `.m3u8` (hour-scoped) | native HLS |
| `r2_hls` | public HLS `.m3u8` (adaptive 4K) | native HLS |
| `r2_file` | public `.mp4` | native progressive |

- **All three play with the OS-native player** (AVPlayer on iOS, ExoPlayer on
  Android) — HLS and MP4 are both natively supported. **No hls.js needed**
  (that was web-only). This is the biggest simplification vs. the web.
- **Not entitled → HTTP 402** with `{ reason:'not_entitled', options:{ canSubscribe, canPurchase, priceUgx, plans } }` → app shows the paywall.
- Not ready → 404. Resume: `resumeAt` seconds.
- Progress: `PUT /episodes/:id/progress { positionSecs }` every ~15s.
- Resume rail: `GET /me/continue-watching`.

## 5. My List & profile

- `POST /me/my-list/:titleId`, `DELETE /me/my-list/:titleId` (auth).
- `GET /me` → `{ id, phone, displayName, email, address, role }`.
- `PATCH /me` → update `displayName` (required), `email`/`address` (optional).

## 6. Payments — already mobile-app-ready

- `GET /payments/methods` (auth) → `{ methods:[ {method:'card',provider:'stripe',enabled}, {method:'mobile_money',provider,enabled,label} ] }` — render the right buttons.
- `POST /payments/checkout` (auth):
  `{ purpose:'subscription'|'title', planId?|titleId?, method:'card'|'mobile_money', payerPhone? }`
  → `{ paymentId, provider, action:{ type:'redirect'|'phone_prompt', url? }, ... }`
  - **`phone_prompt`** (Yo / MTN MoMo): show "approve on your phone", then
    poll status. `payerPhone` lets the user pay from a chosen number.
  - **`redirect`** (Stripe card / DPO): open `action.url` in an in-app
    browser / WebView.
- `GET /payments/:id` (auth) → status; **poll every ~2s**. It self-heals
  (re-verifies with the provider) so it's the source of truth.
- `GET /plans` → subscription plans.
- ⚠️ **Redirect providers need a deep link** back into the app. Today the web
  redirect is `PAYMENTS_REDIRECT_URL`; for mobile, register a universal /
  app link (e.g. `hamwatch://payments/callback`) and add it to the allowed
  redirect handling. Mobile-money (phone_prompt) needs no deep link — it just
  polls.

## 7. Data models (Prisma)

User, Session, Title, Episode, Kind, Genre, Plan, Payment, Subscription,
Purchase, MyListItem, WatchHistory, AppSettings, ActivityLog. Access model:
`title.access ∈ {free, subscription, purchase, sub_or_purchase}`; entitlement
derived live from Subscription/Purchase rows; **staff (admin/editor) get comp
viewing**.

## 8. Recommended stack & scaffold

- **React Native + Expo** — same TypeScript/React mental model as the Next.js
  web app; reuse API types and the token/refresh logic. `expo-video` /
  `react-native-video` for HLS, `expo-secure-store` for tokens,
  `expo-web-browser` for card checkout, `expo-router` for navigation.
  (Flutter is fine too but shares no code with the TS frontend.)
- **Suggested screens** (mirror the web consumer routes): Splash/Auth (phone
  → OTP), Home (`/home`), Browse/Search, Title detail, Player, My List,
  Continue Watching, Subscribe/Plans + payment, Profile.
- **Shared layer:** a typed API client (base URL, bearer, 401→refresh
  interceptor), an auth store (secure tokens + `me`), and generated types
  from these endpoints.

## 9. Gaps to close before a real launch

1. **Real SMS OTP** (currently static `1234`).
2. **Payment deep link** for redirect providers (card/DPO).
3. **Push notifications** (not built) — new content, payment confirmed.
4. **Content protection** — R2 public URLs are unauthenticated at the CDN
   (app gates the link only); add the signed Worker / DRM later if needed.
5. App **versioning / force-update** check (optional endpoint).
