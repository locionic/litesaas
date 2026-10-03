import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// `getCurrentUser` is the only thing in the app that decides who you are and
// what plan you have — the dashboard gates project creation on it and the
// landing page branches on it. The whole suite had exactly one assertion about
// it, and it was incidental (landing-cta.test.ts checks that the page *calls*
// it). Every property that makes it safe was unpinned, and each is one a
// "tidy this up" edit removes without a failing test:
//
//   1. The expiry check. Without it a leaked cookie authenticates forever: the
//      row is still there, the lookup still finds it, and the 30-day lifetime
//      the schema stores is never consulted. Reaping the row is the other half
//      — nothing else deletes an expired session, so skipping the delete grows
//      the table one dead row per sign-in, indefinitely.
//   2. The cookie flags. httpOnly keeps a session out of reach of any XSS;
//      Secure keeps it off plaintext HTTP. Secure must stay *conditional* —
//      hardcoding true means the cookie is silently dropped on every local
//      http://localhost dev run, and nobody logs in to find out why.
//   3. The try's boundaries. `cookies()` deliberately sits outside it: it is
//      what forces a route to be dynamic, and Next signals that by throwing
//      DynamicServerError during static generation. A catch-all swallows that
//      signal. The catch is for database faults, and it logs, because returning
//      null on a fault is indistinguishable from being logged out.
//   4. The plan fallback. `sub?.plan` without `|| 'free'` yields undefined, and
//      an undefined plan compares false against 'pro' and true against 'free'
//      in whichever direction the caller happens to write.
//
// Source assertions, because the module imports next/headers and the db and so
// cannot be imported under `node --test` — the same reason demo.test.ts and
// stripe-events.test.ts read source instead of calling in.

const auth = readFileSync(
  fileURLToPath(new URL('../src/lib/auth.ts', import.meta.url)),
  'utf8'
);

/** One exported function's body, from its signature to the next signature. */
const fn = (name: string): string => {
  const from = auth.indexOf(`export async function ${name}(`);
  assert.notEqual(from, -1, `${name} is gone; this test needs revisiting`);
  const to = auth.indexOf('\nexport ', from + 1);
  return auth.slice(from, to === -1 ? auth.length : to);
};

test('an expired session neither authenticates nor lingers', () => {
  const getCurrentUser = fn('getCurrentUser');

  // The schema stores expires_at with mode: 'timestamp', so the column is a
  // Date on read and this is the comparison — not a numeric coercion against a
  // column that is silently already milliseconds.
  const guard = getCurrentUser.indexOf('if (session.expiresAt.getTime() < Date.now())');
  assert.notEqual(guard, -1, 'the expiry check is gone; a stolen cookie now works forever');

  // Before anything that hands back a user, not merely before the return
  // statement: an expired session must not even reach the users table.
  //
  // Anchored on `subscriptionPlan: sub?.plan`, not on `subscriptionPlan:` —
  // the bare form also matches the return *type* on the signature line, which
  // sits above everything and would make this ordering assert nothing.
  assert.ok(
    guard < getCurrentUser.indexOf('subscriptionPlan: sub?.plan'),
    'the expiry check must run before a value-bearing return is built'
  );

  // Reaping has no other home in the app — createSession's sweep only runs on
  // the next sign-in, and the dashboard's getCurrentUser does not sign anyone in.
  const reap = getCurrentUser.indexOf('await db.delete(sessions)');
  assert.ok(reap > guard, 'the expired row must be deleted, not just rejected');
});

