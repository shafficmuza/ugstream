# Ugandan Streaming Platform — Research & Planning Document

*Prepared 2026-07-21 · Target market: Uganda · Reference competitor: MunoWatch*

---

## 1. Market Snapshot

### Competitors
| Platform | Model | Notes |
|---|---|---|
| **MunoWatch** (Munoclub Ltd) | ~UGX 30,000/month subscription | VJ-translated (Luganda) foreign movies + local content. Android apps (Pro, Lite, TV) + website. Market leader in the niche. |
| **Afro Mobile** (Next Media) | Freemium | Local TV/entertainment streaming, strong content pipeline via NBS/Next Media. |
| **Netflix / Showmax** | USD-priced subs | Little local-language content; card-payment barrier excludes most Ugandans. |

### What makes MunoWatch work
1. **VJ translation** — Luganda voice-over narration ("Veejay" culture) makes foreign films accessible. This is the moat.
2. **Mobile money payments** — no card required.
3. **A "Lite" app** — small APK, low data usage. Data cost is the #1 constraint for Ugandan consumers.

### Opportunity gaps to consider
- Other language VJs (Runyankole, Luo, Ateso, Swahili) — MunoWatch is Luganda-centric.
- Offline downloads with expiry (commuters, data-bundle users).
- Micro-payments: pay-per-movie (UGX 1,000–2,000) instead of monthly subs — matches how Ugandans buy data bundles.
- Local original content (comedy skits, dramas) — safer licensing position than translated foreign films.

---

## 2. The Content/Licensing Question (decide this FIRST)

This determines everything else:

| Strategy | Legal risk | Content cost | Differentiation |
|---|---|---|---|
| VJ-translated foreign films (MunoWatch model) | **High** — the underlying films are copyrighted; VJ translations don't confer rights. MunoWatch operates in a grey zone. | Low | High (proven demand) |
| Licensed local content (Ugandan films, series, comedy) | Low | Medium — revenue-share deals with local producers are feasible | Medium |
| Original commissioned content | Low | High | High long-term |
| Aggregated free/creator content (YouTube-style) | Low | Low | Low |

**Recommendation:** launch with licensed local content + creator revenue-share, evaluate VJ content only with proper legal advice. An app pulled from the Play Store for infringement kills the business.

---

## 3. Video Infrastructure Comparison

### Option A — Managed video API
Handles transcoding to adaptive HLS, storage, global CDN, player analytics.

Approximate 2026 pricing (per search results, verify before committing):
| Provider | Storage | Delivery | Encoding | Example: 10k min stored, 100k min delivered/mo |
|---|---|---|---|---|
| Cloudflare Stream | ~$1/1,000 min | ~$5/1,000 min* | Included | **~$150/mo** |
| Mux | Asset storage fees | ~$0.025/min | Free | **~$170/mo** |
| api.video | Bundled | Bundled | Free (capped) | **~$99/mo** (Scale plan, 100h encode cap) |

*Sources disagree on whether Cloudflare's higher rate is storage or delivery — confirm on cloudflare.com before budgeting.

**Reality check for scale:** 1,000 active users × 10 hours watched/month = 600,000 delivery minutes ≈ **$600–3,000/mo** depending on provider. Delivery minutes are the dominant cost and scale linearly with success.

- ✅ Zero ops burden, adaptive bitrate out of the box (critical for Ugandan 3G/4G), signed URLs for content protection
- ❌ USD costs scale with viewership; at UGX 30k/user/mo (~$8), unit economics need ~$1–3 delivery cost per user max

### Option B — Self-hosted
FFmpeg transcoding → HLS segments → object storage (Wasabi/Backblaze B2, ~$6/TB/mo, free or cheap egress) → nginx or a CDN in front.

