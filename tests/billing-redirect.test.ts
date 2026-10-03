import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// `redirect()` in the App Router THROWS a NEXT_REDIRECT error rather than
// returning (next/dist/client/components/redirect.js). So a redirect() placed
// inside a try whose catch is a catch-all never reaches the browser — the catch
// swallows it and redirects somewhere else. On the billing path that means a
// *successful* Stripe checkout session sends the user to "?billing=error"
// instead of the checkout page, and the customer can never pay.
//
// These tests read the action as text and assert the structure, because the
// bug is invisible to unit tests: the action's happy path only misbehaves when
// a real payment provider is configured.
//
// The three at the bottom are a different shape. They guard the free dev
// upgrade — the last statement in the action, the one that writes `plan: 'pro'`
// with no payment provider involved — and the origin guard in front of it,
// because both are only reachable by a route a real deployment never takes, so
// nothing exercises them and nothing else in the suite looks at them either.

const ACTION = fileURLToPath(new URL('../src/app/actions/billing.ts', import.meta.url));
const src = readFileSync(ACTION, 'utf8');
const dashboard = readFileSync(
  fileURLToPath(new URL('../src/app/dashboard/page.tsx', import.meta.url)),
  'utf8'
);

/** The banner JSX for `billing=<value>`, or '' if the page renders none. */
const banner = (value: string): string => {
  const from = dashboard.indexOf(`params.billing === '${value}'`);
  if (from < 0) return '';
  const to = dashboard.indexOf('</div>', from);
  assert.ok(to > from, `the ${value} banner is never closed`);
  return dashboard.slice(from, to);
};

/**
 * Walk every `try {` block. Throws if a redirect() appears inside one, since
 * that redirect can only ever be reached by the catch swallowing it.
 *
 * A redirect in the `catch` body is fine — that's the intended way out — so
 * `} catch {` (which both closes the try and opens the catch) ends the block.
 */
