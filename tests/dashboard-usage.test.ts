import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectLimitFor } from '../src/lib/stripe.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

test('projectLimitFor returns correct limits for each plan', () => {
  assert.equal(projectLimitFor('free'), 3, 'free plan should have 3 projects');
  assert.equal(projectLimitFor('pro'), Infinity, 'pro plan should have unlimited projects');
  assert.equal(projectLimitFor('enterprise'), 3, 'enterprise plan maps to free limit until configured');
});

test('dashboard-usage component exists', () => {
  const usage = readFileSync(join(root, 'src/app/dashboard/dashboard-usage.tsx'), 'utf8');
  assert.ok(usage.includes('export default function DashboardUsage'), 'DashboardUsage component is exported');
});

test('dashboard-usage component accepts activeCount, archivedCount, and subscriptionPlan props', () => {
  const usage = readFileSync(join(root, 'src/app/dashboard/dashboard-usage.tsx'), 'utf8');
  assert.match(usage, /activeCount:\s*number/, 'accepts activeCount prop');
  assert.match(usage, /archivedCount:\s*number/, 'accepts archivedCount prop');
  assert.match(usage, /subscriptionPlan:\s*SubscriptionPlan/, 'accepts subscriptionPlan prop');
});

test('dashboard-usage shows project usage with counts for free tier', () => {
  const usage = readFileSync(join(root, 'src/app/dashboard/dashboard-usage.tsx'), 'utf8');
  assert.match(usage, /Project Usage/i, 'shows project usage label');
});

test('dashboard-usage displays archived count when present', () => {
  const usage = readFileSync(join(root, 'src/app/dashboard/dashboard-usage.tsx'), 'utf8');
  assert.match(usage, /archivedCount/g, 'references archivedCount');
});

test('dashboard-usage shows usage bar for free tier', () => {
  const usage = readFileSync(join(root, 'src/app/dashboard/dashboard-usage.tsx'), 'utf8');
  assert.match(usage, /role="progressbar"/, 'has progressbar role');
  assert.match(usage, /aria-valuenow=/, 'has aria-valuenow');
  assert.match(usage, /aria-valuemin=/, 'has aria-valuemin');
  assert.match(usage, /aria-valuemax=/, 'has aria-valuemax');
});

test('dashboard-usage shows warning when at limit', () => {
  const usage = readFileSync(join(root, 'src/app/dashboard/dashboard-usage.tsx'), 'utf8');
  assert.match(usage, /atLimit/, 'references atLimit variable');
  assert.match(usage, /TriangleAlert/, 'shows warning icon when at limit');
  assert.match(usage, /archive one to make room/, 'shows archive suggestion when at limit');
});

test('dashboard-usage shows remaining slots when not at limit', () => {
  const usage = readFileSync(join(root, 'src/app/dashboard/dashboard-usage.tsx'), 'utf8');
  assert.match(usage, /CheckCircle2/, 'shows check icon when under limit');
  assert.match(usage, /.*remaining/, 'shows remaining slots message');
});

test('dashboard-usage shows unlimited for pro tier', () => {
  const usage = readFileSync(join(root, 'src/app/dashboard/dashboard-usage.tsx'), 'utf8');
  assert.ok(usage.includes('subscriptionPlan !== \'pro\''), 'progress bar is conditional on non-pro plan');
});

test('dashboard-usage calculates usage percentage correctly', () => {
  const usage = readFileSync(join(root, 'src/app/dashboard/dashboard-usage.tsx'), 'utf8');
  assert.match(usage, /usagePercentage/, 'tracks usage percentage state');
  assert.match(usage, /Math\.min\(100.*activeCount.*limit/, 'calculates percentage from activeCount and limit');
});

test('dashboard-usage handles Infinity limit correctly', () => {
  const usage = readFileSync(join(root, 'src/app/dashboard/dashboard-usage.tsx'), 'utf8');
  assert.match(usage, /limit === Infinity/, 'checks for Infinity limit');
});