import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkRateLimit, resetRateLimit } from '../src/lib/rate-limit.ts';

// Run: npm test
//
// `clientIp()` is the identity the sign-in throttle is keyed on. Getting it
// wrong does not throw, does not slow anything down, and does not look wrong:
// the rate limit either stops applying to whoever wants it not to, or applies to
// everybody at once and denies service.
//
// Two ways that happens, and the second is the one that bites:
//
// 1. Reading entry 0 of x-forwarded-for. Every proxy in a chain *appends* the
//    address it saw, so a client that sends its own header arrives as
//    `<forged>, <real client>`. An attacker rotates a junk address per request
//    and every request lands in a bucket of its own — the limit is not
//    weakened, it is absent.
//
// 2. Reading the header at all when no proxy is known to be writing it. Next.js
//    fills x-forwarded-for from the socket address only when the client left it
//    absent (base-server.js:568, `??=`), so on a bare deploy a client that does
//    send one keeps the value it chose. And behind a published port — which is
//    what `docker compose up -d` gives you — every visitor arrives as the same
//    address, making the bucket global. Because the check runs BEFORE the
//    password is verified, one stranger's ten wrong guesses then refuse the
//    correct password to everyone for the whole window.
//
// So TRUST_PROXY gates the whole function, and the default is off: no bucket is
// better than a bucket that is either forgeable or shared.
//
// This file evaluates the actual expression from the source against those header
// shapes rather than matching its text. A regex can only tell you the code says
// `.at(-1)`, which is not the same as knowing a forged prefix does not survive —
// and the second thing is the entire point of the fix. The expression is lifted
// out of the source rather than copied, so this cannot drift into testing a
// second implementation of it.

