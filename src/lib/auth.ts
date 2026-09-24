import crypto from 'crypto';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { users, sessions, subscriptions, type User } from '@/db/schema';
import { eq } from 'drizzle-orm';

const COOKIE_NAME = 'litesaas_session';
const SESSION_EXPIRY_DAYS = 30;

/**
 * Hash password with crypto.scrypt
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verify password against stored hash
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), derivedKey);
}

/**
 * Create a new user session and set HttpOnly cookie
 */
export async function createSession(userId: string): Promise<string> {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

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
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(COOKIE_NAME)?.value;
    if (!sessionId) return null;

    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session || session.expiresAt.getTime() < Date.now()) {
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
  } catch {
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
 */
export async function seedDemoUserIfNeeded() {
  try {
    const existing = await db.query.users.findFirst({
      where: eq(users.email, 'demo@litesaas.dev'),
    });

    if (!existing) {
      const demoId = 'usr_demo123456';
      await db.insert(users).values({
        id: demoId,
        email: 'demo@litesaas.dev',
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
