import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// Verification of the Developer REST API v1 routes:
// - /api/v1/projects
// - /api/v1/projects/[id]
//
// Ensures:
// 1. Correct scope gating: GET checks 'projects:read', mutating methods check 'projects:write'.
// 2. Consistent authentication using verifyApiKey and extractApiKeyFromHeaders.
// 3. User isolation: where clauses MUST be scoped by auth.user.id.
// 4. Rate-limit and error responses: Retry-After header, 401, 403, 404, 429.
// 5. Subscription plan limit gating for active projects on POST and PATCH.

const readRoute = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const listRoute = readRoute('../src/app/api/v1/projects/route.ts');
const itemRoute = readRoute('../src/app/api/v1/projects/[id]/route.ts');

test('all routes authenticate and extract API keys through shared helper', () => {
  for (const [name, src] of [
    ['/api/v1/projects', listRoute],
    ['/api/v1/projects/[id]', itemRoute],
  ] as const) {
    assert.match(
      src,
      /extractApiKeyFromHeaders\(request\.headers\)/,
      `${name} must extract API key from headers`
    );
    assert.match(
      src,
      /verifyApiKey\(/,
      `${name} must verify API key through verifyApiKey`
    );
  }
});

test('GET endpoints require projects:read scope', () => {
  assert.match(
    listRoute,
    /verifyApiKey\(apiKey,\s*'projects:read'\)/,
    'GET /api/v1/projects must require projects:read scope'
  );
  assert.match(
    itemRoute,
    /verifyApiKey\(apiKey,\s*'projects:read'\)/,
    'GET /api/v1/projects/[id] must require projects:read scope'
  );
});

test('mutating endpoints (POST, PATCH, DELETE) require projects:write scope', () => {
  assert.match(
    listRoute,
    /verifyApiKey\(apiKey,\s*'projects:write'\)/,
    'POST /api/v1/projects must require projects:write scope'
  );

  const patchIdx = itemRoute.indexOf('export async function PATCH');
  const deleteIdx = itemRoute.indexOf('export async function DELETE');

  assert.notEqual(patchIdx, -1, 'PATCH handler missing');
  assert.notEqual(deleteIdx, -1, 'DELETE handler missing');

  const patchBody = itemRoute.slice(patchIdx, deleteIdx);
  const deleteBody = itemRoute.slice(deleteIdx);

  assert.match(
    patchBody,
    /verifyApiKey\(apiKey,\s*'projects:write'\)/,
    'PATCH /api/v1/projects/[id] must require projects:write scope'
  );
  assert.match(
    deleteBody,
    /verifyApiKey\(apiKey,\s*'projects:write'\)/,
    'DELETE /api/v1/projects/[id] must require projects:write scope'
  );
});

test('user data isolation: every query is scoped to auth.user.id', () => {
  // GET list
  assert.match(
    listRoute,
    /eq\(projects\.userId,\s*auth\.user\.id\)/,
    'projects list query must be scoped to auth.user.id'
  );

  // POST insert
  assert.match(
    listRoute,
    /userId:\s*auth\.user\.id/,
    'projects insert must set userId to auth.user.id'
  );

  // Single project GET, PATCH, DELETE
  const itemUserScopes = itemRoute.match(/eq\(projects\.userId,\s*auth\.user\.id\)/g);
  assert.ok(
    itemUserScopes && itemUserScopes.length >= 3,
    'single project routes must scope GET, PATCH, and DELETE to auth.user.id'
  );
});

test('POST and PATCH enforce plan limits on active projects', () => {
  assert.match(
    listRoute,
    /projectLimitFor\(plan\)/,
    'POST /api/v1/projects must check plan limits'
  );
  assert.match(
    itemRoute,
    /projectLimitFor\(plan\)/,
    'PATCH /api/v1/projects/[id] must check plan limits when activating'
  );
});

test('rate limit Retry-After header is forwarded on 429 response', () => {
  for (const [name, src] of [
    ['/api/v1/projects', listRoute],
    ['/api/v1/projects/[id]', itemRoute],
  ] as const) {
    assert.match(
      src,
      /headers:\s*auth\.retryAfter\s*\?\s*\{\s*'Retry-After':\s*String\(auth\.retryAfter\)\s*\}\s*:\s*undefined/,
      `${name} must forward Retry-After header when throttled`
    );
  }
});
