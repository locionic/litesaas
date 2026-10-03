import Stripe from 'stripe';

/**
 * `.env.example` ships placeholder values (sk_test_51..., price_1..., whsec_...).
 * If those are copied verbatim, treating them as live makes every attempt fail
 * against the Stripe API. Treat obvious placeholders as "not configured" so the
 * zero-config dev demo still works.
 *
 * Exported so the webhook signing secret gets the same reading as the API key.
 * It is not optional in the way an unused variable is: `checkout.session.completed`
 * is the only thing that turns a paid order into Pro, and a placeholder there
 * fails signature verification on every delivery — silently, because the value
 * is non-empty and so every truthiness test on it passes.
 */
export function isRealSecret(value: string | undefined): value is string {
  if (!value) return false;
  if (value.includes('...') || value.includes('<')) return false;
  return value.length >= 20;
}

export const stripe = isRealSecret(process.env.STRIPE_SECRET_KEY)
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    })
  : null;

/**
 * The billing mode the Stripe Checkout session is created in. Declared next to
 * PLANS because the two must agree: `checkout.session.completed` only proves
 * money moved for a one-time charge, and a `subscription` mode silently bills
 * customers every month for a product the pricing page calls a one-time
 * $19 license.
 *
 * ponytail: to sell Pro as recurring, set this to 'subscription' AND point
 * NEXT_PUBLIC_STRIPE_PRO_PRICE_ID at a recurring Price. The webhook's
 * `customer.subscription.*` arms are already wired for that case.
 */
export const CHECKOUT_MODE = 'payment';

/**
 * Active projects a free account may hold. Declared here, beside PLANS, because
 * the pricing table quotes it and `createProjectAction` enforces it — and the
 * whole point is that those two cannot drift. A free cap that exists only in
 * marketing copy is not a cap.
 */
export const FREE_PROJECT_LIMIT = 3;

/**
 * How many *active* projects a plan allows. Archived projects are excluded, so
 * archiving is always the way back in — which is what the dashboard's archive
 * toggle is for.
 *
 * ponytail: `Infinity` for pro because Pro is sold as "Unlimited projects &
 * records" and there is no record cap to enforce. If you ever meter usage, put
 * the number here rather than in the action.
 */
export function projectLimitFor(plan: string): number {
  return plan === 'pro' ? Infinity : FREE_PROJECT_LIMIT;
}

export const PLANS = [
  {
    id: 'free',
    name: 'Free Indie',
    price: '$0',
    frequency: 'forever',
    description: 'Perfect for prototyping, side projects, and local experimentation.',
    features: [
      'Single SQLite database file',
      `Up to ${FREE_PROJECT_LIMIT} active projects`,
      'Local development & Docker deploy',
      'Self-hosted session authentication',
      'Community Discord support',
    ],
    cta: 'Get Started Free',
    popular: false,
  },
  {
    id: 'pro',
    name: 'Production Pro',
    price: '$19',
    frequency: 'one-time license',
    description: 'For indie hackers launching profitable SaaS with zero recurring DB bills.',
    features: [
      'Unlimited projects & records',
      'Automated Litestream S3 replication',
      'Stripe & LemonSqueezy Webhooks',
      'Optimized WAL concurrency configuration',
      'Single-box 5,000+ req/s benchmarks',
      'Lifetime updates & source code',
    ],
    cta: 'Upgrade to Pro',
    popular: true,
  },
];