- ✅ Fixed, predictable costs. A Contabo-class VPS (like your existing box) has generous bandwidth. Storage at ~$6/TB is far cheaper than per-minute billing.
- ❌ You build/operate: transcoding pipeline, token-signed URLs (anti-piracy), player, monitoring. No global CDN means slower starts for viewers — though for a Uganda-only audience, a single EU/nearby POP + Cloudflare free-tier caching can be acceptable.
- ⚠️ Bandwidth math: 100k delivery minutes at ~1.5 Mbps average ≈ 1.1 TB/mo — fine for one VPS. 1M minutes ≈ 11 TB/mo — still within Contabo's 32 TB allowances, but a single box becomes a availability/throughput risk.

### Option C — Hybrid (recommended path)
1. **MVP:** Cloudflare Stream (or api.video) — launch in weeks, not months.
2. **At traction (~$300+/mo video bill):** migrate hot content to self-hosted HLS + Cloudflare CDN caching; keep managed service for ingest/transcode only or drop it entirely.

HLS files are portable — a migration later is storage copying plus URL changes, not a rebuild.

---

## 4. Payments (Uganda-specific)

Card penetration is very low; **mobile money is mandatory.**

| Option | Coverage | Notes |
|---|---|---|
| **Flutterwave** | MTN MoMo, Airtel Money, cards | Best developer experience, subscriptions/recurring supported. Settlement to UGX bank account. |
| **Pesapal** | MTN, Airtel, cards | Strong East-Africa presence. |
| **Direct MTN MoMo API / Airtel Money API** | Single network each | Lower fees, more integration work, need both for full coverage. |

**Recommendation:** Flutterwave for MVP (one integration = both networks + cards), consider direct MoMo APIs later to cut fees.

Pricing model to test: monthly sub (UGX 25–30k) **and** pay-per-title (UGX 1–2k) — micro-transactions match mobile-money habits.

---

## 5. Recommended Architecture (MVP)

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Web (Next.js│────▶│  API (Node/      │────▶│ Postgres         │
│ PWA, mobile-│     │  Laravel — match │     │ (users, catalog, │
│ first)      │     │  your stack)     │     │ subs, history)   │
└─────────────┘     └───────┬──────────┘     └──────────────────┘
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
        Cloudflare     Flutterwave    Signed playback
        Stream (video  (MoMo/Airtel   URLs (anti-share)
        ingest+deliver) webhooks)
```

- **PWA first**, installable on Android — avoids Play Store review for MVP, one codebase. Wrap with Capacitor/TWA for a Play Store listing later.
- Signed, expiring playback URLs tied to user session — basic anti-piracy.
- Admin panel for content upload → auto-transcode via managed API.

## 6. MVP Feature Cut

**In:** browse/search catalog, video playback (adaptive HLS), signup via phone number + OTP, MoMo/Airtel subscription + pay-per-title, watch history/resume, admin content upload.

**Out (v2):** offline downloads, Android/iOS native apps, TV apps, profiles, DRM (use signed URLs first), recommendations.

## 7. Rough Budget (MVP, first 3 months)

| Item | Est. cost |
|---|---|
| Video API (low traffic) | $20–100/mo |
| VPS + domain + email | $20/mo (or reuse existing server) |
| Flutterwave | % per transaction, no fixed fee |
| Content licensing | The real variable — from revenue-share (0 upfront) to $$ |
| Dev time | Main investment — MVP is ~4–8 weeks of focused work |

## 8. Key Risks

1. **Content rights** — biggest existential risk (see §2).
2. **Piracy/account-sharing** — mitigate with signed URLs, device limits; accept some leakage.
3. **Data costs for users** — offer 240p/360p options prominently; consider telco zero-rating deals (MTN/Airtel partnerships) long-term.
4. **Delivery cost vs ARPU** — track cost-per-user monthly; migrate to self-hosted before margins invert.

## 9. Next Steps

1. Decide content strategy (§2) — talk to local producers / a lawyer re: VJ content.
2. Verify current Cloudflare Stream / api.video pricing and Flutterwave UGX fees.
3. Name + domain + brand.
4. Build MVP per §5–6.
