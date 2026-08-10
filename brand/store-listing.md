# Muza Watch — store listing pack

Copy-paste ready. Character counts are against each store's limit.

---

## Links you will be asked for

| Field | Value |
| --- | --- |
| **Privacy policy URL** | `https://ham.sentepos.com/privacy` |
| Terms of service URL | `https://ham.sentepos.com/terms` |
| Support email | `sales@prosystemsug.com` |
| Support phone | `+1 224 373 0803` |
| Website | `https://ham.sentepos.com` |
| Package / bundle id | `com.prosystemsug.muzawatch` |
| Developer / operator | Pro Media Systems LLC, Schaumburg, IL |

The privacy policy is a real page on the live site (HTTP 200, publicly
reachable, no login) and already names the operator, what is collected, why,
and the SMS-consent language. Both stores fetch this URL automatically, so it
must stay reachable — a 404 at review time is an instant rejection.

---

## Google Play

### App name (30 max)
```
Muza Watch
```

### Short description (80 max)
```
Free skills training and learning, safe kids shows, and Ugandan films.
```

### Full description (4000 max)
```
Muza Watch is a Ugandan streaming service built around free educational
videos, practical everyday training for all ages, safe viewing for children,
and original local films and series made by Ugandan creators.

FOR CHILDREN AND FAMILIES
• A dedicated Kids section with shows and learning videos chosen as suitable
  for younger viewers.
• Free educational content — lessons, skills and school-support material at
  no cost.
• No advertising anywhere in the app, ever.
• No chat, no comments, no user uploads, and no way for viewers to contact
  each other.
• Accounts are held by a parent or guardian, and purchases need an adult's
  Mobile Money account or card.

EVERYDAY TRAINING FOR ALL AGES
• Practical, locally made training you can use the same day — trades and
  hands-on skills, farming and agriculture, cooking, tailoring, business and
  money basics, health and home skills.
• Taught in a Ugandan context, by Ugandan instructors, for Ugandan conditions.
• Short, step-by-step lessons you can follow on a phone while you work.
• Suitable for any age — school leavers, parents, workers and small business
  owners.

ALSO ON MUZA WATCH
• Original local films and series produced in Uganda.
• Documentaries and short films from independent Ugandan creators.
• New titles added regularly.

All content on Muza Watch is produced locally, licensed to us, or in the
public domain. We do not host third-party copyrighted material.

BUILT FOR UGANDAN PHONES AND NETWORKS
• Adaptive streaming that adjusts to your connection, so playback keeps going
  when the signal drops.
• Pick up exactly where you stopped, on any device.
• Sign in once with your phone number — no password to remember, and no
  repeated sign-ins.
• Pay with Mobile Money, or by card.

SIMPLE TO USE
• Browse by category, or search for a title, genre or creator.
• Save what you want to watch later to My List.
• Continue Watching keeps your place across your phone, tablet and the web.
• Watch full screen in landscape, with tap-to-seek controls.

FREE AND PAID
Educational and training content is free to watch. A subscription unlocks the
full catalogue of original local films and series, and can be paid with MTN or
Airtel Mobile Money, or by card. Plans are daily, weekly or monthly — cancel
any time, no long contract.

ACCOUNT AND PRIVACY
Your phone number is your account. We send one SMS code to verify it and
nothing else — no marketing messages, ever. We never sell your number or share
it for advertising. Read the full policy at https://ham.sentepos.com/privacy

SUPPORT
Questions or trouble signing in? Email sales@prosystemsug.com and a person
will reply.

Muza Watch is operated by Pro Media Systems LLC.
```

### Category and tags
- **Category:** Education, if the training, learning and children's libraries
  are the larger part of the catalogue; Entertainment otherwise. Pick the one
  matching what a reviewer will actually see.
- **Tags:** kids, education, training, skills, learning, streaming, Uganda
- **Contains ads:** No
- **In-app purchases:** Yes — subscription plans

---

## Apple App Store

### Name (30 max)
```
Muza Watch
```

### Subtitle (30 max)
```
Kids, training & local films
```

### Promotional text (170 max)
```
Free everyday skills training, learning videos, a safe Kids section with no
ads, and original Ugandan films. Sign in once and pay with Mobile Money.
```

### Keywords (100 max, comma separated, no spaces) — 92 chars
```
kids,training,skills,education,learning,uganda,ugandan,african,farming,movies,series,films,family
```

### Description
Use the same full description as Play above — it is within Apple's 4000-character
limit and needs no changes.

---