test('the session cookie is httpOnly, sameSite lax, and Secure in production only', () => {
  const cookie = fn('createSession');

  assert.match(cookie, /httpOnly: true/, 'a session readable from JS is one XSS away from stolen');
  assert.match(cookie, /sameSite: 'lax'/, 'a cross-site POST would otherwise carry the session');
  assert.match(cookie, /path: '\/'/, 'a narrower path silently drops the cookie on other routes');

  // The conditional is the point. `secure: true` fails closed and correct in
  // production and fails open-useless in development: the browser refuses to
  // store a Secure cookie off https, so the login round-trips, reports success,
  // and the next request arrives with no session at all.
  assert.match(cookie, /secure: process\.env\.NODE_ENV === 'production'/);

  // And the cookie must expire with the row, or the browser holds a live-looking
  // session cookie long after the server has reaped it.
  assert.match(cookie, /expires: expiresAt/);

  // …in a window that is only ever allowed to shrink. This value is written into
  // the row AND stamped on the cookie, so raising it raises how long a captured
  // token keeps authenticating — the session cookie's lifetime *is* the session
  // credential's lifetime. `3650` measured fail 0 against this file: the
  // one-character edit that ships a decade-long credential, silently, next to
  // httpOnly and sameSite assertions that look like the cookie is well defended.
  //
  // Asymmetric on purpose. `=== 30` would also forbid making sessions shorter,
  // which is the safe direction and should need no permission. `<= 30` lets every
  // day removed pass and stops every day added, so the test fires only on the
  // change someone has to argue for out loud.
  const days = Number(auth.match(/const SESSION_EXPIRY_DAYS = (\d+);/)?.[1]);
  assert.ok(
    days > 0 && days <= 30,
    `sessions now last ${days} days — a captured cookie authenticates for that long`
  );
});

test('the catch is for database faults, and it logs', () => {
  const getCurrentUser = fn('getCurrentUser');

  // `cookies()` is what makes the route dynamic, and Next discovers that by
  // throwing DynamicServerError mid-`next build`. A catch-all here swallows the
  // signal; letting it propagate hands the decision back to Next.
  const read = getCurrentUser.indexOf('const cookieStore = await cookies();');
  const guard = getCurrentUser.indexOf('\n  try {');
  assert.ok(read > -1 && guard > -1, 'the slice is wrong: cookies() or the try has moved');
  assert.ok(
    read < guard,
    'cookies() must be read outside the try, or static generation fails silently'
  );

  // Returning null on a database fault is indistinguishable from being logged
  // out, and the dashboard redirects to /login on null — so a transient
  // SQLITE_BUSY would sign every visitor out with nothing in the logs to find.
  const catchAt = getCurrentUser.indexOf('catch (err) {');
  assert.ok(catchAt > guard, 'the catch must belong to that try');
  assert.match(
    getCurrentUser.slice(catchAt),
    /console\.error\('getCurrentUser failed', err\)/,
    'a database fault must leave a trace'
  );
});

test('a user with no subscription row is on the free plan, not undefined', () => {
  // The row is not optional in the schema, but a user created before the free
  // tier was added has none, and the lookup is a findFirst — so this is a real
  // state, not a hypothetical. `sub?.plan` alone would hand the caller
  // undefined, which is neither plan.
  assert.match(fn('getCurrentUser'), /subscriptionPlan: sub\?\.plan \|\| 'free'/);
});

