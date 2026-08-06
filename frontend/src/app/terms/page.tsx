import type { Metadata } from 'next';
import { LegalPage, H2, P, UL, Callout, OPERATOR } from '../legal/legal';

export const metadata: Metadata = {
  title: `Terms and Conditions — ${OPERATOR.brand}`,
  description: `The terms on which you use ${OPERATOR.brand}, including our SMS messaging terms.`,
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms and Conditions" updated="7 August 2026">
      <P>
        These terms govern your use of {OPERATOR.brand}, a subscription video streaming service
        operated by {OPERATOR.company} of {OPERATOR.city}. By creating an account you agree to them.
      </P>

      <H2>SMS messaging terms</H2>
      <Callout>
        <P>
          <strong>Programme:</strong> {OPERATOR.brand} sends a one-time passcode by SMS so you can
          sign in to your account. This is the only kind of text message we send. We do not send
          marketing or promotional messages.
        </P>
        <P>
          <strong>How you opt in:</strong> you consent to receive these messages by entering your
          phone number on our sign-in screen and requesting a code. Consent is not a condition of
          any purchase.
        </P>
        <P>
          <strong>Message frequency:</strong> messages are sent only when you request a code —
          typically one message per sign-in, and no more than 10 per day per number.
        </P>
        <P>
          <strong>Cost:</strong> message and data rates may apply. We do not charge you for these
          messages; your mobile carrier may.
        </P>
        <P>
          <strong>To stop:</strong> reply <strong>STOP</strong> to any message to opt out. You will
          receive a confirmation, and no further messages. Because the code is how you sign in,
          opting out means you will not be able to sign in by SMS; contact support and we will help
          you regain access.
        </P>
        <P>
          <strong>For help:</strong> reply <strong>HELP</strong>, or contact us at{' '}
          <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a> or{' '}
          <a href={`tel:${OPERATOR.phone.replace(/\s/g, '')}`}>{OPERATOR.phone}</a>.
        </P>
        <P last>
          <strong>Carriers:</strong> mobile carriers are not liable for delayed or undelivered
          messages. See our <a href="/privacy">Privacy Policy</a> for how we handle your number.
        </P>
      </Callout>

      <H2>Your account</H2>
      <P>
        Your account is identified by your phone number and secured by a one-time code sent to it.
        You are responsible for the phone number on your account and for anything done through it.
        Tell us immediately if you lose control of that number.
      </P>
      <P>
        Your account is for you and your household. You may not sell, share or transfer it. To
        support this, your plan limits how many devices may stay signed in and how many may stream
        at the same time; signing in beyond the device limit ends the least recently used session.
      </P>

      <H2>Subscriptions and payment</H2>
      <UL>
        <li>
          Plans are offered on daily, weekly and monthly terms at the prices shown in the app at the
          time of purchase.
        </li>
        <li>
          Access begins once payment is confirmed and ends when the period expires. Plans do not
          renew automatically unless the app states otherwise at checkout.
        </li>
        <li>
          Payment is taken by our payment providers. We do not receive or store your card number or
          mobile-money PIN.
        </li>
        <li>
          Prices may change. A change never affects a period you have already paid for.
        </li>
      </UL>

      <H2>Refunds</H2>
      <P>
        If you were charged and did not receive access, contact us and we will restore your access
        or refund you. Beyond that, payments are generally non-refundable once a viewing period has
        begun, except where the law requires otherwise.
      </P>

      <H2>What you may and may not do</H2>
      <P>
        We grant you a personal, non-exclusive, non-transferable licence to stream our content for
        private, non-commercial viewing during your subscription. You may not:
      </P>
      <UL>
        <li>record, download, copy, redistribute or publicly show any title;</li>
        <li>circumvent any security, geographic or access restriction;</li>
        <li>share your account credentials or sign-in codes with anyone;</li>
        <li>use automated means to access, scrape or index the service.</li>
      </UL>
      <P>
        All titles remain the property of their rights holders. Nothing here transfers ownership of
        anything to you.
      </P>

      <H2>Availability</H2>
      <P>
        We work to keep the service running, but we do not guarantee uninterrupted availability.
        Titles may be added or removed as licensing changes. Streaming quality depends on your
        internet connection and device.
      </P>

      <H2>Suspension</H2>
      <P>
        We may suspend or close an account that breaches these terms, in particular one used for
        redistribution or shared beyond a household. Where it is reasonable to do so, we will tell
        you why.
      </P>

      <H2>Liability</H2>
      <P>
        The service is provided as it is. To the fullest extent the law allows, we are not liable
        for indirect or consequential loss, and our total liability to you is limited to what you
        paid us in the three months before the claim. Nothing here limits liability that cannot
        lawfully be limited.
      </P>

      <H2>Changes to these terms</H2>
      <P>
        We may update these terms, and will post the current version on this page with the date
        above. Continuing to use the service after a change means you accept it.
      </P>

      <H2>Governing law</H2>
      <P>
        These terms are governed by the laws of the Republic of Uganda, and the courts of Uganda
        have jurisdiction over any dispute.
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
