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
 * An error whose message was written for the user, so a catch arm may hand it
 * straight back as form state.
 *
 * The distinction is the whole point. A server action catches everything thrown
 * inside it, and `err.message` on a driver fault is SQLite's own text — a
 * constraint name, a column list, or, for SQLITE_CANTOPEN, the absolute path of
 * the database file on the operator's disk. Painted into the form that tells the
 * user about the box, and tells anyone who can make the database fail about it
 * too. Throwing this for the messages we *mean* to show, and letting every other
 * fault collapse to one generic line, keeps the first group and drops the second.
 *
 * `auth.ts` reaches the same result a different way: it maps the one driver code
 * it recognises and `throw err` on the rest. That is right for signup, where the
 * alternative to a specific message is a 500 and the form is gone anyway. Here
 * the catch arm is already the form, so naming the class is the smaller change.
 */
export class UserError extends Error {}

/**
 * Read a text field off a submitted form.
 *
 * A server action accepts multipart/form-data, so a client can send any field
 * as a File part — `formData.get('name') as string` would be a lie, and
 * `File.prototype.trim` does not exist, which throws a TypeError and 500s the
 * action on an unauthenticated POST. A non-string part is simply absent as far
 * as these forms are concerned, so the field reads as empty and the ordinary
 * "required" message comes back.
 *
 * Lives here, not in one action, because every action that reads a form has the
 * same exposure: a server action is a plain POST endpoint and its shape is
 * whatever the request body claims it is.
 */
export function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

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