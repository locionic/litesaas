/**
 * Signup input validation, kept free of Next imports so it is unit-testable
 * outside the request runtime (src/app/actions/auth.ts is a 'use server'
 * module and cannot be imported under `node --test`).
 *
 * These are the server-side counterpart to the form's HTML attributes. A server
 * action is a plain POST endpoint, so `type="email"` and `minLength={8}` on the
 * client are suggestions the browser applies — not enforcement.
 */

/** Caps. Generous enough for real input, small enough to bound a row. */
export const MAX_EMAIL = 254; // RFC 5321 maximum path length
export const MAX_NAME = 100;
export const MAX_PASSWORD = 200;
export const MIN_PASSWORD = 8;
export const MAX_DESCRIPTION = 2000;

/**
 * Deliberately loose: the only job is to reject input that is obviously not an
 * address (and so can never receive mail), not to adjudicate RFC 5322. A strict
 * pattern rejects valid addresses.
 *
 * ponytail: there is no confirmation email, so a typo'd domain is only caught
 * at checkout. Add a verification step before this kit takes real money.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | null {
  if (email.length > MAX_EMAIL) return 'That email address is too long.';
  if (!EMAIL_RE.test(email)) return 'Please enter a valid email address.';
  return null;
}

/**
 * Returns an error message, or null when the input is acceptable. Checks run in
 * the order the user would fix them: presence, then shape, then length.
 */
export function validateRegistration(fields: {
  name: string;
  email: string;
  password: string;
}): string | null {
  const { name, email, password } = fields;

  if (!name || !email || !password) {
    return 'All fields are required.';
  }

  if (name.length > MAX_NAME) {
    return `Name must be ${MAX_NAME} characters or fewer.`;
  }

  const emailError = validateEmail(email);
  if (emailError) return emailError;

  if (password.length < MIN_PASSWORD) {
    return `Password must be at least ${MIN_PASSWORD} characters long.`;
  }

  if (password.length > MAX_PASSWORD) {
    return `Password must be ${MAX_PASSWORD} characters or fewer.`;
  }

  return null;
}

/**
 * Same reasoning as validateRegistration: the dashboard's `required` attribute
 * is a browser suggestion, and a server action is a plain POST, so without this
 * a single request writes a multi-megabyte row into the bind-mounted SQLite
 * file.
 */
export function validateProject(fields: { name: string; description: string | null }): string | null {
  const { name, description } = fields;

  if (!name) {
    return 'Project name is required.';
  }

  if (name.length > MAX_NAME) {
    return `Name must be ${MAX_NAME} characters or fewer.`;
  }

  if (description && description.length > MAX_DESCRIPTION) {
    return `Description must be ${MAX_DESCRIPTION} characters or fewer.`;
  }

  return null;
}