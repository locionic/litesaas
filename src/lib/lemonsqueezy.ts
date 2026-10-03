import crypto from 'crypto';
// Relative and with the extension, not the `@/` alias: tests/lemonsqueezy.test.ts
// imports this module directly, and `node --test` resolves neither the alias
// nor tsconfig paths. allowImportingTsExtensions is on for exactly this.
import { isRealSecret } from './stripe.ts';

const API_BASE = 'https://api.lemonsqueezy.com/v1';

/**
 * LemonSqueezy needs no SDK — it speaks plain JSON:API over HTTPS, so we use
 * fetch. Config lives in env only; every helper degrades to "unconfigured"
 * rather than throwing, so a zero-config clone still boots.
 */
export const lemonsqueezy = {
  apiKey: process.env.LEMONSQUEEZY_API_KEY,
  storeId: process.env.LEMONSQUEEZY_STORE_ID,
  variantId: process.env.LEMONSQUEEZY_VARIANT_ID,
  webhookSecret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET,
};

/**
 * Whether the LemonSqueezy half is complete enough to sell through.
 *
 * Includes the webhook signing secret, which is easy to leave out: it is set in
 * the LemonSqueezy dashboard rather than anywhere in this repo, and without it
 * every order webhook 401s, so a paid customer keeps the free plan while the
 * app tells them to wait. These four ship empty in .env.example, so `undefined`
 * is the only absent form — but the same "is this actually filled in" rule the
 * Stripe side uses costs one import and holds if a placeholder is added later.
 */
export function isLemonSqueezyConfigured(): boolean {
  return Boolean(
    lemonsqueezy.apiKey &&
      lemonsqueezy.storeId &&
      lemonsqueezy.variantId &&
      isRealSecret(lemonsqueezy.webhookSecret)
  );
}

type Plan = 'free' | 'pro' | 'enterprise';
type SubStatus = 'active' | 'canceled' | 'past_due' | 'trialing';

/**
 * Verify a LemonSqueezy webhook signature.
 *
 * `X-Signature` is a hex-encoded HMAC-SHA256 of the RAW request body keyed with
 * the webhook signing secret — so the caller must pass the unparsed text, never
 * a re-serialized object. Comparison is constant-time.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string | undefined
): boolean {
  if (!signature || !secret) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');

  // timingSafeEqual THROWS on a length mismatch, which would 500 the route
  // instead of returning a 401. Length is not secret.
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

/**
 * Map a LemonSqueezy subscription status onto our fixed subscriptions.status
 * enum. Only a genuinely live subscription keeps Pro.
 *
 * ponytail: the default arm revokes. Nothing in the app reads `status` when
 * gating access — the dashboard keys purely off `plan` — so a status that falls
 * through to `plan: 'pro'` silently becomes unlimited paid access. Failing open
 * also means any status LemonSqueezy adds later is a grant by default, which is
 * the wrong direction for money. `past_due` and `unpaid` keep the `past_due`
 * marker so an operator can see *why* a user lost access.
 */
export function mapSubscriptionStatus(lsStatus: string): { plan: Plan; status: SubStatus } {
  switch (lsStatus) {
    case 'active':
      return { plan: 'pro', status: 'active' };
    case 'on_trial':
      return { plan: 'pro', status: 'trialing' };
    // LemonSqueezy auto-pauses a subscription when a renewal payment fails, so
    // 'paused' is a stop-paying signal, not a neutral one.
    case 'paused':
    case 'past_due':
    case 'unpaid':
      return { plan: 'free', status: 'past_due' };
    case 'expired':
    case 'canceled':
      return { plan: 'free', status: 'canceled' };
    default:
      return { plan: 'free', status: 'canceled' };
  }
}

/**
 * True when `actual` is the variant this app is configured to sell.
 *
 * A LemonSqueezy store normally holds more than one product — a tip jar, a
 * cheaper tier, an add-on. `POST /v1/checkouts` is public, so anyone who knows
 * the store id can check out against any variant in it, and every paid order
 * lands in this app's webhook. Without this check, paying $1 for someone else's
 * product grants full Pro.
 *
 * Compares as strings because LS sends the variant id as a string in the
 * payload and as a number in our own config. Returns false when either side is
 * missing: an unconfigured `variantId` must never match.
 */
export function isProVariant(
  actual: string | number | null | undefined,
  expected: string | number | null | undefined
): boolean {
  if (actual == null || expected == null || expected === '') return false;
  return String(actual) === String(expected);
}

/**
 * Create a hosted checkout and return its URL.
 *
 * The `nonce` we stash in checkout_data.custom round-trips back to us on the
 * resulting order/subscription as `meta.custom_data.checkout_nonce`, which is
 * how the webhook knows which row to update. It is deliberately NOT the user id:
 * `POST /v1/checkouts` is public, so anyone who knows the store id can set any
 * field in `custom` on a checkout of their own making, and a user id there is
 * simply their opinion of whose account to touch. The nonce is a secret we
 * generated and already hold, so a forged checkout resolves to no row at all.
 *
 * `redirectUrl` is where LemonSqueezy returns the customer once they have paid.
 * Without it the sale still completes and the webhook still grants Pro, but the
 * customer is left sitting on LemonSqueezy's hosted thank-you page with no way
 * back to the app they just bought — where Stripe already returns them to
 * `/dashboard?upgraded=true`.
 */
export async function createCheckout(params: {
  nonce: string;
  email: string;
  redirectUrl: string;
}): Promise<string | null> {
  const { apiKey, storeId, variantId } = lemonsqueezy;
  if (!apiKey || !storeId || !variantId) return null;

  const res = await fetch(`${API_BASE}/checkouts`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${apiKey}`,
    },
    // A hung API must not hang the request: the dashboard's Upgrade button would
    // spin forever and the try/catch in the action would never see an error.
    // AbortSignal.timeout rejects with an AbortError, which that catch handles.
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      data: {
        type: 'checkouts',
        attributes: {
          // A SIBLING of checkout_data, not a field inside it. LemonSqueezy
          // reads the post-purchase return address from
          // product_options.redirect_url and ignores a checkout_data.redirect_url
          // entirely, so nesting it one level down still leaves the customer
          // stranded on the hosted page after paying. Verified against
          // https://docs.lemonsqueezy.com/api/checkouts.
          product_options: { redirect_url: params.redirectUrl },
          checkout_data: {
            custom: { checkout_nonce: params.nonce },
            // Prefills the form and is where LS sends the order receipt. The
            // caller already passes the signed-in user's address; without this
            // they retype it, and the receipt has nowhere to go.
            email: params.email,
          },
        },
        relationships: {
          store: { data: { type: 'stores', id: String(storeId) } },
          variant: { data: { type: 'variants', id: String(variantId) } },
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`LemonSqueezy checkout failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { data?: { attributes?: { url?: string } } };
  return json.data?.attributes?.url ?? null;
}