test('the session id is a CSPRNG value, not something cheaper to guess', () => {
  // The token *is* the credential. `httpOnly` stops script reading it and
  // `sameSite` stops other sites sending it, but every request to every route
  // presents it in the clear, and getCurrentUser resolves the whole user from
  // `eq(sessions.id, sessionId)` — so guessing one is logging in as its owner.
  //
  // The test above pins the cookie's flags and says nothing about what is in
  // it. `randomBytes` appeared nowhere in the suite, so all of these passed:
  //
  //   Math.random().toString(36)   ~52 bits from a non-cryptographic PRNG
  //   Date.now().toString()        sequential, and shared across every visitor
  //   randomBytes(8)               64 bits, brute-forceable given a few hundred
  //                                k requests and no rate limit on the lookup
  //
  // All three end the same way and none of them throws, so nothing else in the
  // app would notice.
  const create = fn('createSession');
  const minted = create.match(
    /const sessionId = (?:crypto\.)?randomBytes\((\d+)\)\.toString\(/
  );
  assert.ok(minted, 'the session id is not drawn from crypto.randomBytes; see the test header');

  // 16 bytes = 128 bits, the accepted floor for a bearer token. Checking the
  // number rather than the literal, so the constant stays free to be raised.
  const bytes = Number(minted[1]);
  assert.ok(
    bytes >= 16,
    `a ${bytes}-byte session id is below the 128-bit floor for a bearer credential`
  );

  // Scoped to the minting statement. `new Date()` on the line below is the
  // expiry and has nothing to do with the id.
  const statement = create.slice(create.indexOf('const sessionId'), create.indexOf(';'));
  assert.doesNotMatch(
    statement,
    /Math\.random|Date\.now/,
    'a non-cryptographic source makes every issued session predictable'
  );
});

test('the cookie carries the session id, never the user id', () => {
  // Two values in this function and they must not be confused. The id is a
  // lookup key that grants exactly one account; the userId is the account. Put
  // the wrong one in the cookie and signing in as anyone is a matter of typing
  // their address — no guessing, no entropy, nothing for any of the tests
  // above to notice. It is a plausible edit, because both are ids and both are
  // in scope.
  const create = fn('createSession');

  // The same value has to be stored and sent, or getCurrentUser's lookup finds
  // nothing and every sign-in silently fails closed.
  assert.match(
    create,
    /id: sessionId/,
    'the row must be keyed by the id that goes in the cookie'
  );
  assert.match(
    create,
    /cookieStore\.set\(COOKIE_NAME, sessionId/,
    'the cookie must carry the session id'
  );

  assert.doesNotMatch(
    create,
    /set\(COOKIE_NAME,\s*userId/,
    'a cookie holding the user id is an account switcher, not a session'
  );
});

test('signing out revokes the row server-side, and says so when it cannot', () => {
  // Logout had no assertions anywhere in the suite. The action reads the cookie,
  // deletes the matching row, and clears the cookie — and the delete was wrapped
  // in a bare `catch {}` whose comment claimed it was for "already deleted".
  //
  // It never was. DELETE against a row that is not there removes zero rows and
  // does not throw, so that catch could only ever be catching something else:
  // SQLITE_BUSY past the 5s busy_timeout this repo sets, a full disk, a
  // read-only bind mount. Every one of those left the session row alive with its
  // full 30-day expiry while `cookieStore.delete` below it ran regardless — so
  // the user saw a signed-out app and a token captured beforehand still
  // authenticated. Silent, on the one control that must fail closed loudly.
  const destroy = fn('destroySession');

  // The row goes, not just the browser's copy of it. Without this, signing out
  // on a shared machine leaves a working credential behind.
  assert.match(
    destroy,
    /db\.delete\(sessions\)\.where\(eq\(sessions\.id, sessionId\)\)/,
    'signing out must revoke the session row, not only clear the cookie'
  );

  // The reason the catch exists is a guess, and a wrong one. Assert the trace,
  // which is what was missing.
  const caught = destroy.indexOf('catch');
  assert.notEqual(caught, -1, 'the delete is no longer guarded; revisit this test');
  assert.match(
    destroy.slice(caught),
    /console\.error\(/,
    'a failed revocation must leave a trace — the user is shown a signed-out app regardless'
  );

  // And the cookie is cleared *after* the handler, not skipped by it: on the
  // failure path the row is still live, and leaving the browser holding it is
  // how "I signed out" becomes untrue without the user finding out.
  assert.ok(
    caught < destroy.indexOf('cookieStore.delete(COOKIE_NAME)'),
    'the cookie must be cleared after the failure handler, not inside the try'
  );
});
test('createSession is the only place expired session rows die', () => {
  // The counterpart to the expiry check above, and the half that is easy to lose:
  // `getCurrentUser` reaps the single row it happens to be holding, so it tidies
  // the rows a returning visitor happens to present and nothing else. Every other
  // dead session — signed out from a different device, closed the laptop, never
  // came back — is left behind, and drop the delete below and the table grows by
  // one dead row per sign-in for the life of the database.
  //
  // Nothing reports it. A dead row is invisible: no read path returns it, the
  // dashboard never shows it, and the file just quietly outgrows the image it was
  // deployed with. Sweeping the whole suite for a mutation that deletes this line
  // found no failing test, which is the only reason it is here.
  const create = fn('createSession');
  const reap = create.search(/delete\(sessions\)\.where\(lt\(sessions\.expiresAt/);
  assert.notEqual(reap, -1, 'nothing else deletes an expired session; without this the table grows forever');

  // …and it happens before the insert. Measured, not assumed: with the predicate
  // as written this is not load-bearing — the row just inserted expires in 30
  // days, so `lt(expiresAt, new Date())` cannot match it from either side of the
  // statement. What it binds is a future edit — a shorter session lifetime, or a
  // reaper widened to something other than "already expired" — where the order
  // would start to matter and nothing else would notice.
  assert.ok(
    reap < create.indexOf('insert(sessions)'),
    'expired rows are reaped after the insert, which reaps the session just created'
  );
});
