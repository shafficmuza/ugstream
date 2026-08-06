import type { Metadata } from 'next';
import { LegalPage, H2, P, UL, Callout, OPERATOR } from '../legal/legal';

export const metadata: Metadata = {
  title: `Privacy Policy — ${OPERATOR.brand}`,
  description: `How ${OPERATOR.brand} collects, uses and protects your information.`,
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="7 August 2026">
      <P>
        This policy explains what {OPERATOR.brand} (&ldquo;we&rdquo;, &ldquo;us&rdquo;), operated by{' '}
        {OPERATOR.company} of {OPERATOR.city}, collects about you, why, and what we do with it. It
        applies to our website at {OPERATOR.site} and to our Android and iOS apps.
      </P>

      <H2>Mobile information and SMS</H2>
      <Callout>
        <P>
          <strong>
            No mobile information will be shared with third parties or affiliates for marketing or
            promotional purposes.
          </strong>{' '}
          Information sharing with subcontractors in support services, such as our SMS delivery
          providers, is permitted solely to deliver the messages you have asked for. Text messaging
          originator opt-in data and consent are never shared with any third party for any other
          purpose, and are never sold.
        </P>
        <P last>
          We send SMS for one reason: the one-time code that signs you in. We do not send marketing
          or promotional text messages.
        </P>
      </Callout>
      <P>
        Your phone number is your account identifier. We store it in international (E.164) format,
        and we use it to send you a one-time verification code each time you sign in on a new
        device. We pass your number to our SMS provider only for the seconds needed to deliver that
        message.
      </P>

      <H2>What we collect</H2>
      <UL>
        <li>
          <strong>Your phone number</strong> — required, because it is how you sign in.
        </li>
        <li>
          <strong>Optional profile details</strong> — display name, email address and postal
          address, only if you choose to enter them.
        </li>
        <li>
          <strong>What you watch</strong> — titles played, playback position and completion, so you
          can resume where you stopped and see your Continue Watching row.
        </li>
        <li>
          <strong>Your list</strong> — titles you save.
        </li>
        <li>
          <strong>Subscription and payment records</strong> — which plan you bought, when, and
          whether payment succeeded. We never see or store your card number or mobile-money PIN.
        </li>
        <li>
          <strong>Sessions and devices</strong> — a device label, the time a session was last used,
          and a push notification token if you allow notifications. This is what enforces the limit
          on how many devices can be signed in and streaming at once.
        </li>
      </UL>
      <P>
        We do not collect your location, your contacts, your photos, or the contents of any other
        app on your device.
      </P>

      <H2>Why we use it</H2>
      <UL>
        <li>To sign you in and keep you signed in.</li>
        <li>To give you access to the titles your subscription covers.</li>
        <li>To remember your progress and your list.</li>
        <li>To take payment and keep a record of it.</li>
        <li>
          To enforce the device and simultaneous-stream limits attached to your plan, which is what
          keeps accounts from being shared beyond a household.
        </li>
        <li>
          To send you push notifications about new titles, if you allowed notifications. You can
          turn these off in your device settings at any time.
        </li>
      </UL>

      <H2>Who we share it with</H2>
      <P>
        We do not sell your personal information, and we do not share it for anyone else&rsquo;s
        marketing. We use a small number of service providers who process data on our behalf:
      </P>
      <UL>
        <li>
          <strong>SMS delivery</strong> — Africa&rsquo;s Talking and Twilio, which receive your
          phone number in order to deliver your sign-in code.
        </li>
        <li>
          <strong>Payments</strong> — Stripe for card payments, and Yo! Payments, MTN Mobile Money,
          Flutterwave or DPO Pay for mobile money. These providers handle your card or mobile-money
          credentials directly; we receive only the outcome.
        </li>
        <li>
          <strong>Push notifications</strong> — Google Firebase Cloud Messaging, which receives a
          device token, not your phone number.
        </li>
        <li>
          <strong>Video delivery</strong> — Cloudflare Stream, which serves the video itself.
        </li>
      </UL>
      <P>
        We may also disclose information where the law requires it, or to establish or defend legal
        claims.
      </P>

      <H2>How long we keep it</H2>
      <P>
        We keep your account and its history for as long as your account exists. Sign-in codes are
        deleted shortly after they expire. If you ask us to delete your account, we remove your
        personal information and retain only what we are legally required to keep, such as payment
        records for tax and accounting purposes.
      </P>

      <H2>Security</H2>
      <P>
        Traffic between your device and our servers is encrypted in transit. Sign-in codes and
        session tokens are stored hashed, never in readable form, so they cannot be recovered from
        our database. Access to production systems is restricted to the people who operate the
        service.
      </P>
      <P>
        No system is perfectly secure. If a breach affects your personal information, we will tell
        you and the relevant authorities as required by law.
      </P>

      <H2>Your choices</H2>
      <UL>
        <li>
          <strong>Access and correction</strong> — you can view and edit your profile in the app,
          or ask us for a copy of what we hold.
        </li>
        <li>
          <strong>Deletion</strong> — email us and we will delete your account.
        </li>
        <li>
          <strong>Notifications</strong> — turn push notifications off in your device settings.
        </li>
        <li>
          <strong>Sessions</strong> — sign out on any device to end that session immediately.
        </li>
      </UL>

      <H2>Children</H2>
      <P>
        {OPERATOR.brand} is not intended for children under 13, and we do not knowingly collect
        their information. The Kids section contains titles suitable for younger viewers but is not
        a separate account type. If you believe a child has given us their information, contact us
        and we will remove it.
      </P>

      <H2>Changes</H2>
      <P>
        We will post any change to this policy on this page and update the date above. Material
        changes will be notified in the app.
      </P>

      <H2>Contact us</H2>
      <P>
        {OPERATOR.company}
        <br />
        {OPERATOR.city}
        <br />
        Email: <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
        <br />
        Phone: <a href={`tel:${OPERATOR.phone.replace(/\s/g, '')}`}>{OPERATOR.phone}</a>
      </P>
    </LegalPage>
  );
}
