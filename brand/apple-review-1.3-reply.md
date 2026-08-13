# Reply to App Review — Guideline 1.3 (Kids Category)

Paste into App Store Connect → Resolution Center.

---

Thank you for reviewing Muza Watch. Answers to each question below.

**1. Does the app include third-party analytics?**

No. Muza Watch contains no analytics SDK of any kind. There is no Firebase
Analytics, Google Analytics, AppsFlyer, Adjust, Amplitude, Mixpanel, Segment,
Facebook SDK or equivalent, and no analytics or event-tracking code anywhere in
the app. No usage data, behavioural data or device data is collected for
analytics purposes, by us or by anyone else.

**2. Does the app include third-party advertising?**

No. The app contains no advertising SDK, serves no advertising of any kind, and
does not use the Advertising Identifier (IDFA). We do not intend to introduce
advertising. Because no advertising exists in the app, no ad network policies
apply.

**3. Will the data be shared with any third parties?**

Only with the service providers needed to operate the app, each for a single
stated purpose, and none for advertising, profiling or analytics. We do not
sell personal information and we do not share it for anyone else's marketing.

- **Google Firebase Cloud Messaging** — receives only an anonymous device push
  token, so we can notify users when new titles are added. It does not receive
  a phone number, name, or any record of what has been watched. Data is
  processed on Google's infrastructure. Notifications are optional and can be
  turned off in device settings.
- **Google Cast (Chromecast)** — used only when a user chooses to cast to a TV
  on their own network. It discovers devices on the local network and passes
  the video URL to the selected device. No personal information is sent.
- **Cloudflare Stream** — hosts and delivers the video itself. It receives the
  requests needed to play a video; it holds no account information.
- **Africa's Talking and Twilio (SMS)** — receive the phone number solely to
  deliver the one-time sign-in code, for the seconds that delivery takes. They
  are not used for marketing, and consent data is never shared or sold.
- **Stripe, and Yo! Payments (Mobile Money)** — handle payment credentials
  directly if a user subscribes. Card numbers and mobile-money PINs never reach
  our servers; we receive only whether the payment succeeded.

Account data is stored on our own servers in Germany (Contabo GmbH, Munich),
within the EU. Traffic between the app and our servers is encrypted in transit,
and sign-in codes and session tokens are stored hashed, never in readable form.

**4. Is the app collecting any user or device data for purposes beyond
third-party analytics or advertising?**

Yes, and only what the app needs to work. Every item below serves a function
the user can see:

- **Phone number** — required, because it is the account identifier and how the
  one-time sign-in code is delivered.
- **Display name, email address, postal address** — optional, stored only if
  the user chooses to enter them.
- **Playback position and titles played** — so viewing resumes where it
  stopped, and the Continue Watching row works.
- **Saved list** — titles the user chose to save.
- **Subscription and payment records** — which plan was bought and when, so
  access can be granted. No card details.
- **Device label, session timestamp, and push token** — to enforce the limit on
  how many devices may be signed in and streaming at once, and to deliver
  notifications if allowed.

None of this is used for advertising, profiling or analytics, and none is sold.

**How the app complies with Guideline 1.3**

- **Accounts are created and held by an adult.** Signing up requires a mobile
  phone number, and subscribing requires a payment method — a child cannot
  complete either. Children watch using a parent's or guardian's account. The
  app never asks a child for personal information and does not knowingly
  collect any from a child.
- **No advertising anywhere in the app**, so nothing about a child's viewing is
  used for advertising or to build an advertising profile.
- **No chat, no comments, no user-uploaded content, and no way for one viewer
  to contact another.**
- **Purchases require an adult's Mobile Money account or payment card**, and
  are confirmed outside the app.
- **Viewing history belongs to the account holder**, not to a named child, and
  can be cleared or deleted on request at any time.
- **Parents can request access to or deletion of everything held for their
  account** by emailing sales@prosystemsug.com.

Our privacy policy sets all of this out and is publicly available without a
login at https://ham.sentepos.com/privacy

Please let us know if any further detail would help.
