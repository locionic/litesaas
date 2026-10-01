'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { db } from '@/db';
import { users, subscriptions } from '@/db/schema';
import { hashPassword, verifyPassword, DUMMY_HASH } from '@/lib/password';
import { createSession, destroySession, DEMO_EMAIL } from '@/lib/auth';
import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit';
import { validateRegistration } from '@/lib/validate';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

export type AuthState = {
  error?: string;
  success?: boolean;
};

/** Per-network sign-in budget, and a tighter per-account one. */
const LOGIN_IP_LIMIT = 10;
const LOGIN_EMAIL_LIMIT = 5;
const REGISTER_IP_LIMIT = 5;

function minutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * Best-effort client IP. Behind the bundled reverse proxy x-forwarded-for holds
 * the real client; a bare local run has neither header, in which case every
 * visitor shares the 'unknown' bucket — acceptable for a single-box deploy.
 */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

export async function loginAction(prevState: AuthState | null, formData: FormData): Promise<AuthState> {
  const email = (formData.get('email') as string)?.trim().toLowerCase();
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Please provide both email and password.' };
  }

  // Throttle per-network first, then per-account. The per-account bucket is
  // cleared on success below so a typo doesn't lock a real user out.
  const ip = await clientIp();
  const ipKey = `login:ip:${ip}`;
  const emailKey = `login:email:${email}`;

  const ipCheck = checkRateLimit(ipKey, LOGIN_IP_LIMIT);
  if (!ipCheck.ok) {
    return {
      error: `Too many sign-in attempts from this network. Try again in ${minutes(ipCheck.retryAfterSeconds)} minute(s).`,
    };
  }

  // The per-account bucket is deliberately skipped for the shared demo account.
  // Its password is published in the README and it is seeded on every landing
  // page visit, so anyone can lock it for *everyone* with five wrong guesses —
  // a denial of service on the one feature the README leads with. There is
  // nothing to protect here: the credentials are already public. The per-IP
  // bucket above still applies, so a single host still can't grind through
  // guesses against a real account.
  if (email !== DEMO_EMAIL) {
    const emailCheck = checkRateLimit(emailKey, LOGIN_EMAIL_LIMIT);
    if (!emailCheck.ok) {
      return {
        error: `Too many failed sign-in attempts for this account. Try again in ${minutes(emailCheck.retryAfterSeconds)} minute(s).`,
      };
    }
  }

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  // Always run the KDF, even with no user row: `!user || verifyPassword(...)`
  // would short-circuit and return in ~0.1ms instead of scrypt's ~45ms, turning
  // login latency into an oracle for which emails are registered. Verifying
  // against a fixed dummy hash costs the same either way.
  if (!verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)) {
    return { error: 'Invalid email or password.' };
  }

  if (!user) {
    return { error: 'Invalid email or password.' };
  }

  // Both buckets, not just the account one. checkRateLimit counts on every
  // call — it cannot tell a success from a failure — so a bucket only stops
  // counting successes if the caller clears it. Leaving the IP bucket in place
  // meant ten *successful* sign-ins from one network locked out the eleventh,
  // which on shared NAT or a carrier CGNAT is a handful of colleagues, not an
  // attacker. Clearing it on success is safe: success means the password was
  // already correct, so nothing is left to grind.
  resetRateLimit(emailKey);
  resetRateLimit(ipKey);


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

  // A server action is a plain POST, so the form's type="email" and minLength
  // are client-side suggestions, not enforcement. Without these checks a single
  // request can write a 200KB name straight into the row.
  const invalid = validateRegistration({ name, email, password });
  if (invalid) {
    return { error: invalid };
  }

  // Signup is the cheapest place to burn CPU (scrypt) and spam accounts.
  const registerKey = `register:ip:${await clientIp()}`;
  const registerCheck = checkRateLimit(registerKey, REGISTER_IP_LIMIT);
  if (!registerCheck.ok) {
    return {
      error: `Too many accounts created from this network. Try again in ${minutes(registerCheck.retryAfterSeconds)} minute(s).`,
    };
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existing) {
    return { error: 'An account with this email already exists.' };
  }

  const userId = `usr_${crypto.randomBytes(12).toString('hex')}`;
  const passwordHash = hashPassword(password);

  // The findFirst above is not atomic with this insert, so two simultaneous
  // signups for the same address both see no existing row and race here. The
  // UNIQUE index is the real arbiter — the loser gets SQLITE_CONSTRAINT_UNIQUE,
  // which would otherwise surface as an opaque 500 instead of the same
  // friendly message the pre-check gives.
  try {
    await db.insert(users).values({
      id: userId,
      email,
      name,
      passwordHash,
      role: 'user',
    });
  } catch (err) {
    // Match the driver's stable error code, not its message text.
    if (err instanceof Error && (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { error: 'An account with this email already exists.' };
    }
    throw err;
  }

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
