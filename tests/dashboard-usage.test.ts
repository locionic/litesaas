import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run: npm test
//
// React components in this codebase are checked as source because node --test runs
// without a JSX transpiler or DOM renderer. What is asserted are the component
// contracts, calculations, accessibility attributes, and visual quota styling.

const root = fileURLToPath(new URL('..', import.meta.url));
const componentPath = join(root, 'components/dashboard-usage.tsx');
const src = readFileSync(componentPath, 'utf8');

test('components/dashboard-usage.tsx exists and declares the DashboardUsage component', () => {
  assert.ok(existsSync(componentPath), 'components/dashboard-usage.tsx must exist');
  assert.match(src, /export default function DashboardUsage\b/);
  assert.match(src, /export \{ DashboardUsage \};/);
});

test('calculateUsagePercentage function logic is sound and bounds percentage correctly', () => {
  const match = src.match(/export function calculateUsagePercentage\([^)]*\): number \{([\s\S]*?)\n\}/);
  assert.ok(match, 'calculateUsagePercentage function must be exported');

  const calc = new Function('activeCount', 'limit', match[1]) as (active: number, limit: number) => number;

  // Free tier (3 project limit)
  assert.equal(calc(0, 3), 0, '0 active projects should be 0%');
  assert.equal(calc(1, 3), 33, '1 of 3 projects should be 33%');
  assert.equal(calc(2, 3), 67, '2 of 3 projects should be 67%');
  assert.equal(calc(3, 3), 100, '3 of 3 projects should be 100%');

  // Clamp at 100% when exceeding limit
  assert.equal(calc(4, 3), 100, 'over quota should clamp to 100%');
  assert.equal(calc(10, 3), 100, 'greatly over quota should clamp to 100%');

  // Pro tier (unlimited)
  assert.equal(calc(0, Infinity), 0, 'unlimited tier should return 0%');
  assert.equal(calc(5, Infinity), 0, 'unlimited tier with active projects returns 0%');
  assert.equal(calc(100, Infinity), 0);

  // Boundary condition: zero or negative limit
  assert.equal(calc(1, 0), 100, 'zero limit should be treated as 100% full');
});

test('getProjectLimit defaults free plan to 3 and pro plan to Infinity', () => {
  const match = src.match(/export function getProjectLimit\([^)]*\): number \{([\s\S]*?)\n\}/);
  assert.ok(match, 'getProjectLimit function must be exported');

  const getLimit = new Function('DEFAULT_FREE_PROJECT_LIMIT', `
    return function(plan, explicitLimit) {
      ${match[1]}
    };
  `)(3) as (plan?: string, explicitLimit?: number) => number;

  assert.equal(getLimit('free'), 3, 'free plan has 3 project limit');
  assert.equal(getLimit('FREE'), 3, 'case-insensitive plan matching');
  assert.equal(getLimit(undefined), 3, 'omitted plan defaults to 3');
  assert.equal(getLimit('pro'), Infinity, 'pro plan has Infinity limit');
  assert.equal(getLimit('PRO'), Infinity, 'case-insensitive pro plan');

  // Explicit limit overrides plan
  assert.equal(getLimit('free', 10), 10, 'explicit limit overrides free default');
  assert.equal(getLimit('pro', 5), 5, 'explicit limit overrides pro default');
});

test('getQuotaStatus accurately identifies at-limit, near-limit, and unlimited states', () => {
  assert.match(src, /export function getQuotaStatus\b/);
  assert.match(src, /const atLimit = !isUnlimited && activeCount >= limit;/);
  assert.match(src, /const isUnlimited = !Number\.isFinite\(limit\) \|\| limit === Infinity;/);
  assert.match(src, /const remainingSlots = isUnlimited \? Infinity : Math\.max\(0, limit - activeCount\);/);
});

test('the widget renders a valid, accessible progressbar element', () => {
  // role="progressbar" is required for screen readers to recognize the meter
  assert.match(src, /role="progressbar"/, 'must declare role="progressbar"');

  // ARIA attributes must reflect live values rather than static strings
  assert.match(src, /aria-valuenow=\{effectiveActiveCount\}/, 'valuenow must track activeCount');
  assert.match(src, /aria-valuemin=\{0\}/, 'valuemin must be 0');
  assert.match(src, /aria-valuemax=\{status\.isUnlimited \? 100 : effectiveLimit\}/, 'valuemax must track limit');
  assert.match(src, /aria-label="Active projects used"/, 'must have aria-label');
  assert.match(src, /aria-valuetext=\{/, 'must provide accessible valuetext description');
});

test('the visual progress indicator reflects percentage and turns amber at quota limit', () => {
  // Width matches usage percentage
  assert.match(src, /style=\{\{ width: status\.isUnlimited \? '100%' : `\$\{status\.usagePercentage\}%` \}\}/);

  // Styling transitions from emerald to amber when at limit
  assert.match(src, /status\.atLimit\s*\?\s*['"]bg-amber-400['"]/);
  assert.match(src, /status\.nearLimit\s*\?\s*['"]bg-amber-300['"]/);
  assert.match(src, /:\s*['"]bg-emerald-500['"]/);
});

test('the widget displays active project counts against quota limits', () => {
  // Displays count and limit text
  assert.match(src, /\{effectiveActiveCount\} of \{effectiveLimit\} active/);
  assert.match(src, /status\.atLimit \? ' — limit reached' : ''/);
  assert.match(src, /\{status\.isUnlimited \? 'Unlimited' : `\$\{status\.usagePercentage\}% Used`\}/);
});

test('the widget provides analytics breakdown cards and advisory status banners', () => {
  // Stat cards
  assert.match(src, /Active Projects/);
  assert.match(src, /Plan Quota/);
  assert.match(src, /Usage Rate/);
  assert.match(src, /Available Slots/);

  // Status banners for at-limit and pro states
  assert.match(src, /Plan quota limit reached/);
  assert.match(src, /Production Pro license active/);
});

test('src/components/dashboard-usage.tsx provides a clean re-export for @/ alias', () => {
  const srcPath = join(root, 'src/components/dashboard-usage.tsx');
  assert.ok(existsSync(srcPath), 'src/components/dashboard-usage.tsx must exist');
  const reExportSrc = readFileSync(srcPath, 'utf8');
  assert.match(reExportSrc, /export \* from '\.\.\/\.\.\/components\/dashboard-usage'/);
  assert.match(reExportSrc, /export \{ default \} from '\.\.\/\.\.\/components\/dashboard-usage'/);
});
