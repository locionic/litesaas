'use server';

import { redirect } from 'next/navigation';
import { db } from '@/db';
import { users, subscriptions } from '@/db/schema';
import { hashPassword, verifyPassword, createSession, destroySession } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

export type AuthState = {
  error?: string;
  success?: boolean;
};

export async function loginAction(prevState: AuthState | null, formData: FormData): Promise<AuthState> {
  const email = (formData.get('email') as string)?.trim().toLowerCase();
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Please provide both email and password.' };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { error: 'Invalid email or password.' };
  }

  await createSession(user.id);
  redirect('/dashboard');
}

export async function registerAction(prevState: AuthState | null, formData: FormData): Promise<AuthState> {
  const name = (formData.get('name') as string)?.trim();
  const email = (formData.get('email') as string)?.trim().toLowerCase();
  const password = formData.get('password') as string;

  if (!name || !email || !password) {
    return { error: 'All fields are required.' };
  }

  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters long.' };
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existing) {
    return { error: 'An account with this email already exists.' };
  }

  const userId = `usr_${crypto.randomBytes(12).toString('hex')}`;
  const passwordHash = hashPassword(password);

  await db.insert(users).values({
    id: userId,
    email,
    name,
    passwordHash,
    role: 'user',
  });

  // Assign default free tier subscription
  await db.insert(subscriptions).values({
    id: `sub_${crypto.randomBytes(12).toString('hex')}`,
    userId,
    plan: 'free',
    status: 'active',
  });

  await createSession(userId);
  redirect('/dashboard');
}

export async function logoutAction() {
  await destroySession();
  redirect('/login');
}