## Data safety (Play) — answers that match the live app

Declare collected, **linked to the user**, and **not** shared with third parties
for advertising:

| Data | Collected | Purpose |
| --- | --- | --- |
| Phone number | Yes | Account creation and sign-in |
| Name, email, address | Yes, optional | Account management, only if the user enters them |
| Purchase history | Yes | Subscription entitlement |
| App interactions (titles played, position) | Yes | Continue Watching, app functionality |
| Device identifiers (push token) | Yes | Notifying users about new titles |

- Data is encrypted in transit: **Yes** (the whole app is HTTPS).
- Users can request deletion: **Yes** — say how in the listing; support email is fine.
- No data is shared for advertising or marketing.

Payment card details are handled by Stripe and never touch our servers, so they
are not declared as collected by the app.

## Content rating (Play) / Age rating (Apple)

Answer the questionnaire against what the catalogue actually contains. If the
library includes films with violence, frightening scenes or mature themes, say
so — an under-declared rating is a common cause of removal after publication,
and it is checked against real content.

---

## Serving children — the extra rules this triggers

Once you tell Play that children are a target audience, a separate and much
stricter rulebook applies. This is worth reading before you fill in the form,
because the answers are hard to walk back.

**Play → App content → Target audience and content.** If you select any age
group under 13, the app enters the **Families policy**. That brings:

- Ads must comply with the Families ad rules. You show none, which is the
  simplest possible position — keep it that way.
- No collection of the Android Advertising ID from children.
- Only Google-approved SDKs for self-certified ads/analytics.
- The app must not link out to sites that are unsuitable for children.

You can select **both** children and adult age groups. That is the honest
answer here — the Kids section is for children, the rest of the catalogue is
not — and it keeps the store listing accurate.

**COPPA applies to you.** Pro Media Systems LLC is a US company, so the US
Children's Online Privacy Protection Act governs personal information collected
from children under 13. The structural point: **sign-in requires a phone
number**, and collecting one directly from an under-13 without verifiable
parental consent is exactly what COPPA prohibits.

The privacy policy now resolves this the way family streaming services do — the
account belongs to an adult, children watch under it, and the app never asks a
child for personal information. Two things have to stay true for that to hold:

1. Don't add child profiles that collect a name, age or birthday from the child.
2. Don't add ads, third-party analytics SDKs, or advertising identifiers.

Both are currently true, and both are easy to break later without noticing.

**Apple's Kids Category is a separate decision.** Only opt in if children are
the primary audience. It forbids third-party analytics and advertising outright,
and requires a parental gate before any external link or purchase flow. If the
catalogue is genuinely mixed, list under Education or Entertainment with a 4+
or 9+ rating instead — the Kids Category is stricter than you need.

**What the policy now says**, and what a reviewer will check it against:
accounts are adult-held; no advertising of any kind; no chat, comments or user
uploads; no viewer-to-viewer contact; purchases need an adult's Mobile Money
account or card; viewing history belongs to the account, not to a named child;
and parents can see or delete everything by email.

That list is only true while it stays true in the app. If you later add
comments, profiles for children, or any ad network, the policy and the store
declarations both need revisiting.

---

## App access — the thing most likely to stall review

Reviewers cannot receive your SMS code: they test from their own devices, on
their own numbers, outside Uganda. An app that can only be entered through an
OTP sent to a Ugandan handset gets rejected as "we could not sign in".

PIN sign-in solves this exactly, because it sends no SMS at all:

1. Create an ordinary account for review.
2. Set a PIN on it.
3. Give it an active subscription so the reviewer reaches playback, not a paywall.
4. Enter the phone number and PIN as the demo account:
   - **Play Console** → App content → App access → "All functionality is restricted"
   - **App Store Connect** → App Review Information → Sign-In Required
5. Test that login yourself on a clean install before submitting.

Add a note for the reviewer:

```
Sign in with the phone number and PIN provided. Choose "Sign in with PIN" —
no SMS code is needed. The account has an active subscription so all content
is playable.
```

---

## Before you submit — one sequencing point

Review happens **before** publication, and the reviewer opens the app against
whatever the live API is serving at that moment. So the catalogue has to match
this description when you **submit**, not when you publish.

That matters here because the description above states that all content is
local, licensed or public domain. If a reviewer opens the app and finds current
commercial films, the mismatch is worse than having no description at all: it
reads as misrepresentation, which is judged against the developer account
rather than the single release, and repeat flags put the account itself at
risk. Nothing has been changed or deactivated — the timing is yours to choose.