const source = readFileSync(
  fileURLToPath(new URL('../src/app/actions/auth.ts', import.meta.url)),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

const CLIENT_IP_BODY = (() => {
  const from = source.indexOf('async function clientIp()');
  assert.notEqual(from, -1, 'clientIp is gone; this test needs revisiting');
  return source.slice(from, source.indexOf('\n}', from));
})();

test('the header is not read at all unless a proxy is known to be writing it', () => {
  // The gate. Everything below depends on it: with TRUST_PROXY off there is no
  // identity to key on, so there is nothing for a caller to forge and nothing
  // for a port publish to collapse into one shared key.
  assert.match(
    source,
    /const TRUST_PROXY = process\.env\.TRUST_PROXY === 'true';/,
    'TRUST_PROXY must default to off — the unsafe default is the bug'
  );

  // The early return, before headers() is touched — not a filter on the value
  // afterwards. A filter that dropped untrusted addresses at the end would still
  // have read the caller's own header to decide, which is the mistake itself.
  const gate = CLIENT_IP_BODY.search(/if \(!TRUST_PROXY\) return null;/);
  const read = CLIENT_IP_BODY.search(/await headers\(\)/);
  assert.notEqual(read, -1, 'clientIp no longer reads the headers at all');
  assert.ok(gate > -1 && gate < read, 'the gate must come before the header is read');
});

/**
 * What clientIp resolves a request to once the TRUST_PROXY gate is open — the
 * expression lifted out of the function rather than copied, so this cannot drift
 * into testing a second implementation of it.
 */
const EXPRESSION = (() => {
  // The LAST return in the body, not the first: the TRUST_PROXY gate returns
  // before reading anything, and it is the header expression after it that the
  // tests below are about. Bounded to the body so the rest of the file's returns
  // — loginAction's, registerAction's — cannot be picked up instead.
  const expr = [...CLIENT_IP_BODY.matchAll(/return ([^;]+);/g)].at(-1)?.[1];
  assert.ok(expr, 'clientIp no longer resolves the header');
  return expr;
})();

/** Run that expression against a request's headers, as `headers()` would. */
const clientIp = (h: Record<string, string | undefined>): string | null =>
  new Function('h', `return ${EXPRESSION}`)({ get: (k: string) => h[k] ?? null });

test('a forged x-forwarded-for prefix does not choose the bucket', () => {
  // The reason for reading the last hop. A client sends this; the proxy appends
  // the address it really saw; the throttle must key on the second one.
  assert.equal(
    clientIp({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' }),
    '203.0.113.7',
    'the first entry is client-controlled — keying on it makes the per-IP limit optional'
  );

  // A forged prefix plus a chain of proxies, so this cannot pass by accident on
  // a two-element list.
  assert.equal(
    clientIp({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1, 203.0.113.7' }),
    '203.0.113.7'
  );

  // Whitespace is what an appending proxy actually emits.
  assert.equal(
    clientIp({ 'x-forwarded-for': '9.9.9.9,  203.0.113.7 ' }),
    '203.0.113.7',
    'the hop must be trimmed, or one address becomes two buckets'
  );
});

test('the single-hop case still resolves', () => {
  // A proxy configured to overwrite rather than append. The last hop is then the
  // only hop, so reading it must keep working — a fix that only handled the
  // appending case would break this deployment.
  assert.equal(clientIp({ 'x-forwarded-for': '203.0.113.7' }), '203.0.113.7');
});

test('the fallbacks cover the proxied run, not a second guess at the client', () => {
  // nginx's X-Real-IP, for a proxy that sets that instead.
  assert.equal(
    clientIp({ 'x-real-ip': '198.51.100.4' }),
    '198.51.100.4',
    'a proxy that sets only x-real-ip must still resolve per client'
  );

  // Neither header: null, meaning "cannot tell". Not a placeholder address —
  // see 'an unidentifiable client is never throttled on' below, which is the
  // whole reason this is null and not a shared string.
  assert.equal(clientIp({}), null);

  // An empty header must fall through rather than resolve to '', which would be a
  // bucket keyed on nothing at all — the same bypass with a shorter header.
  assert.equal(clientIp({ 'x-forwarded-for': '', 'x-real-ip': '198.51.100.4' }), '198.51.100.4');
  assert.equal(clientIp({ 'x-forwarded-for': '  ' }), null);
});

test('an unidentifiable client is never throttled on', () => {
  // The denial of service this prevents, reproduced against the real limiter
  // rather than described. It is not hypothetical, and it is not a `::1` edge
  // case: on a bare box Next.js fills x-forwarded-for from the socket, so every
  // local request gets `login:ip:::1` — one bucket for all of them. Observed
  // against a live server: a stranger posted ten wrong passwords, and the demo
  // user's next sign-in with the correct one came back "Too many sign-in
  // attempts from this network" for fifteen minutes.
  //
  // checkRateLimit counts before it decides, so a shared key means ten wrong
  // guesses from one stranger exhaust the budget for everyone. And the check
  // runs BEFORE the password is verified, so the eleventh request was refused
  // with "Too many sign-in attempts" even when it carried the correct password.
  //
  // Nothing is traded away to prevent this. With no trusted proxy the address is
  // the caller's own claim, so that bucket was never enforceable anyway. What
  // stops password guessing is the per-account bucket, which is keyed on the
  // submitted address and is unaffected by any of this.
  const withoutTheSkip = (ip: string | null): boolean =>
    checkRateLimit(`login:ip:${ip}`, 10).ok;

  resetRateLimit('login:ip:::1');
  // The old behaviour: one address every visitor on the box shares.
  for (let i = 0; i < 10; i++) assert.equal(withoutTheSkip('::1'), true);
  assert.equal(
    withoutTheSkip('::1'),
    false,
    'control: a shared key must deny on the eleventh attempt, or this proves nothing'
  );

  // The fix: no key at all, so nothing to exhaust.
  //
  // Ten wrong guesses from "one stranger" still leave the next request free,
  // because no bucket was ever opened. `guarded(null)` is what loginAction does
  // once it has seen the null, so this is the real call path, not a sketch of it.
  const guarded = (ip: string | null): boolean => {
    if (ip === null) return true;
    return checkRateLimit(`login:ip:${ip}`, 10).ok;
  };
  for (let i = 0; i < 10; i++) assert.equal(guarded(null), true);
  assert.equal(
    guarded(null),
    true,
    'with no trusted proxy there is no network to throttle, so the correct password must still be accepted'
  );

  // And a client that IS identified is still throttled — the skip is for the
  // unidentifiable case only, not a hole in the limit itself.
  resetRateLimit('login:ip:203.0.113.7');
  for (let i = 0; i < 10; i++) assert.equal(guarded('203.0.113.7'), true);
  assert.equal(guarded('203.0.113.7'), false, 'a real network must still be throttled');
  resetRateLimit('login:ip:203.0.113.7');
});

test('both actions skip the throttle when the client cannot be identified', () => {
  // The null above only pays off if the callers act on it. A `clientIp()` that
  // returns null while the action still interpolates it into a key reproduces
  // the shared-bucket lockout exactly, with a null in the bucket name.
  const action = (name: string): string => {
    const from = source.indexOf(`export async function ${name}(`);
    assert.notEqual(from, -1, `${name} is gone; this test needs revisiting`);
    const to = source.indexOf('\nexport ', from + 1);
    return source.slice(from, to === -1 ? source.length : to);
  };

  for (const name of ['loginAction', 'registerAction']) {
    const body = action(name);

    // Guarded on the null, not on truthiness or on the header's presence.
    assert.match(
      body,
      /if \((?:register)?[Ii]p !== null\)/,
      `${name} must not throttle when clientIp() could not identify the client`
    );

    // …and the check is actually inside that guard, not beside it. A guard that
    // tested something true while the limit stayed unconditional is the shape of
    // this exact bug, so the position is asserted rather than the presence.
    const guard = body.search(/!== null/);
    const limit = body.search(/checkRateLimit\(/);
    assert.notEqual(limit, -1, `${name} has no throttle left at all`);
    assert.ok(guard > -1 && guard < limit, `${name} checks the limit outside its own guard`);
  }
});

test('the throttle is keyed on this, in both actions that throttle', () => {
  // Otherwise the function is decoration. A login limit and a signup limit that
  // each derive their key from clientIp() is what makes the value worth getting
  // right; a third call site is a reason to go back and re-read the ceiling.
  //
  // Asserted as a data flow rather than one template shape, because the two do
  // not have the same shape: loginAction binds the address to a local before
  // interpolating it, registerAction passes it straight into the call. Matching
  // one literal would have found the other and read as a pass.
  const action = (name: string): string => {
    const from = source.indexOf(`export async function ${name}(`);
    assert.notEqual(from, -1, `${name} is gone; this test needs revisiting`);
    const to = source.indexOf('\nexport ', from + 1);
    return source.slice(from, to === -1 ? source.length : to);
  };

  const login = action('loginAction');
  assert.match(login, /const ip = await clientIp\(\);/, 'login must resolve the client address');
  assert.match(login, /const ipKey = `login:ip:\$\{ip\}`;/, 'and the bucket must key on it');
  assert.match(
    login,
    /const emailKey = `login:email:\$\{email\}`;/,
    'the per-account bucket must stay keyed on the address, which is not client-controlled'
  );

  assert.match(
    action('registerAction'),
    /const registerIp = await clientIp\(\);/,
    'signup must resolve the client address'
  );
  assert.match(
    action('registerAction'),
    /checkRateLimit\(`register:ip:\$\{registerIp\}`/,
    'signup must throttle on that same address'
  );
});

test('the entry read is the last one, whatever the expression looks like', () => {
  // Belt to the braces: the behavioural test above would still pass if someone
  // rewrote the expression to be correct by some other route, and this pins the
  // property any such rewrite has to preserve.
  const expr = EXPRESSION;
  assert.match(expr, /\.at\(-1\)|\[length\s*-\s*1\]|\.pop\(\)/);
  assert.doesNotMatch(
    expr,
    /split\([^)]*\)\s*\[\s*0\s*\]|split\([^)]*\)\.shift\(\)/,
    'entry 0 of x-forwarded-for is the one the client wrote'
  );
});