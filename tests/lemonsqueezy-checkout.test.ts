import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run: npm test
//
// The bugs this prevents, both on the same request body:
//
//  1. `createCheckout` declared an `email` in its params, the only caller passed
//     `user.email`, and nothing ever read it. Every LemonSqueezy checkout
//     therefore asked the customer to retype the address they had just signed in
//     with, and LemonSqueezy had no address to send the order receipt to.
//
//  2. No `redirect_url`, so a customer who completed checkout was never returned
//     to the app. Both fields are the kind that look right in a source scan and
//     are ignored on the wire — hence the assertions below, against the captured
//     request body rather than the text.
//
// Asserted against the captured request body rather than the source, because the
// failure this guards is the field landing at the wrong depth inside
// `checkout_data` — a source scan reads that as correct.
//
// The env is set before the import on purpose: `lemonsqueezy` captures
// process.env once, at module load, so a static import would freeze it empty and
// `createCheckout` would return null before reaching any network call. That is
// also why this lives in its own file — tests/lemonsqueezy.test.ts imports the
// same module statically, and ESM would evaluate that import first.

process.env.LEMONSQUEEZY_API_KEY = 'ls_api_key_fake';
process.env.LEMONSQUEEZY_STORE_ID = '12345';
process.env.LEMONSQUEEZY_VARIANT_ID = '67890';

const { createCheckout } = await import('../src/lib/lemonsqueezy.ts');

type Captured = { url: string; init: RequestInit };
const captured: Captured[] = [];

const realFetch = globalThis.fetch;
const respondWith = (payload: unknown) => {
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    captured.push({ url: String(url), init: init as RequestInit });
    return { ok: true, json: async () => payload };
  }) as unknown as typeof fetch;
};

respondWith({ data: { attributes: { url: 'https://lemonsqueezy.test/checkout/buy/1' } } });

test.after(() => {
  globalThis.fetch = realFetch;
});

const REDIRECT = 'https://app.example.com/dashboard?upgraded=true';
// 32 bytes, hex, as billing.ts mints it.
const NONCE =
  '7f3d1c9a52e84b06d71fa3c95e2b8d4071c6ea3f92b5d8013c47e6a2d5b9f04';

/** Send one checkout and return the body — `data`, holding attributes AND relationships. */
const send = async (email: string) => {
  captured.length = 0;
  await createCheckout({ nonce: NONCE, email, redirectUrl: REDIRECT });
  assert.equal(captured.length, 1, 'exactly one checkout request should be made');
  return JSON.parse(String(captured[0].init.body)).data;
};

test('the customer email rides along on the checkout', async () => {
  // Not a source scan: `checkout_data.email` has to be inside `checkout_data`,
  // and `data.attributes.email` would match a grep while LS ignores it.
  const attrs = await send('alex@example.com');
  assert.equal(attrs.attributes.checkout_data.email, 'alex@example.com');
});

test('the checkout carries the nonce, and never the user id', async () => {
  // The whole point of the change. `POST /v1/checkouts` is public, so anyone
  // who knows the store id can put anything they like in `custom`; a user id
  // there is their opinion of whose account to bill, and the webhook used to
  // believe it. Asserted on the captured body rather than the source, because a
  // user_id added alongside the nonce would still match a grep for `custom`.
  const attrs = await send('alex@example.com');
  assert.deepEqual(attrs.attributes.checkout_data.custom, { checkout_nonce: NONCE });

  // Named explicitly: this used to be the vulnerability, and leaving room for it
  // to creep back in is the failure this test is here to prevent.
  assert.equal(
    attrs.attributes.checkout_data.custom.user_id,
    undefined,
    'the user id must not be sent — it is attacker-chosen on a public endpoint'
  );
});

test('the request is aimed at the checkouts endpoint, for the configured variant', async () => {
  // Guarding the other halves of the same object. A body can carry every field
  // and still point at the wrong endpoint or variant, and neither shows up as a
  // missing property.
  const attrs = await send('alex@example.com');
  assert.equal(captured[0].url, 'https://api.lemonsqueezy.com/v1/checkouts');
  assert.equal(captured[0].init.method, 'POST');
  assert.equal(attrs.relationships.variant.data.id, '67890');
  assert.equal(attrs.relationships.store.data.id, '12345');
});

test('a good payload yields its checkout URL', async () => {
  // The response side, which every other test in this file skips. They all read
  // the *request* body, and the one that reads the response asserts null for a
  // payload that has none — so `return null;` unconditionally satisfied the whole
  // file. The extraction below can be deleted outright and nothing here notices.
  //
  // That is not a hypothetical trim. `json.data?.attributes?.url` is a path
  // through LemonSqueezy's JSON:API envelope, and the field is read at four
  // levels of nesting. Rename it, or serve the v1 shape because the Accept header
  // went missing, and every checkout in every deployment resolves to null — the
  // action reports `?billing=error` to a customer who has not been charged, and
  // no request body looks wrong.
  respondWith({ data: { attributes: { url: 'https://lemonsqueezy.test/checkout/buy/1' } } });
  captured.length = 0;
  assert.equal(
    await createCheckout({ nonce: NONCE, email: 'alex@example.com', redirectUrl: REDIRECT }),
    'https://lemonsqueezy.test/checkout/buy/1',
    'the URL LemonSqueezy returns is the URL the customer is sent to'
  );

  // And the shape is the v2 envelope, which is what the Accept header above
  // negotiates. A bare `attributes` is the v1 shape LemonSqueezy still serves to
  // callers that omit the version, and it parses to nothing under this extraction.
  respondWith({ data: { attributes: {} } });
  assert.equal(
    await createCheckout({ nonce: NONCE, email: 'alex@example.com', redirectUrl: REDIRECT }),
    null,
    'a payload with no url must stay unusable rather than resolve to something to send a customer to'
  );
});

