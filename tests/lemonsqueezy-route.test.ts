import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// tests/lemonsqueezy.test.ts covers the lib — the signature, the status map,
// isProVariant. It never opens the route, so every decision the route makes on
// top of those functions is unpinned, and each one is silent when removed:
//
//   1. `Date.parse(...) / 1000`. isStaleEvent compares a unix SECOND count, and
//      Date.parse returns MILLISECONDS. Hand it ms and the event timestamp is
//      read as a time roughly fifty thousand years in the future, which is never
//      older than the row — so nothing is ever stale, the guard silently does
//      nothing, and the queued `subscription_created` that
//      `subscription_cancelled` already superseded lands and resurrects the
//      subscription for good. Every other test still passes: webhook-guard.test.ts
//      does its own conversion in a helper, so the guard behaves perfectly in the
//      suite and does nothing in the route.
//   2. `order_created` grants only on 'paid'. LemonSqueezy emits it before
//      payment settles, exactly as Stripe completes a session with the money
//      outstanding. The lib has no notion of an order, so its tests cannot
//      cover this and would not notice its removal.
//   3. The refund arm revokes, and only for the variant this app sells — a
//      refund of some other product in the same store must not cancel a real
//      customer's licence.
//   4. Every subscription lifecycle event reaches the status mapper. Dropping
//      `subscription_paused` from the list is not an error and leaves a paused
//      customer on Pro.
//
// Source assertions, because the route imports next/server and the db and so
// cannot be imported under `node --test` — the same reason stripe-events.test.ts
// reads source instead of calling in.

const route = readFileSync(
  fileURLToPath(new URL('../src/app/api/webhooks/lemonsqueezy/route.ts', import.meta.url)),
  'utf8'
);

/** One `case '…':` arm, up to the next case or the end of the switch. */
const arm = (name: string): string => {
  const from = route.indexOf(`case '${name}':`);
  assert.notEqual(from, -1, `the ${name} arm is gone; this test needs revisiting`);
  const to = route.indexOf("case '", from + 1);
  return route.slice(from, to === -1 ? route.length : to);
};

/**
 * The lifecycle fall-through group: seven consecutive labels with no body of
 * their own, sharing one.
 *
 * `arm()` cannot slice it. It stops at the next `case '`, and in this group the
 * next case is the following line — so it returns the bare label and the body
 * it was meant to read is silently absent. Anchored on the LAST label instead,
 * which is the one with the body immediately after it, and bounded by the
 * switch's own closing brace. `\n  }` rather than `\n  }\n`: the arm ends at
 * four spaces and the switch at two, so only the switch matches.
 */
const lifecycle = (): string => {
  const from = route.indexOf("case 'subscription_unpaused':");
  assert.notEqual(from, -1, 'the lifecycle group is gone; this test needs revisiting');
  const to = route.indexOf('\n  }', from);
  assert.ok(to > from, 'the switch has no closing brace after the group');
  return route.slice(from, to);
};

/**
 * `variantIdOf`, lifted and run.
 *
 * Its parameter is annotated, so the whole declaration cannot be evaluated — but
 * the decision it makes is a single `return`, and that expression is plain JS.
 * Two fields have to be reconciled here and a regex can only check that one of
 * them was mentioned; this runs the real operator against payloads where they
 * disagree, which is the only way to see which one wins.
 */
const variantIdOf = (): ((a: Record<string, unknown>) => unknown) => {
  const from = route.indexOf('function variantIdOf(');
  assert.notEqual(from, -1, 'variantIdOf is gone; this test needs revisiting');
  const ret = route.indexOf('return ', from);
  assert.notEqual(ret, -1, 'variantIdOf no longer returns an expression');
  const end = route.indexOf(';', ret);
  assert.ok(end > ret, 'the returned expression is unterminated');
  return new Function(
    'attrs',
    `return ${route.slice(ret + 'return '.length, end)};`
  ) as (a: Record<string, unknown>) => unknown;
};

