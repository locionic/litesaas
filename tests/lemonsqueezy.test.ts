import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyWebhookSignature, mapSubscriptionStatus, isProVariant } from '../src/lib/lemonsqueezy.ts';

// Run: npm test

const SECRET = 'whsec_test_fake_secret';
const BODY = JSON.stringify({
  meta: { event_name: 'order_created' },
  data: {
    attributes: { id: '1', status: 'paid', meta: { custom_data: { user_id: 'usr_9f2c1a4b8e7d' } } },
  },
});

test('accepts a signature produced over the raw body', () => {
  const sig = crypto.createHmac('sha256', SECRET).update(BODY, 'utf8').digest('hex');
  assert.equal(verifyWebhookSignature(BODY, sig, SECRET), true);
});

test('rejects a tampered body', () => {
  const sig = crypto.createHmac('sha256', SECRET).update(BODY, 'utf8').digest('hex');
  assert.equal(verifyWebhookSignature(BODY.replace('paid', 'free'), sig, SECRET), false);
});

test('rejects a wrong secret, and never throws on length mismatch', () => {
  const sig = crypto.createHmac('sha256', 'other_secret').update(BODY, 'utf8').digest('hex');
  assert.equal(verifyWebhookSignature(BODY, sig, SECRET), false);
  // timingSafeEqual throws on unequal lengths; the guard must swallow that.
  assert.equal(verifyWebhookSignature(BODY, 'deadbeef', SECRET), false);
  assert.equal(verifyWebhookSignature(BODY, null, SECRET), false);
  assert.equal(verifyWebhookSignature(BODY, sig, undefined), false);
});

test('maps LemonSqueezy statuses onto the subscriptions.status enum', () => {
  assert.deepEqual(mapSubscriptionStatus('active'), { plan: 'pro', status: 'active' });
  assert.deepEqual(mapSubscriptionStatus('on_trial'), { plan: 'pro', status: 'trialing' });
  // Terminal states must revoke, not freeze the user on a dead plan.
  assert.deepEqual(mapSubscriptionStatus('expired'), { plan: 'free', status: 'canceled' });
  assert.deepEqual(mapSubscriptionStatus('canceled'), { plan: 'free', status: 'canceled' });
});

test('only a live subscription keeps Pro', () => {
  // LS auto-pauses when a renewal payment fails. This used to fall through the
  // default arm to `plan: 'pro'`, so a user who stopped paying kept Pro
  // indefinitely — and nothing downstream reads `status`, so the damage was
  // invisible.
  assert.deepEqual(mapSubscriptionStatus('paused'), { plan: 'free', status: 'past_due' });
  assert.deepEqual(mapSubscriptionStatus('past_due'), { plan: 'free', status: 'past_due' });
  assert.deepEqual(mapSubscriptionStatus('unpaid'), { plan: 'free', status: 'past_due' });
});

test('an unrecognised status revokes rather than grants', () => {
  // Any status LemonSqueezy adds later must default to the safe direction.
  for (const s of ['', 'paused_2026', 'ACTIVE', 'on_hold']) {
    assert.equal(mapSubscriptionStatus(s).plan, 'free', `should not grant Pro for ${JSON.stringify(s)}`);
  }
});

test('only the configured variant grants or revokes', () => {
  // LS sends the id as a string in the payload and it is a number in config.
  assert.equal(isProVariant('12345', '12345'), true);
  assert.equal(isProVariant('12345', 12345), true);
  assert.equal(isProVariant(12345, '12345'), true);

  // Some other product in the same store — the $1 tip jar.
  assert.equal(isProVariant('99999', '12345'), false);
  assert.equal(isProVariant(null, '12345'), false);
  assert.equal(isProVariant(undefined, '12345'), false);

  // Unconfigured variant must match nothing, or a zero-config clone would
  // accept every order in the store.
  assert.equal(isProVariant('12345', undefined), false);
  assert.equal(isProVariant('12345', null), false);
  assert.equal(isProVariant('12345', ''), false);
});