function assertNoRedirectInsideTry(source: string): Array<{ start: number; end: number }> {
  const lines = source.split('\n');
  const blocks: Array<{ start: number; end: number }> = [];
  let depth: number | null = null;
  let start = 0;

  const braces = (line: string) => (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

  lines.forEach((line, i) => {
    if (depth === null) {
      if (/\btry\s*\{/.test(line)) {
        depth = braces(line);
        start = i;
      }
      return;
    }
    if (/^\s*\}\s*(catch|finally)\b/.test(line)) {
      blocks.push({ start, end: i - 1 });
      depth = null;
      return;
    }
    if (/\bredirect\s*\(/.test(line)) {
      throw new Error(`redirect() on line ${i + 1} is inside the try opened on line ${start + 1}`);
    }
    depth += braces(line);
    if (depth <= 0) {
      blocks.push({ start, end: i });
      depth = null;
    }
  });

  return blocks;
}

test('no redirect() is reachable only through a catch-all', () => {
  const blocks = assertNoRedirectInsideTry(src);
  assert.ok(blocks.length >= 2, `expected both provider branches wrapped in try, found ${blocks.length}`);
});

test('the guard would have caught the original bug', () => {
  // Prove the scan is non-vacuous by feeding it the exact shape we removed.
  assert.throws(
    () =>
      assertNoRedirectInsideTry(`async function a() {
  try {
    const s = await api.create();
    if (s.url) {
      redirect(s.url);
    }
  } catch {
    redirect('/dashboard?billing=error');
  }
}`),
    /redirect\(\) on line 5 is inside the try opened on line 2/
  );
});

test('the success redirect happens after the try/catch, not inside it', () => {
  const successRedirect = src.indexOf('redirect(checkoutUrl)');
  const lastTryEnd = assertNoRedirectInsideTry(src).at(-1)!.end;

  assert.ok(successRedirect > lastTryEnd, 'checkoutUrl must be redirected after the last try block closes');
  assert.match(src, /checkoutUrl = await createCheckout\(/, 'LemonSqueezy must be wrapped in try (it throws)');
  assert.match(src, /checkoutUrl = session\.url/, 'Stripe session must be captured, not redirected inline');
});

test('the production fall-through tells the truth about what is missing', () => {
  // The LemonSqueezy branch always exits through one of its own redirects, so
  // the fall-through is only reachable with BILLING_PROVIDER=stripe. Its guard
  // then fails for exactly two reasons: `stripe` is null, or the price id is
  // empty. One banner served both, and it named STRIPE_SECRET_KEY — which is
  // precisely what the second case has already set. The operator was sent to
  // configure the variable they had configured.
  assert.match(
    src,
    /redirect\(stripe \? '\/dashboard\?billing=price' : '\/dashboard\?billing=unconfigured'\)/,
    'the two causes must not share one redirect'
  );

  // And the page must actually render the one it now sends, or the operator
  // gets a bare query string and no explanation at all.
  const price = banner('price');
  assert.ok(price, 'no banner is rendered for ?billing=price');
  assert.match(price, /NEXT_PUBLIC_STRIPE_PRO_PRICE_ID/);
  assert.match(price, /rebuild/i, 'the price id is a build arg; a restart cannot pick it up');
});

test('the two banners name disjoint causes', () => {
  // Guarding the other side of the line. "Set STRIPE_SECRET_KEY" is only true
  // advice on the branch that sends an operator there; the price advice lives
  // in exactly one banner. Disjointness, rather than matching on wording, so
  // rewording a banner cannot quietly make the two swap meanings.
  const unconfigured = banner('unconfigured');
  assert.ok(unconfigured, 'no banner is rendered for ?billing=unconfigured');
  assert.match(unconfigured, /STRIPE_SECRET_KEY/);

  const price = banner('price');
  assert.match(price, /NEXT_PUBLIC_STRIPE_PRO_PRICE_ID/);
  assert.doesNotMatch(
    unconfigured,
    /NEXT_PUBLIC_STRIPE_PRO_PRICE_ID/,
    'with no key at all, the price id is the second problem, not the first'
  );

  // The `error` banner is allowed to name both — a rejection can be caused by
  // either placeholder — so it is deliberately outside this constraint.
  assert.match(banner('error'), /STRIPE_SECRET_KEY[\s\S]*NEXT_PUBLIC_STRIPE_PRO_PRICE_ID/);
});

test('both return URLs are built from the one origin this file declares', () => {
  // `origin` is an ambient global: lib.dom.d.ts declares `var origin: string`,
  // and this tsconfig includes "dom" in `lib`. So a `${origin}` left behind
  // after the local was renamed type-checks cleanly — tsc resolves it to the
  // global — and `node --test` strips types without checking them at all, so
  // nothing else in this suite would notice. At runtime `globalThis.origin` is
  // undefined, so the customer is handed "undefined/dashboard" as a cancel
  // address. This is the only assertion in the file that can catch it.
  assert.doesNotMatch(src, /\$\{origin\}/, '`origin` here would bind the DOM global, not a declared local');

  // Both Stripe URLs, not just the success one: cancel_url sits next to
  // success_url and is the easier of the pair to leave behind.
  assert.match(src, /success_url: successUrl,/, 'success_url must use the shared constant');
  assert.match(src, /cancel_url: `\$\{appOrigin\}\/dashboard`,/, 'cancel_url must use the same origin');

  // And the constant they share has to exist, or both URLs are ambient too.
  assert.match(
    src,
    /const appOrigin = process\.env\.NEXT_PUBLIC_APP_URL \|\| 'http:\/\/localhost:3000';/,
    'the origin both URLs derive from must be declared, not inherited from the DOM lib'
  );
  assert.match(src, /const successUrl = `\$\{appOrigin\}\/dashboard\?upgraded=true`;/);
});

test('checkout refuses to start when the webhook cannot deliver it', () => {
  // `checkout.session.completed` is the only thing that turns a paid order into
  // Pro. With no usable signing secret every delivery fails verification, Stripe
  // retries for days, and the customer is charged for a plan that never
  // arrives — while ?upgraded=true tells them to wait for the webhook.
  const guard = src.indexOf('isRealSecret(process.env.STRIPE_WEBHOOK_SECRET)');
  assert.notEqual(guard, -1, 'the Stripe arm must check the webhook signing secret');
  assert.ok(
    guard < src.indexOf('checkout.sessions.create'),
    'the check has to come before the session is created, not after'
  );

  // The placeholder-aware predicate, not `!process.env.STRIPE_WEBHOOK_SECRET`:
  // `whsec_...` is non-empty, so a truthiness test passes on exactly the deploy
  // that is broken. Proved against .env.example in tests/plans.test.ts.
  assert.doesNotMatch(src, /if \(!process\.env\.STRIPE_WEBHOOK_SECRET\)/);

  const webhook = banner('webhook');
  assert.ok(webhook, 'no banner is rendered for ?billing=webhook');
  assert.match(webhook, /STRIPE_WEBHOOK_SECRET/);
  assert.match(webhook, /\/api\/webhooks\/stripe/, 'an operator needs the endpoint to register in Stripe');

  // A runtime variable, so restarting is enough. Telling the operator to
  // rebuild — which the price banner must, for a NEXT_PUBLIC_* build arg — sends
  // them off to do something that cannot possibly work.
  assert.doesNotMatch(webhook, /rebuild/i, 'STRIPE_WEBHOOK_SECRET is read at runtime; a rebuild changes nothing');
  assert.match(banner('price'), /rebuild/i);
});

/**
 * `redirectIfLocalOrigin`'s condition, lifted and run.
 *
 * Both operands are side-effect-free — an env read and a regex test — so the
 * decision can be replayed without a request or a `redirect()` that throws. The
 * three loopback spellings all have to be refused and only one of them is the
 * spelling `.env.example` ships, which is what makes the other two easy to drop.
 */
const originGuard = (): ((process: unknown, appOrigin: string) => boolean) => {
  const from = src.indexOf('function redirectIfLocalOrigin()');
  assert.notEqual(from, -1, 'redirectIfLocalOrigin is gone; this test needs revisiting');
  const condition = src.slice(from).match(/if \(\s*([\s\S]*?)\s*\)\s*\{/);
  assert.ok(condition, 'redirectIfLocalOrigin no longer guards on a bare condition');
  return new Function(
    'process',
    'appOrigin',
    `return ${condition[1]};`
  ) as (process: unknown, appOrigin: string) => boolean;
};

/** The lifted guard, as a plain predicate. `process` is faked so the env read is real. */
const refuse = (env: string, origin: string): boolean =>
  originGuard()({ env: { NODE_ENV: env } }, origin);

test('every spelling of loopback is refused, not just the one .env.example ships', () => {
  // The shipped value, and the two operators hand-write instead. Dropping either
  // alternative from the regex looks like tidying: it matches every origin in
  // the example env, every test above, and every checkout anyone has run.
  for (const origin of [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
    'https://localhost',
    'http://127.0.0.1',
  ]) {
    assert.equal(refuse('production', origin), true, `a paid customer would be sent to ${origin}`);
  }

  // And the check is a test of the whole origin, not a prefix match. `localhost`
  // opening someone else's host is not this machine.
  assert.equal(refuse('production', 'http://localhost.attacker.example'), false);
  assert.equal(refuse('production', 'http://app.example.com'), false, 'a real origin must be allowed');

  // Dev is untouched: `npm run dev` upgrades with no variables set at all.
  assert.equal(refuse('development', 'http://localhost:3000'), false);

  // Equality, never truthiness. NODE_ENV is always set by next dev and next
  // start, so a falsy test refuses localhost in dev and allows it in production
  // — the guard inverts exactly where it matters.
  assert.doesNotMatch(src, /if \(\s*\n?\s*process\.env\.NODE_ENV &&/);
});

test('the free upgrade is unreachable in production', () => {
  // The last statement in the action writes `plan: 'pro'` with no payment
  // provider, no checkout and no money. Everything above it is a redirect that
  // must fire first in production, so the whole thing hinges on that one `if`.
  //
  // Reachability, not presence: `if (false) { redirect(...) }` keeps every line
  // of the guard and every line below it, passes a scan for either, and upgrades
  // the entire userbase for free. So the guard is asserted at the position it
  // has to occupy — the last redirect before the write — and the window is
  // checked for a condition that can never be true.
  const write = src.indexOf("      plan: 'pro',\n      status: 'active',\n      updatedAt: new Date(),");
  assert.notEqual(write, -1, 'the mock upgrade is gone; this test needs revisiting');

  // The guard that has to fire is the one whose closing brace is nearest the
  // write. Taking it from the `}` backwards rather than searching for the text
  // keeps this non-vacuous: if another `if` were interposed it would own that
  // brace, and this slice would no longer be the production redirect at all.
  const close = src.lastIndexOf('}', write);
  const guard = src.slice(src.lastIndexOf('if (', close), close + 1);

  assert.match(
    guard,
    /if \(process\.env\.NODE_ENV === 'production'\) \{\s*redirect\(/,
    'the upgrade must sit behind a production redirect, not behind a truthy NODE_ENV test'
  );
  assert.doesNotMatch(
    guard,
    /if \((?:false|0|null|undefined|'')\)/,
    'a guard that cannot fire is not a guard; the upgrade runs in production'
  );
});

test('the free upgrade writes one row, and it is the caller’s', () => {
  // Scoped by user id. The scoping is the second half of the previous test's
  // safety: a guard that slips is a mass upgrade rather than a mass upgrade of
  // the wrong accounts, and this is the only line in the file that says whose
  // row it is.
  assert.match(
    src,
    /\.set\(\{\s*plan: 'pro',\s*status: 'active',\s*updatedAt: new Date\(\),\s*\}\)\s*\.where\(eq\(subscriptions\.userId, user\.id\)\);/,
    'the dev upgrade must filter on the signed-in user'
  );
});

test('an account already on Pro cannot buy the plan again', () => {
  // A money path, guarded only by a hidden button. The dashboard's own comment
  // sets the rule this was missing: "that check is the trust boundary and must
  // never depend on the client." Measured — deleting the `subscriptionPlan !==
  // 'pro'` around the upgrade form in page.tsx left the suite green, because a
  // Pro customer seeing an Upgrade button is a cosmetic bug, while a Pro
  // customer being handed a live checkout is not.
  //
  // Reached three ways none of which involve the button: a tab open from before
  // the webhook landed, a form restored from bfcache, the action path pasted by
  // hand. The redirect below covers all of them because it is the first thing
  // after the session is resolved.
  const action = src.slice(src.indexOf('export async function upgradeToProAction'));
  const guard = action.indexOf("if (user.subscriptionPlan === 'pro')");
  assert.notEqual(guard, -1, 'the Pro re-purchase guard is gone');

  const redirectTo = action.indexOf("redirect('/dashboard')", guard);
  assert.notEqual(redirectTo, -1, 'the guard does not redirect anywhere');
  assert.ok(
    redirectTo - guard < 80,
    'the redirect is not the body of the guard — something can run first'
  );

  // Before either provider arm. A guard placed after the LemonSqueezy checkout
  // has already created the session it was meant to prevent.
  for (const arm of ['if (BILLING_PROVIDER ===', 'createCheckout({']) {
    assert.ok(
      guard < action.indexOf(arm),
      `the Pro guard runs after ${arm} — the checkout is already created by then`
    );
  }

  // And it is not an unreachable `if (false)`, which keeps every line of the
  // guard and passes a scan for any of them.
  assert.match(
    action.slice(guard, guard + 120),
    /if \(user\.subscriptionPlan === 'pro'\) \{\s*redirect\('\/dashboard'\);/,
    'the guard does not test the plan it claims to test'
  );
});
