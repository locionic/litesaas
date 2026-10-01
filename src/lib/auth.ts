import crypto from 'crypto';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { users, sessions, subscriptions, type User } from '@/db/schema';
import { eq, lt } from 'drizzle-orm';
import { hashPassword } from './password';
import { isDemoEnabled } from './demo';

const COOKIE_NAME = 'litesaas_session';
const SESSION_EXPIRY_DAYS = 30;

/**
 * The zero-friction showcase account, seeded on first landing-page visit and
 * published in the README so visitors can try the app without signing up.
 */
export const DEMO_EMAIL = 'demo@litesaas.dev';

/**
 * Create a new user session and set HttpOnly cookie
 */
export async function createSession(userId: string): Promise<string> {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

  // Every login funnels through here, so this is the one place that can reap
  // the dead rows left behind by users who never came back to trigger the
  // expired-session check in getCurrentUser. Unbounded otherwise: one row per
  // sign-in, for the life of the database.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt,
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });

  return sessionId;
}

/**
 * Get currently authenticated user from session cookie
 */
export async function getCurrentUser(): Promise<(User & { subscriptionPlan: string }) | null> {
  // Deliberately OUTSIDE the try. `cookies()` is what forces a route to be
  // dynamic, and during static generation Next throws a DynamicServerError to
  // discover exactly that. A catch-all here swallowed that signal, and once the
  // catch also logged, it filled every `next build` with errors that are not
  // errors. Letting it propagate hands the decision back to Next, which is what
  // it is for. The catch below exists for database faults, not for this.
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COOKIE_NAME)?.value;
  if (!sessionId) return null;

  try {
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      return null;
    }

    if (session.expiresAt.getTime() < Date.now()) {
      // Reap as we go. Nothing else ever deletes an expired row, so without
      // this the table grows by one dead session per login forever.
      //
      // NB: deliberately does not clear the cookie. getCurrentUser also runs
      // inside the dashboard's server-component render, where Next seals the
      // cookie store and `delete()` throws ReadonlyRequestCookiesError — that
      // would 500 the page for every visitor holding a stale cookie. Clearing
      // it belongs in the actions, which may mutate cookies.
      await db.delete(sessions).where(eq(sessions.id, sessionId));
      return null;
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
    });

    if (!user) return null;

    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, user.id),
    });

    return {
      ...user,
      subscriptionPlan: sub?.plan || 'free',
    };
  } catch (err) {
    // Returning null here turns any database fault into "you are logged out",
    // and the dashboard redirects to /login on a null user — so a transient
    // SQLITE_BUSY or a full disk signs every visitor out with no trace. Log it:
    // keep the render from 500ing, but make the failure visible.
    console.error('getCurrentUser failed', err);
    return null;
  }
}

/**
 * Destroy current session and clear cookie
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COOKIE_NAME)?.value;

  if (sessionId) {
    try {
      await db.delete(sessions).where(eq(sessions.id, sessionId));
    } catch {
      // Ignore if session already deleted
    }
  }

  cookieStore.delete(COOKIE_NAME);
}

/**
 * Helper to ensure a demo account exists for zero-friction local testing
 *
 * Development only. This writes a *published* password — and a **Pro** plan —
 * for anyone who requests the landing page, so leaving it on in production
 * means every deployment of this kit ships a permanent backdoor that anyone
 * reading the README can walk straight into. Same rule as the mock upgrade in
 * upgradeToProAction: a demo affordance never runs where real users and real
 * money are.
 *
 * The hosted demo sets SEED_DEMO_USER=true; a local clone needs nothing.
 */
export async function seedDemoUserIfNeeded() {
  if (!isDemoEnabled(process.env)) return;

  try {
    const existing = await db.query.users.findFirst({
      where: eq(users.email, DEMO_EMAIL),
    });

    if (!existing) {
      const demoId = 'usr_demo123456';
      await db.insert(users).values({
        id: demoId,
        email: DEMO_EMAIL,
        name: 'Demo Founder',
        passwordHash: hashPassword('password123'),
        role: 'user',
      });

      await db.insert(subscriptions).values({
        id: 'sub_demo123456',
        userId: demoId,
        plan: 'pro',
        status: 'active',
      });
    }
  } catch {
    // Already seeded or ignore
  }
}
