import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  packageActiveProjects,
  serializeBackupJson,
  serializeBackupCsv,
  createProjectBackup,
  type ExportRow,
  type ExportAccount,
  type StructuredProjectBackup,
} from '../src/lib/export.ts';

// Run: npm test
//
// Tests for project export and backup serialization helpers and the dashboard
// export action component.

const root = fileURLToPath(new URL('..', import.meta.url));
const componentPath = join(root, 'components/dashboard-export.tsx');
const componentSrc = readFileSync(componentPath, 'utf8');

const sampleProjects: ExportRow[] = [
  {
    id: 'prj_1',
    name: 'Active Alpha',
    description: 'First active project',
    status: 'active',
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-02T12:00:00.000Z'),
  },
  {
    id: 'prj_2',
    name: 'Active Beta',
    description: null,
    status: 'active',
    createdAt: new Date('2026-03-03T11:00:00.000Z'),
    updatedAt: new Date('2026-03-04T13:00:00.000Z'),
  },
  {
    id: 'prj_3',
    name: 'Archived Gamma',
    description: 'Older archived project',
    status: 'archived',
    createdAt: new Date('2026-02-01T08:00:00.000Z'),
    updatedAt: new Date('2026-02-15T09:00:00.000Z'),
  },
];

const sampleAccount: ExportAccount = {
  id: 'usr_1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  role: 'user',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-02-01T00:00:00.000Z'),
  plan: 'free',
  status: 'active',
  currentPeriodEnd: null,
};

test('packageActiveProjects packages metadata, timestamps, and status into structured backup', () => {
  const fixedDate = new Date('2026-03-10T15:30:00.000Z');
  const backup = packageActiveProjects(sampleProjects, {
    account: sampleAccount,
    activeOnly: true,
    now: fixedDate,
  });

  // Metadata summary
  assert.equal(backup.metadata.version, '1.0.0');
  assert.equal(backup.metadata.exportedAt, '2026-03-10T15:30:00.000Z');
  assert.equal(backup.metadata.totalProjects, 3);
  assert.equal(backup.metadata.activeProjects, 2);
  assert.equal(backup.metadata.archivedProjects, 1);

  // Active projects filtered by default
  assert.equal(backup.projects.length, 2);
  assert.deepEqual(
    backup.projects.map((p) => p.name),
    ['Active Alpha', 'Active Beta']
  );

  // Structured fields with ISO timestamp strings
  const first = backup.projects[0];
  assert.equal(first.id, 'prj_1');
  assert.equal(first.name, 'Active Alpha');
  assert.equal(first.description, 'First active project');
  assert.equal(first.status, 'active');
  assert.equal(first.createdAt, '2026-03-01T10:00:00.000Z');
  assert.equal(first.updatedAt, '2026-03-02T12:00:00.000Z');

  // Second project handles null description
  const second = backup.projects[1];
  assert.equal(second.description, null);

  // Account metadata
  assert.ok(backup.account);
  assert.equal(backup.account.id, 'usr_1');
  assert.equal(backup.account.email, 'ada@example.com');
  assert.equal('passwordHash' in (backup.account as any), false);
});

test('packageActiveProjects can include all projects when activeOnly is false', () => {
  const backup = packageActiveProjects(sampleProjects, { activeOnly: false });
  assert.equal(backup.projects.length, 3);
  assert.equal(backup.metadata.totalProjects, 3);
  assert.equal(backup.metadata.activeProjects, 2);
  assert.equal(backup.metadata.archivedProjects, 1);
});

test('serializeBackupJson produces valid structured JSON ending with newline', () => {
  const backup = packageActiveProjects(sampleProjects, { account: sampleAccount });
  const jsonStr = serializeBackupJson(backup);

  assert.ok(jsonStr.endsWith('\n'), 'JSON output must end with newline');
  const parsed = JSON.parse(jsonStr) as StructuredProjectBackup;

  assert.equal(parsed.metadata.activeProjects, 2);
  assert.equal(parsed.projects.length, 2);
  assert.equal(parsed.projects[0].name, 'Active Alpha');
  assert.equal(parsed.account?.email, 'ada@example.com');
});

