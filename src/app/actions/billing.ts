'use server';

import { getCurrentUser } from '@/lib/auth';
import { stripe } from '@/lib/stripe';
import { db } from '@/db';
import { subscriptions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

export async function upgradeToProAction() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  // If Stripe is configured with live keys, create real checkout session
  if (stripe && process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID) {
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${origin}/dashboard?upgraded=true`,
      cancel_url: `${origin}/dashboard`,
      customer_email: user.email,
      metadata: {
        userId: user.id,
      },
    });

    if (session.url) {
      redirect(session.url);
    }
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
