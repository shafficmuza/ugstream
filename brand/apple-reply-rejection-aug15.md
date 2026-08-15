# Reply to App Review — rejection of 1.0 (42), Aug 15 2026

Paste into App Store Connect → Resolution Center, on submission
70cbbc1c-7a42-4359-aec0-f67f27947940, together with the NEW build.
(~2,300 characters — under the 4,000 limit.)

---

Thank you for the detailed review. We have addressed all three issues and
submitted a new build.

**Guideline 1.3 — Kids Category**

We have removed the app from the Kids category. The App Store category is now
Entertainment with a 13+ age rating, set in App Store Connect before this
resubmission. The app is a general-audience streaming service in the same
category as other video apps; it was not designed around the Kids category
requirements, and we agree it does not belong there. The parental-gate
requirements for external links and sharing therefore no longer apply.

For completeness on the two cited surfaces: the web view was the hosted
payment page opened by the purchase flow, which has been removed entirely in
this build (see 3.1.1 below) — the app now contains no web views and no
external links. The sharing control is the standard AirPlay picker in the
video player, used to stream a video the user is already watching to their
own television; with the app no longer in the Kids category we understand no
parental gate is required for it, and it remains in place as it does in other
video streaming apps.

**Guideline 3.1.1 — In-App Purchase**

The new build contains no way to purchase anything. We have removed the plans
screen and every purchase flow from the iOS app entirely. Muza Watch now
operates as a reader app under guideline 3.1.3(a) for previously purchased
subscription content: users who already have a subscription sign in and watch;
users who do not are shown a notice that a subscription is required and that
subscriptions cannot be purchased in the app. The notice contains no link, no
URL, no button, and no direction to any external purchase mechanism. There is
no In-App Purchase because nothing is sold in the app.

**Guideline 2.1(a) — loading indefinitely on purchase**

What the reviewer saw was the mobile-money payment flow: after starting a
purchase it displayed a "waiting for approval" screen while a payment
confirmation request was delivered to the customer's mobile-money phone
number — a flow that could never complete on a review device, since it
depends on approving the payment on a Ugandan mobile-money account. We agree
this was a poor experience. It is resolved by the change above: the purchase
flow no longer exists in the iOS app, so this screen is no longer reachable.
Playback, sign-in, and browsing are unaffected.

**Review account**

The test account provided in App Review Information signs in with the
one-time code shown there and has full viewing access, so all playback
functionality can be exercised without any purchase.

Please let us know if anything further would help.
