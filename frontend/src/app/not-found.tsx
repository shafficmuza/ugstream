import Link from 'next/link';

/**
 * The 404 page.
 *
 * Reached by `notFound()` from a page whose subject the API will not serve —
 * most often a title that is not in this viewer's catalogue. It deliberately
 * does not say which of the two it is: "no such title" and "not yours to see"
 * are the same answer to anyone holding a guessed URL.
 *
 * Without this file Next renders its own bare default, which on a streaming
 * site reads as breakage rather than as a missing page.
 */
export default function NotFound() {
  return (
    <main className="page">
      <h1 className="page-title">Not found</h1>
      <p className="empty-state">
        This page isn&apos;t here — the link may be old, or the title may not be available.
        <br />
        <Link href="/" style={{ textDecoration: 'underline' }}>
          Back to home
        </Link>
      </p>
    </main>
  );
}