test('serializeBackupCsv produces RFC 4180 CSV with formula protection', () => {
  const projectsWithFormula: ExportRow[] = [
    {
      id: 'prj_f1',
      name: '=SUM(1,2)',
      description: 'Formula test',
      status: 'active',
      createdAt: new Date('2026-03-01T10:00:00.000Z'),
      updatedAt: new Date('2026-03-01T10:00:00.000Z'),
    },
  ];

  const csvStr = serializeBackupCsv(projectsWithFormula);
  assert.ok(csvStr.endsWith('\n'));
  assert.match(csvStr, /^id,name,description,status,created_at,updated_at\n/);

  // Formula protection: starts with single quote escape inside quotes
  assert.match(csvStr, /"'=SUM\(1,2\)"/);
});

test('createProjectBackup combines packaging, JSON, and CSV serialization', () => {
  const fixedDate = new Date('2026-03-15T08:00:00.000Z');
  const backup = createProjectBackup(sampleProjects, sampleAccount, { now: fixedDate });

  assert.ok(backup.package);
  assert.equal(backup.package.projects.length, 2);

  // Filename generator
  assert.equal(backup.filename('json'), 'litesaas-export-2026-03-15T080000Z.json');
  assert.equal(backup.filename('csv'), 'litesaas-export-2026-03-15T080000Z.csv');

  // JSON serialization
  const parsed = JSON.parse(backup.json);
  assert.equal(parsed.metadata.activeProjects, 2);

  // CSV serialization
  assert.match(backup.csv, /Active Alpha/);
  assert.match(backup.csv, /Active Beta/);
  assert.doesNotMatch(backup.csv, /Archived Gamma/, 'archived projects must not appear in active-only CSV');
});

test('lib/export.ts root helper exports required functions', async () => {
  const rootExportPath = join(root, 'lib/export.ts');
  assert.ok(existsSync(rootExportPath), 'lib/export.ts must exist at repository root');

  const rootLib = await import('../lib/export.ts');
  assert.equal(typeof rootLib.packageActiveProjects, 'function');
  assert.equal(typeof rootLib.serializeBackupJson, 'function');
  assert.equal(typeof rootLib.serializeBackupCsv, 'function');
  assert.equal(typeof rootLib.createProjectBackup, 'function');
  assert.equal(typeof rootLib.toCsv, 'function');
  assert.equal(typeof rootLib.toJson, 'function');
  assert.equal(typeof rootLib.filename, 'function');
});

test('components/dashboard-export.tsx is a client component with proper accessibility', () => {
  assert.ok(existsSync(componentPath), 'components/dashboard-export.tsx must exist');

  // Client component directive per project standards
  assert.match(componentSrc, /^'use client';/m, 'must start with "use client" directive');

  // Component export
  assert.match(componentSrc, /export default function DashboardExport\b/);
  assert.match(componentSrc, /export \{ DashboardExport \};/);

  // Uses createProjectBackup
  assert.match(componentSrc, /createProjectBackup\(/);

  // ARIA accessibility attributes
  assert.match(componentSrc, /aria-label=["']Project export actions["']/);
  assert.match(componentSrc, /aria-label=["']Export projects as JSON["']/);
  assert.match(componentSrc, /aria-label=["']Export projects as CSV["']/);
  assert.match(componentSrc, /role=["']group["']/);
});

test('src/components/dashboard-export.tsx re-exports clean alias', () => {
  const srcPath = join(root, 'src/components/dashboard-export.tsx');
  assert.ok(existsSync(srcPath), 'src/components/dashboard-export.tsx must exist');

  const reExportSrc = readFileSync(srcPath, 'utf8');
  assert.match(reExportSrc, /export \* from '\.\.\/\.\.\/components\/dashboard-export'/);
  assert.match(reExportSrc, /export \{ default \} from '\.\.\/\.\.\/components\/dashboard-export'/);
});
