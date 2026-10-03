'use server';

import crypto from 'crypto';
import { getCurrentUser } from '@/lib/auth';
import { stripe, isRealSecret, CHECKOUT_MODE } from '@/lib/stripe';
import { isLemonSqueezyConfigured, createCheckout } from '@/lib/lemonsqueezy';
import { db } from '@/db';
import { subscriptions } from '@/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

// Set BILLING_PROVIDER=lemonsqueezy to sell through LemonSqueezy instead.
// Defaults to stripe so existing clones keep working untouched.
const BILLING_PROVIDER = process.env.BILLING_PROVIDER === 'lemonsqueezy' ? 'lemonsqueezy' : 'stripe';

// Where the customer lands once money has moved. Both providers return them
// here — Stripe via success_url, LemonSqueezy via product_options.redirect_url —
// and both read this one origin, so it is decided once.
//
// NOTE: Next.js inlines NEXT_PUBLIC_* when it builds, so this reads the value
// from build time, not from the container's environment — a Dockerfile ARG, not
// a runtime variable. Restarting cannot pick up a changed NEXT_PUBLIC_APP_URL.
const appOrigin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const successUrl = `${appOrigin}/dashboard?upgraded=true`;

/**
 * Refuse to take money while the return address is the operator's own machine.
 *
 * One function rather than a copy per provider: .env.example and
 * docker-compose.yml both ship localhost, and the README's deploy section never
 * says to change it, so this is a plausible omission rather than a
 * misconfiguration anyone would expect to be caught. A paid customer sent to
 * `http://localhost:3000` gets no Pro screen, no confirmation, and eventually a
 * chargeback.
 *
 * Dev is untouched (NODE_ENV !== production), so `npm run dev` still upgrades
 * locally with no variables set. Called from both arms rather than hoisted above
 * them, so an unconfigured provider still reports `?billing=unconfigured` — the
 * half that is actually missing — instead of being sent to fix the origin first.
 */
function redirectIfLocalOrigin(): void {
  if (
    process.env.NODE_ENV === 'production' &&
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(appOrigin)
  ) {
    redirect('/dashboard?billing=appurl');
  }
}

/**
 * The secret a LemonSqueezy event is matched against, minted once per subscription.
 *
 * Generated on the first attempt and reused by every one after it. Rotating per
 * attempt would be tidier and is wrong: two clicks in a row would leave the
 * first checkout carrying a nonce that is no longer on the row, so the customer
 * pays and the webhook matches nothing at all. It also has to outlive the
 * checkout — a refund arrives days later and must match the same row.
 *
 * `db.query.subscriptions` rather than a bare UPDATE-and-assume: the row is
 * created at signup, but an UPDATE that matched zero rows would return a nonce
 * that was never stored, and every event would then resolve to no row — a paid
 * customer who never gets Pro, with the webhook reporting success throughout.
 */
async function checkoutNonce(userId: string): Promise<string> {
  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });
  if (row?.lemonNonce) return row.lemonNonce;

  // 32 bytes, matching the session id in src/lib/auth.ts. It has to be
  // unguessable: an attacker can put any value they like in `custom` on a
  // checkout of their own making, and this is the only thing standing between
  // that and a row they do not own.
  const nonce = crypto.randomBytes(32).toString('hex');

  // Mint-and-hope is a lost update on the very first click, which is the click
  // that matters most. Two of them — a double-click, two tabs, a retried POST —
  // both read the null above, both mint, and the second write orphans the
  // first. That first checkout is already at LemonSqueezy by then, so the
  // customer pays on it, the webhook resolves the nonce to no row, and answers
  // `skipped: no subscription` with a 200. Paid, no Pro, nothing logged
  // anywhere. Same shape as the read-then-write in toggleProjectStatusAction,
  // and fixed the same way: let SQLite arbitrate instead of both requests
  // deciding independently.
  const won = await db
    .update(subscriptions)
    .set({ lemonNonce: nonce })
    .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.lemonNonce)));

  if (won.changes === 1) return nonce;

  // Lost. The row now carries the other request's nonce, and that is the one a
  // webhook can match — returning ours here is precisely the bug above. One
  // re-read settles it, because the winner's write has already committed: both
  // callers end up returning the same nonce, so the two checkouts are both
  // good rather than one of them being a dud.
  const winner = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });
  return winner?.lemonNonce ?? nonce;
}

export async function upgradeToProAction() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  // The dashboard hides the button for a Pro account, and that is a
  // convenience — not a guard. Nothing about the hidden button stops a caller
  // who is already on Pro from reaching this action by any other route: a
  // stale tab open from before the webhook landed, a form restored from bfcache,
  // a support engineer pasting the path. Without this, one of them is handed a
  // live checkout for the plan they already pay for.
  //
  // The same rule the free-tier cap follows, for the same reason: the check
  // belongs at the trust boundary, and the client-side affordance is there so
  // nobody has to run into it, not so the server believes it.
  if (user.subscriptionPlan === 'pro') {
    redirect('/dashboard');
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
    // Same rule as the Stripe arm, and for the same reason: the redirect_url
    // below is a localhost address on exactly the deploys .env.example
    // describes, and LemonSqueezy returns the customer there after the charge.
    redirectIfLocalOrigin();
    try {
      checkoutUrl = await createCheckout({
        nonce: await checkoutNonce(user.id),
        email: user.email,
        redirectUrl: successUrl,
      });
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
    redirectIfLocalOrigin();
    // The other half of the same trap, and the one that costs a customer money.
    // `checkout.session.completed` is the only thing that turns a paid order into
    // Pro, and it arrives at /api/webhooks/stripe. With no signing secret — or
    // the `whsec_...` placeholder .env.example ships — every delivery fails
    // verification, always 400, retried for days and never accepted. The card is
    // charged in the meantime and ?upgraded=true tells the customer to wait for
    // a webhook that cannot succeed.
    //
    // `isRealSecret`, not `!process.env.STRIPE_WEBHOOK_SECRET`: the placeholder
    // is non-empty, so a truthiness test passes on exactly the deploy that is
    // broken. Unlike the origin guard this is not limited to production — a
    // missing webhook is never the right value, in any environment.
    if (!isRealSecret(process.env.STRIPE_WEBHOOK_SECRET)) {
      redirect('/dashboard?billing=webhook');
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
        success_url: successUrl,
        cancel_url: `${appOrigin}/dashboard`,
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

    // The same rule as the LemonSqueezy arm above, on the other provider.
    // `CheckoutSession.url` is `string | null` in the SDK, and a null there used
    // to mean "carry on" — out of the block and into the "no payment provider
    // configured" fall-through, which in production blames the price id the
    // operator has already set, and in dev silently grants Pro for free.
    if (!checkoutUrl) {
      redirect('/dashboard?billing=error');
    }
  }

  if (checkoutUrl) {
    redirect(checkoutUrl);
  }

  // No payment provider is configured. Granting Pro here would let anyone with
  // an account upgrade for free in production, so only allow it in dev.
  //
  // `stripe` is null unless STRIPE_SECRET_KEY is a real secret, and the only
  // way to reach this line is with a real Stripe key and no usable price id.
  // So "you have no key" is not a cause the banner should be able to give —
  // that is what the operator already set, and what they were told to go and
  // set. Name the half that is actually missing.
  if (process.env.NODE_ENV === 'production') {
    redirect(stripe ? '/dashboard?billing=price' : '/dashboard?billing=unconfigured');
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
