import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  experimental: {
    // optimizePackageImports for fast icon tree-shaking
    optimizePackageImports: ['lucide-react'],
  },

  /**
   * Four headers, all of them free and all of them things every deploy of this
   * kit was silently missing. Nothing here needs a nonce or a per-request
   * hook, so there is no build-ordering trap — the one thing deliberately
   * absent is Content-Security-Policy: Next's inline bootstrap scripts need
   * either a nonce threaded through middleware or an unsafe-inline escape
   * hatch, and shipping a CSP that breaks the app is worse than shipping none.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Nothing served here is ever legitimately a script or stylesheet.
          // Without this, a browser may still sniff a .txt response into
          // executable JS.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Clickjacking: a framed dashboard puts the delete button under an
          // attacker's overlay. SAMEORIGIN rather than DENY so an operator can
          // still embed the marketing page on their own domain.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Keeps the session-bearing URL out of Referer headers on the
          // outbound links in the nav.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Only honoured over HTTPS, so a plain-http dev run is unaffected.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default nextConfig;
