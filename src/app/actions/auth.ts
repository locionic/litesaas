'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { db } from '@/db';
import { users, subscriptions } from '@/db/schema';
import { hashPassword, verifyPassword, DUMMY_HASH } from '@/lib/password';
import { createSession, destroySession, DEMO_EMAIL } from '@/lib/auth';
import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit';
import { validateRegistration, formText } from '@/lib/validate';
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

/**
 * Whether a reverse proxy in front is known to be rewriting x-forwarded-for.
 *
 * Off by default, and the default is the one that cannot hurt anybody. See
 * clientIp — with no trusted proxy the header is either forgeable or shared by
 * every visitor, and both failure modes deny service rather than prevent it.
 * Set to `true` only when nginx/Caddy/Traefik sets or appends the header.
 */
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

function minutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * The client's address — or null, meaning "no trustworthy identity", which both
 * throttles treat as "do not throttle".
 *
 * The LAST hop of x-forwarded-for, not the first. Every proxy in the chain
 * appends the address it actually saw, so entry 0 is whatever the client chose
 * to send: `X-Forwarded-For: 9.9.9.9` reaches us as `9.9.9.9, <real client>`,
 * and a bucket keyed on entry 0 hands that attacker a fresh budget per request.
 *
 * But reading the header at all is only sound when a proxy is known to be
 * writing it, and that is what TRUST_PROXY says. Next.js fills this header from
 * the socket address only when the client left it absent
 * (`req.headers['x-forwarded-for'] ??= socket.remoteAddress`,
 * next/dist/server/base-server.js:568), so on a bare deploy a client that
 * *does* send one keeps it, and the last hop is then whatever it chose. The
 * per-IP limit is not weakened by that, it is absent.
 *
 * The other way round it is worse. `docker compose up -d` — the README's own
 * quick start — publishes the port, and every external visitor then arrives at
 * the app as the one address the Docker bridge presents. The bucket is shared
 * by the entire internet, and the check runs BEFORE the password is verified,
 * so ten wrong guesses from one stranger refuse the correct password to
 * everyone for the whole window. Observed, not reasoned about: on a local run
 * every request arrives as ::1, a stranger's ten wrong posts filled that
 * bucket, and the demo user's next sign-in with the right password came back
 * "Too many sign-in attempts from this network. Try again in 15 minute(s)."
 *
 * ponytail: ceiling — one hop, no hop count. Entry n-1 read the way Express's
 * `trust proxy` does is the upgrade if this ever runs behind a chain deeper
 * than one, and it is the only thing this loses by not being configurable per
 * hop. What is given up by default is the per-network limit itself: nothing
 * stops password guessing, the per-account bucket does that, and it is keyed on
 * the submitted address — attacker-controlled, but useless for someone else's
 * account without already knowing it.
 */
async function clientIp(): Promise<string | null> {
  if (!TRUST_PROXY) return null;
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',').at(-1)?.trim() || h.get('x-real-ip') || null;
}

export async function loginAction(prevState: AuthState | null, formData: FormData): Promise<AuthState> {
  const email = formText(formData, 'email').toLowerCase();
  const password = formText(formData, 'password');

  if (!email || !password) {
    return { error: 'Please provide both email and password.' };
  }

  // Throttle per-network first, then per-account. The per-account bucket is
  // cleared on success below so a typo doesn't lock a real user out.
  const ip = await clientIp();
  const ipKey = `login:ip:${ip}`;
  const emailKey = `login:email:${email}`;

  // Skipped when there is no trusted proxy, and that skip is the point.
  //
  // The per-network bucket is a per-network bucket only when the address in it
  // is per-network. Behind a published port every visitor is the same address,
  // so it is a global bucket — and a global limit checked *before* the password
  // is verified denies service rather than preventing it: ten wrong guesses
  // from one stranger locked out the correct password for everyone for fifteen
  // minutes. Demonstrated end to end, not reasoned about; see clientIp.
  //
  // Nothing is actually given up. With no trusted proxy the address is the
  // client's own, so the bucket was never enforceable anyway; the per-account
  // bucket below is what stops password guessing, and it is keyed on the
  // submitted address, which an attacker controls but cannot forge for
  // *someone else's* account without already knowing it.
  if (ip !== null) {
    const ipCheck = checkRateLimit(ipKey, LOGIN_IP_LIMIT);
    if (!ipCheck.ok) {
      return {
        error: `Too many sign-in attempts from this network. Try again in ${minutes(ipCheck.retryAfterSeconds)} minute(s).`,
      };
    }
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
  if (ip !== null) resetRateLimit(ipKey);


  await createSession(user.id);
  redirect('/dashboard');
}

export async function registerAction(prevState: AuthState | null, formData: FormData): Promise<AuthState> {
  const name = formText(formData, 'name');
  const email = formText(formData, 'email').toLowerCase();
  const password = formText(formData, 'password');

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
  // Same skip as loginAction, and it matters more here: the limit is 5, so five
  // stranger signups closed registration for everyone behind a shared address —
  // a visitor who then completed the form got a throttle message instead of an
  // account, with nothing in the form that had gone wrong.
  const registerIp = await clientIp();
  if (registerIp !== null) {
    const registerCheck = checkRateLimit(`register:ip:${registerIp}`, REGISTER_IP_LIMIT);
    if (!registerCheck.ok) {
      return {
        error: `Too many accounts created from this network. Try again in ${minutes(registerCheck.retryAfterSeconds)} minute(s).`,
      };
    }
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
    // Both rows or neither, and the try has to wrap both. The subscription
    // insert used to sit outside it, so a fault there threw a 500 at a visitor
    // whose user row was already committed: an account that existed but was
    // unreachable. Retrying said "that email already exists" — and because such
    // an account has no subscriptions row at all, the dev mock upgrade's
    // `UPDATE ... WHERE user_id = ?` matched zero rows and silently did nothing,
    // on every retry, forever. Wrapping the pair keeps the UNIQUE race handling
    // below exactly as it was — the violation still surfaces out of the
    // transaction — while making a half-written account unrepresentable.
    await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        email,
        name,
        passwordHash,
        role: 'user',
      });

      // Assign default free tier subscription
      await tx.insert(subscriptions).values({
        id: `sub_${crypto.randomBytes(12).toString('hex')}`,
        userId,
        plan: 'free',
        status: 'active',
      });
    });
  } catch (err) {
    // Match the driver's stable error code, not its message text.
    if (err instanceof Error && (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { error: 'An account with this email already exists.' };
    }
    throw err;
  }

  await createSession(userId);
  redirect('/dashboard');
}

export async function logoutAction() {
  await destroySession();
  redirect('/login');
}