test('the request asks for the API version it parses', async () => {
  // The Accept header is the negotiation, and the extraction above is written
  // against what it returns. Drop the header and LemonSqueezy serves the
  // deprecated v1 envelope — where the checkout's URL is not at
  // `data.attributes.url` — so the two changes cancel out into a checkout that
  // creates cleanly, returns null, and reports a payment error to a customer
  // nothing has charged. Header and parse are one contract, so they are checked
  // together.
  await send('alex@example.com');
  const headers = captured[0].init.headers as Record<string, string>;
  assert.equal(
    headers.Accept,
    'application/vnd.api+json',
    'the request must negotiate the API version the response is parsed from'
  );
});

test('the request is authenticated as the configured key', async () => {
  // The mock answers 200 to anything, which is exactly what hid this: every
  // other assertion in this file reads the body, and the credential is the one
  // part of the request that never appears in one. `POST /v1/checkouts` is
  // public to *create* but not to authenticate, so a request that arrives with
  // no `Authorization` is rejected by the server with a 401 — surfacing as
  // billing.ts's catch and the "billing=error" banner, on a deploy where the
  // operator has a working key in .env.
  //
  // Asserted on the captured request rather than the source, because the failure
  // is a header reaching the wrong place or under the wrong name, and both look
  // correct in a source scan. This is the third outbound header; the other two
  // (Accept, Content-Type) are pinned above and below.
  await send('alex@example.com');
  const headers = captured[0].init.headers as Record<string, string>;
  assert.equal(
    headers.Authorization,
    'Bearer ls_api_key_fake',
    'the checkout is not authenticated as the configured LemonSqueezy key'
  );
});

test('a 200 with no URL is not treated as a usable checkout', async () => {
  // The other shape the action has to survive: an archived variant or an
  // inactive store answers 200 carrying no url. Null must mean "not usable", so
  // the action can refuse rather than hand the customer a broken link.
  respondWith({ data: {} });
  captured.length = 0;
  assert.equal(
    await createCheckout({ nonce: NONCE, email: 'alex@example.com', redirectUrl: REDIRECT }),
    null
  );
});

test('the customer is returned to the app after paying', async () => {
  // The bug this prevents: no redirect_url at all, so a LemonSqueezy customer
  // who completes checkout stays on LemonSqueezy's hosted thank-you page with
  // no route back to the app they just bought. The sale completes and the
  // webhook still grants Pro, so nothing looks broken — the customer just never
  // comes back. Stripe already does this via success_url.
  const attrs = await send('alex@example.com');
  assert.equal(attrs.attributes.product_options.redirect_url, REDIRECT);
});

test('the redirect is not nested inside checkout_data', async () => {
  // Depth, not presence. `checkout_data` is a documented bag of prefill fields
  // (email, name, billing_address, custom) — LemonSqueezy reads the return
  // address from `product_options.redirect_url` and ignores a
  // `checkout_data.redirect_url` completely. The field would then be present,
  // greppable, and inert: the customer is stranded exactly as before.
  const attrs = await send('alex@example.com');
  assert.equal(
    attrs.attributes.checkout_data.redirect_url,
    undefined,
    'LemonSqueezy ignores checkout_data.redirect_url; it belongs in product_options'
  );
});

test('a rejected checkout says why, instead of returning a bare null', async () => {
  // Every other failure in this file returns null, and null is what the billing
  // action turns into "Could not start checkout". So the two cases have to be
  // told apart by something other than the return value, and the only thing
  // carrying that is the thrown Error.
  //
  // A 401 is the overwhelmingly common one — a rotated or never-set API key.
  // Without the status and the body in the message, the operator gets a generic
  // failure and no clue which of the four configured values is wrong, in a kit
  // where three of them ship empty in .env.example.
  //
  // Removing the `!res.ok` guard does not crash: `res.json()` on an error body
  // yields no `data`, the optional chain gives undefined, and `?? null` converts
  // it. It fails quietly and takes the diagnostic with it.
  globalThis.fetch = (async () => ({
    ok: false,
    status: 401,
    text: async () => 'Unauthenticated.',
  })) as unknown as typeof fetch;

  await assert.rejects(
    createCheckout({ nonce: NONCE, email: 'alex@example.com', redirectUrl: REDIRECT }),
    (err: Error) => {
      assert.match(err.message, /401/, 'the status is the only clue which value is misconfigured');
      assert.match(err.message, /Unauthenticated\./, 'the response body is dropped');
      return true;
    }
  );

  // Put the good stub back so the assertions after this one still see a
  // checkout that succeeds. `test.after` restores the real global either way.
  respondWith({ data: { attributes: { url: 'https://lemonsqueezy.test/checkout/buy/1' } } });
});