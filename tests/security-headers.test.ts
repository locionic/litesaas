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

test('HSTS lasts a year, and it covers the subdomains', async () => {
  // The value assertion above accepts any max-age of six or more digits. That is
  // enough to reject `max-age=0` — the browser's off switch — and nothing more,
  // so both edits that genuinely weaken the header pass it, and neither throws
  // nor breaks anything:
  //
  //   max-age=999999      about eleven days, after which the policy lapses and a
  //                       returning visitor is back to first-connect plaintext
  //   includeSubDomains   dropped, so the policy is pinned on the one host the
  //                       app runs on and nowhere else. Every other name under
  //                       the operator's domain can still be fetched over plain
  //                       HTTP, and a cookie scoped to the parent domain rides
  //                       along on that request.
  //
  // A year is what the config ships and what browsers preload. Written as the
  // literal, because a regex loose enough to pass at any value is a regex that
  // does not check one.
  const rules = await (config as { headers: () => Promise<unknown[]> }).headers();
  const hsts = rules
    .flatMap((r) => (r as { headers: { key: string; value: string }[] }).headers)
    .find((h) => h.key.toLowerCase() === 'strict-transport-security');

  assert.ok(hsts, 'the HSTS header is gone; this test needs revisiting');
  assert.match(hsts.value, /^max-age=31536000;/, `HSTS lifetime is "${hsts.value}", not the year it ships`);
  assert.match(
    hsts.value,
    /;\s*includeSubDomains\s*$/,
    `includeSubDomains is missing from "${hsts.value}"`
  );
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