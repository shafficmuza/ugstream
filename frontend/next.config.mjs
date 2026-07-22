/** @type {import('next').NextConfig} */
const nextConfig = {
  // Deployed natively via PM2 + `next start` (not Docker) — "standalone"
  // output is a pruned bundle meant for a container image and doesn't work
  // with `next start`.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default nextConfig;
