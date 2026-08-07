import type { ReactNode } from 'react';

/**
 * Shared chrome for the policy pages.
 *
 * These exist to be read by two audiences: subscribers, and the reviewers at
 * Twilio and the US Campaign Registry who assess A2P 10DLC registrations.
 * The second audience is why the SMS sections are explicit and near the top
 * rather than buried — a policy that does not visibly state how mobile
 * numbers are handled is a routine cause of rejection.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main
      style={{
        maxWidth: 820,
        margin: '0 auto',
        padding: '40px 22px 90px',
        lineHeight: 1.65,
        color: 'var(--text-dim)',
      }}
    >
      <h1 style={{ color: 'var(--text)', fontSize: 30, marginBottom: 6 }}>{title}</h1>
      <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 0 }}>
        Last updated {updated}
      </p>
      <div style={{ marginTop: 28 }}>{children}</div>
    </main>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <h2 style={{ color: 'var(--text)', fontSize: 19, marginTop: 34, marginBottom: 10 }}>
      {children}
    </h2>
  );
}

export function P({ children, last }: { children: ReactNode; last?: boolean }) {
  return <p style={{ marginTop: 0, marginBottom: last ? 0 : 14 }}>{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul style={{ marginTop: 0, marginBottom: 16, paddingLeft: 22 }}>{children}</ul>;
}

export function Callout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid #2a2a2a',
        borderLeft: '3px solid var(--accent)',
        borderRadius: 4,
        background: 'var(--bg-raised)',
        padding: '14px 18px',
        margin: '18px 0 22px',
      }}
    >
      {children}
    </div>
  );
}

/**
 * Single source of truth for the operator details that appear in both
 * documents. A policy that contradicts itself between pages is worse than no
 * policy — and these details are cross-checked against the brand record
 * during A2P registration.
 */
export const OPERATOR = {
  brand: 'Muza Watch',
  // Must match the legal entity on the Twilio brand record exactly — a
  // mismatch between the name here and the one registered is a routine
  // rejection during A2P vetting.
  company: 'Pro Media Systems LLC',
  site: 'https://ham.sentepos.com',
  email: 'sales@prosystemsug.com',
  phone: '+1 224 373 0803',
  addressLine: '451 Verde Dr',
  cityState: 'Schaumburg, IL',
  country: 'United States',
};
