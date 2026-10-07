import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateApiKey,
  hashApiKey,
  hasScope,
  extractApiKeyFromHeaders,
  verifyApiKey,
  API_KEY_PREFIX,
  API_KEY_RATE_LIMIT,
} from '../src/lib/api-keys.ts';
import { clearRateLimits } from '../src/lib/rate-limit.ts';
import { db } from '../src/db/index.ts';
import { users, apiKeys, subscriptions } from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';

test('generateApiKey generates key with correct prefix, length, and hash', () => {
  const { rawKey, keyPrefix, keyHash } = generateApiKey();

  assert.ok(rawKey.startsWith(API_KEY_PREFIX), `rawKey must start with ${API_KEY_PREFIX}`);
  assert.equal(rawKey.length, API_KEY_PREFIX.length + 32, 'rawKey must contain 32 random hex chars');
  assert.equal(keyHash, hashApiKey(rawKey), 'keyHash must match sha256 of rawKey');
  assert.ok(keyPrefix.startsWith(API_KEY_PREFIX), 'keyPrefix must start with prefix');
  assert.ok(keyPrefix.endsWith('...'), 'keyPrefix must end with ellipsis');
});

test('hashApiKey produces consistent sha256 hashes', () => {
  const key1 = 'lsk_live_1234567890abcdef1234567890abcdef';
  const expectedHash = crypto.createHash('sha256').update(key1).digest('hex');
  assert.equal(hashApiKey(key1), expectedHash);
  assert.equal(hashApiKey(key1), hashApiKey(key1));
});

test('hasScope checks permissions correctly', () => {
  assert.equal(hasScope('projects:read,projects:write', 'projects:read'), true);
  assert.equal(hasScope('projects:read,projects:write', 'projects:write'), true);
  assert.equal(hasScope('projects:read', 'projects:write'), false);
  assert.equal(hasScope('projects:write', 'projects:read'), false);
  assert.equal(hasScope('*', 'projects:read'), true);
  assert.equal(hasScope('*', 'projects:write'), true);
  assert.equal(hasScope('projects:read ,  projects:write', 'projects:write'), true);
});

test('extractApiKeyFromHeaders extracts Bearer token or x-api-key', () => {
  const h1 = new Headers({ authorization: 'Bearer lsk_live_abc123' });
  assert.equal(extractApiKeyFromHeaders(h1), 'lsk_live_abc123');

  const h2 = new Headers({ authorization: 'bearer lsk_live_def456' });
  assert.equal(extractApiKeyFromHeaders(h2), 'lsk_live_def456');

  const h3 = new Headers({ 'x-api-key': 'lsk_live_ghi789' });
  assert.equal(extractApiKeyFromHeaders(h3), 'lsk_live_ghi789');

  const h4 = new Headers({});
  assert.equal(extractApiKeyFromHeaders(h4), null);
});

test('verifyApiKey authentication flow', async () => {
  clearRateLimits();

  // Test missing key
  const missing = await verifyApiKey(null);
  assert.equal(missing.valid, false);
  assert.equal(missing.status, 401);

  // Test invalid prefix
  const invalidPrefix = await verifyApiKey('invalid_prefix_123');
  assert.equal(invalidPrefix.valid, false);
  assert.equal(invalidPrefix.status, 401);

  // Test non-existent key
  const nonExistent = await verifyApiKey(`${API_KEY_PREFIX}99999999999999999999999999999999`);
  assert.equal(nonExistent.valid, false);
  assert.equal(nonExistent.status, 401);

  // Create a real test user and API key in the DB
  const testUserId = `usr_test_${crypto.randomBytes(8).toString('hex')}`;
  await db.insert(users).values({
    id: testUserId,
    email: `apikey_test_${Date.now()}@example.com`,
    name: 'API Key Tester',
    passwordHash: 'dummy_hash',
  });

  const { rawKey: readOnlyKey, keyPrefix: prefix1, keyHash: hash1 } = generateApiKey();
  const keyId1 = `key_${crypto.randomBytes(8).toString('hex')}`;
  await db.insert(apiKeys).values({
    id: keyId1,
    userId: testUserId,
    name: 'Read Only Key',
    keyPrefix: prefix1,
    keyHash: hash1,
    scopes: 'projects:read',
  });

  // Successful verification with read scope
  const readSuccess = await verifyApiKey(readOnlyKey, 'projects:read');
  assert.equal(readSuccess.valid, true);
  if (readSuccess.valid) {
    assert.equal(readSuccess.user.id, testUserId);
    assert.equal(readSuccess.apiKey.id, keyId1);
  }

  // Verification failure when write scope is required
  const writeFail = await verifyApiKey(readOnlyKey, 'projects:write');
  assert.equal(writeFail.valid, false);
  assert.equal(writeFail.status, 403);

  // Test expired key
  const { rawKey: expiredKey, keyPrefix: prefixExp, keyHash: hashExp } = generateApiKey();
  const keyIdExp = `key_${crypto.randomBytes(8).toString('hex')}`;
  await db.insert(apiKeys).values({
    id: keyIdExp,
    userId: testUserId,
    name: 'Expired Key',
    keyPrefix: prefixExp,
    keyHash: hashExp,
    scopes: 'projects:read,projects:write',
    expiresAt: new Date(Date.now() - 10000), // 10 seconds ago
  });

  const expiredRes = await verifyApiKey(expiredKey);
  assert.equal(expiredRes.valid, false);
  assert.equal(expiredRes.status, 401);
  assert.match(expiredRes.error, /expired/i);

  // Test rate limiting on API key
  clearRateLimits();
  for (let i = 0; i < API_KEY_RATE_LIMIT; i++) {
    const res = await verifyApiKey(readOnlyKey, 'projects:read');
    assert.equal(res.valid, true, `request ${i + 1} should be valid`);
  }
  // The next request should exceed limit
  const rateLimited = await verifyApiKey(readOnlyKey, 'projects:read');
  assert.equal(rateLimited.valid, false);
  assert.equal(rateLimited.status, 429);
  assert.ok(rateLimited.retryAfter && rateLimited.retryAfter > 0);

  // Clean up test data
  clearRateLimits();
  await db.delete(users).where(eq(users.id, testUserId));
});
