/**
 * Where the browser sends API calls: the origin it is already on.
 *
 * The site now answers on more than one domain (muzawatch.com is the live
 * site, ham.sentepos.com the dev/test one), and every domain's nginx proxies
 * /api/ to the same backend. A build-time absolute URL would pin every
 * browser to one domain regardless of which one served the page — sending
 * muzawatch.com visitors cross-origin to ham, where the refresh cookie the
 * server-rendered pages depend on does not follow.
 *
 * The https check keeps local development working: `next dev` has no nginx in
 * front of it, so there the env base still points wherever the API really is.
 * Server-side rendering always uses the env base — it runs on the box, not in
 * anyone's browser.
 */
export const API_BASE =
  typeof window !== 'undefined' && window.location.protocol === 'https:'
    ? `${window.location.origin}/api/v1`
    : process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4001/v1';
