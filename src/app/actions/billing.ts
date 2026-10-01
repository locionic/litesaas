'use server';

import { getCurrentUser } from '@/lib/auth';
import { stripe, CHECKOUT_MODE } from '@/lib/stripe';
import { isLemonSqueezyConfigured, createCheckout } from '@/lib/lemonsqueezy';
import { db } from '@/db';
import { subscriptions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

// Set BILLING_PROVIDER=lemonsqueezy to sell through LemonSqueezy instead.
// Defaults to stripe so existing clones keep working untouched.
const BILLING_PROVIDER = process.env.BILLING_PROVIDER === 'lemonsqueezy' ? 'lemonsqueezy' : 'stripe';

export async function upgradeToProAction() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  // `redirect()` THROWS a NEXT_REDIRECT error, so it must never sit inside a
  // try whose catch is a catch-all: the catch would swallow the success
  // redirect and send the user to the error banner instead of the checkout
  // page. Only the network call goes in the try — the redirect stays outside.
  let checkoutUrl: string | null = null;

  if (BILLING_PROVIDER === 'lemonsqueezy') {
    if (!isLemonSqueezyConfigured()) {
      redirect('/dashboard?billing=unconfigured');
    }
    try {
      checkoutUrl = await createCheckout({ userId: user.id, email: user.email });
    } catch {
      // A rejected key or an LS outage. Don't 500 the dashboard on it.
      redirect('/dashboard?billing=error');
    }
    // A 200 that carries no URL is not a usable checkout (an archived variant,
    // an inactive store). Falling through here would hand the customer to a
    // processor the operator did not select.
    if (!checkoutUrl) {
      redirect('/dashboard?billing=error');
    }
  }

  // If Stripe is configured with live keys, create real checkout session.
  // Gated on the provider too, not just on `!checkoutUrl`: BILLING_PROVIDER is
  // how an operator picks who gets paid. Falling through to Stripe because the
  // LemonSqueezy half of the config was left incomplete charges customers
  // through a processor they excluded — and the template ships both sets of
  // variables, so both are usually present in .env.
  if (BILLING_PROVIDER === 'stripe' && stripe && process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID) {
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    // Stripe returns the customer to success_url *after* the charge clears, so
    // a localhost origin means a paid customer lands on their own machine —
    // no Pro, no confirmation, a chargeback. Both .env.example and
    // docker-compose.yml ship localhost and the README's deploy section never
    // says to change it, so this is a plausible omission rather than a
    // misconfiguration anyone would expect to be caught. Refusing costs the
    // operator a minute of config; taking the money costs a customer.
    // Dev is untouched (NODE_ENV !== production), so `npm run dev` still
    // upgrades locally with no variables set. NOTE: Next.js inlines NEXT_PUBLIC_*
    // when it builds, so this reads the value from build time, not from the
    // container's environment — a Dockerfile ARG, not a runtime variable.
    if (process.env.NODE_ENV === 'production' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(origin)) {
      redirect('/dashboard?billing=appurl');
    }
    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID,
            quantity: 1,
          },
        ],
        mode: CHECKOUT_MODE,
        success_url: `${origin}/dashboard?upgraded=true`,
        cancel_url: `${origin}/dashboard`,
        customer_email: user.email,
        // Under mode: 'payment' Stripe does NOT create a Customer on its own —
        // `customer_email` only links an existing one. Without this the session
        // can come back with customer: null, so `checkout.session.completed`
        // stores no stripe_customer_id, and `charge.refunded` — which matches on
        // exactly that column — never finds the row. A refund would then be
        // silently ignored and the customer keeps Pro forever. Subscription
        // mode created a Customer implicitly; one-time mode has to ask.
        customer_creation: 'always',
        metadata: {
          userId: user.id,
        },
      });

      checkoutUrl = session.url;
    } catch {
      // A placeholder or revoked key rejects the request. Don't 500 the
      // dashboard on it — send the operator somewhere that explains why.
      redirect('/dashboard?billing=error');
    }
  }

  if (checkoutUrl) {
    redirect(checkoutUrl);
  }

  // No payment provider is configured. Granting Pro here would let anyone with
  // an account upgrade for free in production, so only allow it in dev.
  if (process.env.NODE_ENV === 'production') {
    redirect('/dashboard?billing=unconfigured');
  }

  // Mock upgrade for zero-config local development demo
  await db
    .update(subscriptions)
    .set({
      plan: 'pro',
      status: 'active',
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.userId, user.id));

  revalidatePath('/dashboard');
}
