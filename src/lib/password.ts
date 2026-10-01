import crypto from 'crypto';

/**
 * Password hashing, kept free of Next imports so it can be unit-tested outside
 * the request runtime (src/lib/auth.ts pulls in next/headers and the DB).
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * A real scrypt hash of a random secret, used as the comparison target when no
 * user row exists.
 *
 * scrypt with default N=16384 costs ~45ms. `loginAction` must spend that same
 * ~45ms on a miss, or response time tells an attacker which emails are
 * registered: a short-circuited `!user || verifyPassword(...)` answers in ~0.1ms
 * for an unknown address and ~45ms for a known one — a 400x oracle that
 * enumerates your user list. Verifying against this instead of returning early
 * equalizes the two paths.
 */
export const DUMMY_HASH = (() => {
  const derivedKey = crypto.scryptSync(crypto.randomBytes(32).toString('hex'), 'timing-equalizer', 64);
  return `timing-equalizer:${derivedKey.toString('hex')}`;
})();

/**
 * Verify a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: timingSafeEqual
 * throws when the two buffers differ in length, and a corrupt row (bad
 * migration, manual DB edit) would otherwise turn any login into a 500.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;

  const derivedKey = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(key, 'hex');
  if (stored.length !== derivedKey.length) return false;

  return crypto.timingSafeEqual(stored, derivedKey);
}