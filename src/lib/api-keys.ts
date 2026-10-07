import crypto from 'crypto';
import { db } from '../db/index.ts';
import { apiKeys, users, type User, type ApiKey } from '../db/schema.ts';
import { eq } from 'drizzle-orm';
import { checkRateLimit } from './rate-limit.ts';

export const API_KEY_PREFIX = 'lsk_live_';
export const DEFAULT_SCOPES = ['projects:read', 'projects:write'] as const;
export type ApiScope = (typeof DEFAULT_SCOPES)[number] | '*';

export const API_KEY_RATE_LIMIT = 60; // 60 requests
export const API_KEY_RATE_WINDOW_MS = 60 * 1000; // per minute (60 seconds)

/**
 * Hash raw API key using SHA-256 for secure storage and constant-time lookup.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Generate a new random API key.
 * Format: lsk_live_<32 hex chars>
 * Returns raw key (shown to user once), prefix (stored for display), and SHA-256 hash (stored for lookup).
 */
export function generateApiKey(): { rawKey: string; keyPrefix: string; keyHash: string } {
  const secret = crypto.randomBytes(16).toString('hex');
  const rawKey = `${API_KEY_PREFIX}${secret}`;
  const keyPrefix = `${rawKey.slice(0, 17)}...`;
  const keyHash = hashApiKey(rawKey);
  return { rawKey, keyPrefix, keyHash };
}

/**
 * Check if the key's scopes satisfy the required scope.
 * Supports wildcard '*' for full access.
 */
export function hasScope(scopesString: string, requiredScope: ApiScope): boolean {
  const parts = scopesString.split(',').map((s) => s.trim());
  if (parts.includes('*')) return true;
  return parts.includes(requiredScope);
}

/**
 * Extract API key from standard HTTP request headers.
 * Supports both `Authorization: Bearer <key>` and `x-api-key: <key>`.
 */
export function extractApiKeyFromHeaders(headers: Headers): string | null {
  const auth = headers.get('authorization');
  if (auth) {
    const trimmed = auth.trim();
    if (trimmed.toLowerCase().startsWith('bearer ')) {
      return trimmed.slice(7).trim();
    }
    return trimmed;
  }
  const xApiKey = headers.get('x-api-key');
  if (xApiKey) {
    return xApiKey.trim();
  }
  return null;
}

export type VerifyApiKeyResult =
  | { valid: true; user: User; apiKey: ApiKey }
  | { valid: false; error: string; status: number; retryAfter?: number };

/**
 * Authenticate and authorize an API request with an API key.
 * Checks key format, existence in DB, expiration, required scope, and per-key rate limit.
 * Updates lastUsedAt on success.
 */
export async function verifyApiKey(
  keyOrHeader: string | null | undefined,
  requiredScope?: ApiScope
): Promise<VerifyApiKeyResult> {
  if (!keyOrHeader) {
    return {
      valid: false,
      error: 'Missing API key. Provide Authorization: Bearer <key> or x-api-key header.',
      status: 401,
    };
  }

  let rawKey = keyOrHeader.trim();
  if (rawKey.toLowerCase().startsWith('bearer ')) {
    rawKey = rawKey.slice(7).trim();
  }

  if (!rawKey.startsWith(API_KEY_PREFIX)) {
    return {
      valid: false,
      error: `Invalid API key format. Expected prefix "${API_KEY_PREFIX}".`,
      status: 401,
    };
  }

  const keyHash = hashApiKey(rawKey);

  const keyRecord = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.keyHash, keyHash),
  });

  if (!keyRecord) {
    return { valid: false, error: 'Invalid API key.', status: 401 };
  }

  // Check expiration
  if (keyRecord.expiresAt && keyRecord.expiresAt.getTime() < Date.now()) {
    return { valid: false, error: 'API key has expired.', status: 401 };
  }

  // Check scope
  if (requiredScope && !hasScope(keyRecord.scopes, requiredScope)) {
    return {
      valid: false,
      error: `API key lacks required scope: ${requiredScope}`,
      status: 403,
    };
  }

  // Rate limiting per API key (60 req/min)
  const rl = checkRateLimit(`apikey:${keyRecord.id}`, API_KEY_RATE_LIMIT, API_KEY_RATE_WINDOW_MS);
  if (!rl.ok) {
    return {
      valid: false,
      error: 'Rate limit exceeded for this API key. Max 60 requests per minute.',
      status: 429,
      retryAfter: rl.retryAfterSeconds,
    };
  }

  // Find user
  const user = await db.query.users.findFirst({
    where: eq(users.id, keyRecord.userId),
  });

  if (!user) {
    return { valid: false, error: 'User account not found.', status: 401 };
  }

  // Update lastUsedAt in background
  try {
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(apiKeys.id, keyRecord.id));
  } catch {
    // Non-fatal if update fails
  }

  return { valid: true, user, apiKey: keyRecord };
}
