import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { db } from '@/db';
import { subscriptions } from '@/db/schema';
import { and, eq, type SQL } from 'drizzle-orm';
import { isStaleEvent, notStaleSql } from '@/lib/webhook-guard';
import type Stripe from 'stripe';

export async function POST(req: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe is not configured' }, { status: 400 });
  }

  const body = await req.text();
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: 'Missing stripe signature or webhook secret' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  /**
   * Read the row so a skipped delivery can say *why* in the response body.
   *
   * This is the diagnostic, not the guard: the watermark is repeated in each
   * UPDATE's WHERE (see `notStaleSql`) because a decision made from a read is
   * only valid until the next await, and Stripe does not guarantee ordering or
   * exclude concurrent deliveries — retries for days. A stale event queued
   * behind a cancel must not resurrect the subscription; see
   * src/lib/webhook-guard.ts.
   */
  const shouldApply = async (where: SQL): Promise<'ok' | 'missing' | 'stale'> => {
    const row = await db.query.subscriptions.findFirst({ where });
    if (!row) return 'missing';
    return isStaleEvent(event.created, row.updatedAt) ? 'stale' : 'ok';
  };

  // Surfaced in the 200 body so a skipped delivery is visible in Stripe's
  // event log rather than looking indistinguishable from a handled one.
  let skipped: 'missing' | 'stale' | undefined;

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      if (!userId) break;
      // Pro is a one-time licence (see CHECKOUT_MODE), so this event is the
      // only thing standing between "customer reached the end of checkout" and
      // "customer paid". A one-time session can complete with the money still
      // outstanding; granting Pro on that hands out the product for free. Card
      // is the only method this checkout accepts, so the async path that would
      // settle later cannot happen here.
      if (session.payment_status !== 'paid') break;
      {
        const verdict = await shouldApply(eq(subscriptions.userId, userId));
        if (verdict !== 'ok') { skipped = verdict; break; }
      }
      await db
        .update(subscriptions)
        .set({
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
          stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : null,
          plan: 'pro',
          status: 'active',
          updatedAt: new Date(),
        })
        .where(and(eq(subscriptions.userId, userId), notStaleSql(subscriptions.updatedAt, event.created)));
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      {
        const verdict = await shouldApply(eq(subscriptions.stripeSubscriptionId, subscription.id));
        if (verdict !== 'ok') { skipped = verdict; break; }
      }
      await db
        .update(subscriptions)
        .set({
          plan: 'free',
          status: 'canceled',
          updatedAt: new Date(),
        })
        .where(and(eq(subscriptions.stripeSubscriptionId, subscription.id), notStaleSql(subscriptions.updatedAt, event.created)));
      break;
    }

    // A refund does NOT delete the subscription, so `subscription.deleted` never
    // arrives for one. Without this arm a customer who gets a full refund keeps
    // Pro forever: the event is unhandled, the route still 200s, and Stripe
    // stops retrying. Match on the customer id captured at checkout.
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      // Partial refunds are a courtesy, not a cancellation — only a full one
      // gives back the whole payment.
      if (!charge.refunded || charge.amount_refunded < charge.amount) break;
      const customerId = typeof charge.customer === 'string' ? charge.customer : null;
      if (!customerId) break;
      {
        const verdict = await shouldApply(eq(subscriptions.stripeCustomerId, customerId));
        if (verdict !== 'ok') { skipped = verdict; break; }
      }
      await db
        .update(subscriptions)
        .set({ plan: 'free', status: 'canceled', updatedAt: new Date() })
        .where(and(eq(subscriptions.stripeCustomerId, customerId), notStaleSql(subscriptions.updatedAt, event.created)));
      break;
    }

    // Unreachable while CHECKOUT_MODE is 'payment' — no subscription is ever
    // created. Kept because flipping to 'subscription' is a one-line change
    // (see CHECKOUT_MODE), and without these arms that flip would grant Pro
    // once and then never revoke it on cancellation or a failed renewal. Note
    // there is deliberately no invoice.payment_failed arm: its object shape is
    // version-dependent, and past_due already arrives here.
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      {
        const verdict = await shouldApply(eq(subscriptions.stripeSubscriptionId, subscription.id));
        if (verdict !== 'ok') { skipped = verdict; break; }
      }
      // Fail closed: only a genuinely live subscription keeps Pro. An unknown
      // or newly-added status must not silently mean "paid".
      const active = subscription.status === 'active' || subscription.status === 'trialing';
      await db
        .update(subscriptions)
        .set({
          plan: active ? 'pro' : 'free',
          status: active ? 'active' : subscription.status === 'past_due' ? 'past_due' : 'canceled',
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          updatedAt: new Date(),
        })
        .where(and(eq(subscriptions.stripeSubscriptionId, subscription.id), notStaleSql(subscriptions.updatedAt, event.created)));
      break;
    }
  }

  return NextResponse.json({ received: true, ...(skipped ? { skipped } : {}) });
}