test('the row is resolved by our nonce, never by an id the event asserts', () => {
  // Demonstrated against a running server before it was fixed. `POST
  // /v1/checkouts` is public, so an attacker creates a checkout whose
  // `custom_data` names a victim, pays the minimum that counts, then refunds it.
  // Every arm of this switch read `custom_data.user_id`, so a validly signed
  // refund downgraded a stranger's licence while the route reported success.
  //
  // The nonce is a secret we minted and already hold, so a forged checkout
  // resolves to no row and the event is skipped.
  assert.match(
    route,
    /const nonce = attrs\.meta\?\.custom_data\?\.checkout_nonce;/,
    'the row must be resolved by the nonce we minted'
  );
  assert.doesNotMatch(
    route,
    /custom_data\?\.user_id/,
    'user_id is attacker-chosen on a public endpoint; reading it reopens the downgrade'
  );
  assert.match(
    route,
    /where: eq\(subscriptions\.lemonNonce, nonce\)/,
    'the lookup must match on the nonce'
  );

  // The reads are only half of it. A route that resolved the row by nonce and
  // then wrote through `subscriptions.userId` would still update whichever row
  // the attacker named — correct-looking, and still the vulnerability. So every
  // mutating arm is checked, not just the first one found.
  const writes = [
    ...route.matchAll(/\.where\(and\(eq\(subscriptions\.(\w+), (\w+)\)/g),
  ];
  assert.equal(writes.length, 3, `expected all 3 mutating arms to filter, found ${writes.length}`);
  for (const [, column, value] of writes) {
    assert.equal(column, 'lemonNonce', `a mutating arm filters on ${column}`);
    assert.equal(value, 'nonce', `a mutating arm filters on the event's ${value}`);
  }
});

test('a missing nonce is skipped rather than guessed at', () => {
  // LemonSqueezy retries for days and reports no error to the app when a
  // delivery is skipped. Falling through to some other resolution — or to the
  // write — is what turns "we could not identify this" into "we changed
  // somebody's plan".
  const from = route.indexOf('const nonce = attrs.meta?.custom_data?.checkout_nonce;');
  assert.notEqual(from, -1);
  const to = route.indexOf('db.query.subscriptions.findFirst');
  const guard = route.slice(from, to);
  assert.match(guard, /if \(!nonce\) \{/);
  assert.match(guard, /skipped: 'no checkout_nonce'/);

  // The second guard, which the slice above cannot reach because it sits *after*
  // the query. A delivery can name a nonce perfectly well and still find no
  // subscription holding it — an abandoned checkout, or a row cleared since the
  // delivery was queued and retried. Drop this guard and the next line reads
  // `row.updatedAt` on a null: a 500 for a condition that can never become true,
  // so LemonSqueezy retries it for days against an app that will never answer
  // 200. It also loses the `skipped` body, which is the only place the operator
  // ever sees that a delivery was dropped and why.
  const afterQuery = route.slice(to);
  assert.match(
    afterQuery,
    /if \(!row\) \{/,
    'a delivery naming a well-formed nonce that no subscription holds is not skipped'
  );
  assert.match(afterQuery, /skipped: 'no subscription'/);
});

test('created_at reaches the staleness guard in seconds, not milliseconds', () => {
  // Both halves are needed: the division converts, and isStaleEvent is what
  // consumes the converted value. A route that computed `createdAt` correctly
  // and then passed something else to the guard would pass an assertion on the
  // division alone.
  assert.match(
    route,
    /const createdAt = event\.meta\?\.created_at \? Date\.parse\(event\.meta\.created_at\) \/ 1000 : NaN;/,
    'the ms→s conversion is gone; isStaleEvent will read every event as far-future and never stale'
  );
  assert.match(
    route,
    /isStaleEvent\(createdAt, row\.updatedAt\)/,
    'the guard must read the converted timestamp'
  );
});

test('an order grants Pro only once it is paid, and only for the variant sold', () => {
  const created = arm('order_created');

  assert.match(created, /plan: 'pro'/, 'a paid order must still grant Pro');

  const guard = created.indexOf("attrs.status !== 'paid'");
  assert.notEqual(guard, -1, 'the paid check is gone; see the file header');
  assert.ok(
    guard < created.indexOf('.update(subscriptions)'),
    'the paid check must run before the subscription is updated'
  );

  assert.match(
    created,
    /if \(!isProVariant\(variantIdOf\(attrs\), lemonsqueezy\.variantId\)\) break;/,
    'an order for another product in this store must not grant Pro'
  );
});

test('a refund of the variant sold revokes Pro, and never grants it', () => {
  const refund = arm('order_refunded');

  assert.match(refund, /plan: 'free'/, 'a refund must revoke Pro');
  assert.doesNotMatch(refund, /plan: 'pro'/, 'a refund must never grant Pro');

  // The guard the Stripe route gets for free by matching on a customer id. An
  // LS event carries no such handle, so the variant is the only thing
  // distinguishing "this store refunded our customer" from "this store refunded
  // somebody else's order".
  assert.match(
    refund,
    /if \(!isProVariant\(variantIdOf\(attrs\), lemonsqueezy\.variantId\)\) break;/,
    'a refund of another product must not cancel a real licence'
  );
});

test('every subscription lifecycle event reaches the status mapper', () => {
  // The whole entitlement surface. An event that arrives, matches nothing, and
  // still 200s leaves LemonSqueezy with no reason to retry it.
  const arms = [...route.matchAll(/^ {4}case '([a-z._]+)':/gm)].map((m) => m[1]);
  assert.deepEqual(
    arms,
    [
      'order_created',
      'order_refunded',
      'subscription_created',
      'subscription_updated',
      'subscription_cancelled',
      'subscription_expired',
      'subscription_resumed',
      'subscription_paused',
      'subscription_unpaused',
    ],
    `the set of LemonSqueezy events that can change a plan changed: ${arms.join(', ')}`
  );

  // And the fallback body must map rather than guess: `mapSubscriptionStatus`
  // is what makes an unrecognised status revoke instead of grant, and a route
  // that assigned `plan: 'pro'` here would discard that guarantee.
  assert.match(
    lifecycle(),
    /const \{ plan, status \} = mapSubscriptionStatus\(attrs\.status\);/
  );
  assert.match(lifecycle(), /\.set\(\{ plan, status, updatedAt: new Date\(\) \}\)/);
});

test('the variant comes from first_order_item, which supersedes the top-level id', () => {
  // route.ts:27 states the precedence as a property of LemonSqueezy's payloads
  // and nothing pinned it, so an order whose two fields disagree was checked
  // against whichever id the route happened to read — silently, since both
  // fields are present and both look right in a source scan.
  const idOf = variantIdOf();

  // The precedence, stated as a disagreement. Anything reading the top-level id
  // fails exactly here and passes the three below, which is why this cannot be
  // an assertion about presence.
  assert.equal(
    idOf({ variant_id: '99999', first_order_item: { variant_id: '67890' } }),
    '67890',
    'first_order_item supersedes the top-level variant_id'
  );

  // Subscription events carry no order item at all, so the fallback is the only
  // thing standing between a lifecycle arm and `isProVariant(undefined, …)`.
  assert.equal(idOf({ variant_id: '67890' }), '67890', 'an event with no order item still resolves');
  assert.equal(idOf({ variant_id: '67890', first_order_item: null }), '67890');
  // An item that names no variant falls back too, rather than matching nothing.
  assert.equal(idOf({ variant_id: '67890', first_order_item: {} }), '67890');

  // Four payloads, and neither one-field expression survives all of them: reading
  // only `variant_id` fails the first, reading only `first_order_item?.variant_id`
  // fails the last two. The pair has to actually be a fallback.
});

test('the signature covers the exact bytes sent, so the body is read as text', () => {
  // The comment at route.ts:39 gives the reason: `verifyWebhookSignature` HMACs
  // the string it is handed, and a parse-then-stringify rebuild is not the bytes
  // LemonSqueezy signed. Pretty-printed or key-reordered JSON re-serialises to
  // something different, and the HMAC then mismatches — a 401 on every order,
  // with a paid customer left on the free plan and no request body to look at.
  //
  // lemonsqueezy.test.ts already proves the verifier is byte-exact. What was
  // unpinned is that the route hands it something to be exact about.
  const reads = [...route.matchAll(/req\.(text|json)\(\)/g)];
  assert.equal(reads.length, 1, `the route reads the request body ${reads.length} times`);
  assert.equal(reads[0][1], 'text', 'the body must be read as text, not parsed');

  // One read, and the same variable into both consumers. A `req.json()` anywhere
  // consumes the body and forces a re-serialization back out of it.
  assert.match(
    route,
    /verifyWebhookSignature\(rawBody, req\.headers\.get\('x-signature'\)/,
    'the HMAC must be computed over the raw text'
  );
  assert.match(route, /JSON\.parse\(rawBody\)/, 'the payload parsed must be the same bytes');

  // And the parse cannot run first: a request that fails its signature is
  // answered 401 without the JSON ever being looked at.
  assert.ok(
    route.indexOf('const rawBody = await req.text();') < route.indexOf('verifyWebhookSignature('),
    'the body is read after the signature check, which cannot work'
  );
});