import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { subscriptions } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { lemonsqueezy, verifyWebhookSignature, mapSubscriptionStatus, isProVariant } from '@/lib/lemonsqueezy';
import { isStaleEvent, notStaleSql } from '@/lib/webhook-guard';

/**
 * LemonSqueezy webhooks. No SDK, no stripe-signature helper — just an
 * HMAC-SHA256 check over the raw body.
 */

interface LsMeta {
  custom_data?: { checkout_nonce?: string } | null;
}

interface LsSubscription {
  id: string;
  status: string;
  variant_id?: string | number | null;
  meta?: LsMeta | null;
}

interface LsOrder {
  id: string;
  status: string;
  // `first_order_item` supersedes the top-level `variant_id` on orders.
  variant_id?: string | number | null;
  first_order_item?: { variant_id?: string | number | null } | null;
  meta?: LsMeta | null;
}

/** The variant actually purchased, whichever field the event carried it in. */
function variantIdOf(attrs: LsOrder & LsSubscription): string | number | null | undefined {
  return attrs.first_order_item?.variant_id ?? attrs.variant_id;
}

export async function POST(req: NextRequest) {
  // Must read the body as text BEFORE any parsing: the signature covers the
  // exact bytes sent, so a re-serialized JSON.stringify would not match.
  const rawBody = await req.text();

  if (!verifyWebhookSignature(rawBody, req.headers.get('x-signature'), lemonsqueezy.webhookSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: { meta?: { event_name?: string; created_at?: string }; data?: { attributes?: LsSubscription & LsOrder } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
  }

  const eventName = event?.meta?.event_name;
  if (!eventName) {
    return NextResponse.json({ received: true });
  }

  // The row is resolved by a nonce we minted, not by anything the event itself
  // asserts. `POST /v1/checkouts` is public, so anyone who knows the store id
  // can create a checkout with any `custom` payload they like and pay the
  // smallest amount that counts — previously `custom_data.user_id` named the
  // account, so that checkout plus a refund downgraded a stranger's licence.
  //
  // The obvious fix is to persist the LemonSqueezy subscription id and match on
  // that, and it is the right shape. It is not executable today: per
  // https://docs.lemonsqueezy.com/api/checkouts the checkout response carries
  // only `data.id` and store/variant relationships, with no subscription id to
  // store. A nonce round-trips through a mechanism already in use (the same
  // `custom_data` field the user id used), so it needs no assumption about the
  // rest of the payload. If LemonSqueezy ever returns the subscription id at
  // checkout time, prefer it and drop this column.
  const attrs = event?.data?.attributes;
  if (!attrs) {
    return NextResponse.json({ received: true, skipped: 'no attributes' });
  }

  const nonce = attrs.meta?.custom_data?.checkout_nonce;
  if (!nonce) {
    return NextResponse.json({ received: true, skipped: 'no checkout_nonce' });
  }

  // LemonSqueezy does not guarantee ordering and retries for days, so a
  // `subscription_created` delivery queued behind a transient failure can land
  // after the `subscription_cancelled` that superseded it — permanently
  // resurrecting a canceled subscription, with no later event able to undo it.
  // This read reports the skip; the watermark repeated in each UPDATE's WHERE is
  // what actually enforces it, since a read-based decision is only valid until
  // the next await. See src/lib/webhook-guard.ts.
  // Date.parse yields MILLISECONDS; isStaleEvent compares against a unix
  // second count, so convert here. Passing ms straight through multiplies it
  // by 1000 a second time, putting the event tens of thousands of years in the
  // future — where nothing is ever stale and the guard silently does nothing.
  const createdAt = event.meta?.created_at ? Date.parse(event.meta.created_at) / 1000 : NaN;
  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.lemonNonce, nonce),
  });
  if (!row) {
    return NextResponse.json({ received: true, skipped: 'no subscription' });
  }
  if (isStaleEvent(createdAt, row.updatedAt)) {
    return NextResponse.json({ received: true, skipped: 'stale' });
  }

  switch (eventName) {
    // Pro is sold as a one-time license, so the order events are the primary path.
    case 'order_created': {
      // LS also emits order_created before payment settles; only grant on 'paid'.
      if (attrs.status !== 'paid') break;
      // ...and only for the variant this app sells. See isProVariant.
      if (!isProVariant(variantIdOf(attrs), lemonsqueezy.variantId)) break;
      await db
        .update(subscriptions)
        .set({ plan: 'pro', status: 'active', updatedAt: new Date() })
        .where(and(eq(subscriptions.lemonNonce, nonce), notStaleSql(subscriptions.updatedAt, createdAt)));
      break;
    }

    case 'order_refunded': {
      // Same guard: a refund of some other product in this store must not
      // cancel a real customer's Pro license.
      if (!isProVariant(variantIdOf(attrs), lemonsqueezy.variantId)) break;
      await db
        .update(subscriptions)
        .set({ plan: 'free', status: 'canceled', updatedAt: new Date() })
        .where(and(eq(subscriptions.lemonNonce, nonce), notStaleSql(subscriptions.updatedAt, createdAt)));
      break;
    }

    // Recurring products, if you swap the variant to a subscription.
    case 'subscription_created':
    case 'subscription_updated':
    case 'subscription_cancelled':
    case 'subscription_expired':
    case 'subscription_resumed':
    case 'subscription_paused':
    case 'subscription_unpaused': {
      if (!isProVariant(variantIdOf(attrs), lemonsqueezy.variantId)) break;
      const { plan, status } = mapSubscriptionStatus(attrs.status);
      await db
        .update(subscriptions)
        .set({ plan, status, updatedAt: new Date() })
        .where(and(eq(subscriptions.lemonNonce, nonce), notStaleSql(subscriptions.updatedAt, createdAt)));
      break;
    }
  }

  return NextResponse.json({ received: true });
}
