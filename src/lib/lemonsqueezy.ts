import crypto from 'crypto';

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

export function isLemonSqueezyConfigured(): boolean {
  return Boolean(lemonsqueezy.apiKey && lemonsqueezy.storeId && lemonsqueezy.variantId);
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
 * The `user_id` we stash in checkout_data.custom round-trips back to us on the
 * resulting order/subscription as `meta.custom_data.user_id`, which is how the
 * webhook knows which row to update.
 */
export async function createCheckout(params: { userId: string; email: string }): Promise<string | null> {
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
          checkout_data: {
            custom: { user_id: params.userId },
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
