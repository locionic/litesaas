import Stripe from 'stripe';

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    })
  : null;

export const PLANS = [
  {
    id: 'free',
    name: 'Free Indie',
    price: '$0',
    frequency: 'forever',
    description: 'Perfect for prototyping, side projects, and local experimentation.',
    features: [
      'Single SQLite database file',
      'Up to 3 active projects',
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
