import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import config from '../next.config.ts';

// Run: npm test
//
// A starter kit that calls itself production-ready shipped no security headers
// at all, so every deploy inherited that. They cost nothing and involve no
// nonce or per-request hook, but "we added some once" is exactly the kind of
// thing a later edit to next.config.ts quietly drops.
//
// What is deliberately NOT pinned here: Content-Security-Policy. Next's inline
// bootstrap scripts need a nonce threaded through middleware or an
// unsafe-inline escape hatch. Getting that wrong breaks the app in a way far
// more expensive than the header it was meant to add, so it is a deliberate
// omission rather than a gap — see the comment in next.config.ts.

const code = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const nextConfig = code('../next.config.ts');

test('every response carries the baseline security headers', async () => {
  const rules = await (config as { headers: () => Promise<unknown[]> }).headers();
  const all = rules.flatMap((r) => (r as { headers: { key: string; value: string }[] }).headers);
  const byKey = new Map(all.map((h) => [h.key.toLowerCase(), h.value]));

  // Clickjacking: a framed dashboard puts the delete button under an overlay.
  assert.equal(byKey.get('x-frame-options'), 'SAMEORIGIN');
  // A .txt response sniffed into executable JS.
  assert.equal(byKey.get('x-content-type-options'), 'nosniff');
  // The session-bearing URL must not ride along in Referer to the blog and
  // GitHub links in the nav.
  assert.equal(byKey.get('referrer-policy'), 'strict-origin-when-cross-origin');
  // Only honoured over HTTPS, so a plain-http dev run is unaffected.
  assert.match(byKey.get('strict-transport-security') ?? '', /max-age=\d{6,}/);
});

test('the headers apply to every route, not a hand-picked few', () => {
  // `/:path*` is the difference between a hardened app and a hardened home
  // page; /api and /dashboard are where the session cookie matters.
  assert.match(nextConfig, /source: '\/:path\*'/);
});

test('a header cannot be added that this app has not earned', () => {
  // CSP is the one that looks free and is not — see the file header. Adding one
  // here means the inline scripts in the built app have to keep working, which
  // means a nonce threaded through middleware. Fail loudly rather than shipping
  // a policy that silently breaks every page.
  assert.doesNotMatch(nextConfig, /Content-Security-Policy/);
});