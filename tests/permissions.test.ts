import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ROLE_HIERARCHY,
  WORKSPACE_ROLES,
  isValidRole,
  normalizeRole,
  getSafeRole,
  getRoleWeight,
  isAtLeastRole,
  canManageBilling,
  canDeleteProject,
  canInviteMembers,
  canEditProjectSettings,
  canViewProject,
  hasPermission,
  getPermissionsForRole,
  type WorkspaceRole,
} from '../src/lib/permissions.ts';

// Run: npm test
//
// Tests for Workspace Role-Based Access Control (RBAC) matrix and fallback handling.

const root = fileURLToPath(new URL('..', import.meta.url));

test('role hierarchy order strictly enforces Owner > Admin > Member > Viewer', () => {
  assert.ok(ROLE_HIERARCHY.owner > ROLE_HIERARCHY.admin, 'Owner must outrank Admin');
  assert.ok(ROLE_HIERARCHY.admin > ROLE_HIERARCHY.member, 'Admin must outrank Member');
  assert.ok(ROLE_HIERARCHY.member > ROLE_HIERARCHY.viewer, 'Member must outrank Viewer');

  assert.equal(getRoleWeight('owner'), 4);
  assert.equal(getRoleWeight('admin'), 3);
  assert.equal(getRoleWeight('member'), 2);
  assert.equal(getRoleWeight('viewer'), 1);

  // Unknown or degraded roles receive weight 0
  assert.equal(getRoleWeight('degraded'), 0);
  assert.equal(getRoleWeight('guest'), 0);
  assert.equal(getRoleWeight(null), 0);
  assert.equal(getRoleWeight(undefined), 0);
});

test('isAtLeastRole compares hierarchy thresholds accurately', () => {
  // Owner meets all thresholds
  assert.equal(isAtLeastRole('owner', 'owner'), true);
  assert.equal(isAtLeastRole('owner', 'admin'), true);
  assert.equal(isAtLeastRole('owner', 'member'), true);
  assert.equal(isAtLeastRole('owner', 'viewer'), true);

  // Admin meets admin, member, viewer
  assert.equal(isAtLeastRole('admin', 'owner'), false);
  assert.equal(isAtLeastRole('admin', 'admin'), true);
  assert.equal(isAtLeastRole('admin', 'member'), true);
  assert.equal(isAtLeastRole('admin', 'viewer'), true);

  // Member meets member and viewer
  assert.equal(isAtLeastRole('member', 'admin'), false);
  assert.equal(isAtLeastRole('member', 'member'), true);
  assert.equal(isAtLeastRole('member', 'viewer'), true);

  // Viewer meets only viewer
  assert.equal(isAtLeastRole('viewer', 'member'), false);
  assert.equal(isAtLeastRole('viewer', 'viewer'), true);

  // Invalid/degraded roles fail closed
  assert.equal(isAtLeastRole('degraded', 'viewer'), false);
  assert.equal(isAtLeastRole('', 'viewer'), false);
  assert.equal(isAtLeastRole(null, 'viewer'), false);
});

test('canManageBilling is an owner-exclusive privilege', () => {
  assert.equal(canManageBilling('owner'), true);
  assert.equal(canManageBilling('OWNER'), true);

  // Non-owner roles cannot manage billing
  assert.equal(canManageBilling('admin'), false);
  assert.equal(canManageBilling('member'), false);
  assert.equal(canManageBilling('viewer'), false);

  // Degraded / invalid
  assert.equal(canManageBilling('degraded'), false);
  assert.equal(canManageBilling(null), false);
  assert.equal(canManageBilling(undefined), false);
});

test('canDeleteProject requires Admin or Owner authority', () => {
  assert.equal(canDeleteProject('owner'), true);
  assert.equal(canDeleteProject('admin'), true);
  assert.equal(canDeleteProject('ADMIN'), true);

  // Members and viewers cannot delete projects
  assert.equal(canDeleteProject('member'), false);
  assert.equal(canDeleteProject('viewer'), false);

  // Degraded / invalid
  assert.equal(canDeleteProject('degraded'), false);
  assert.equal(canDeleteProject(null), false);
});

test('canInviteMembers requires Admin or Owner authority', () => {
  assert.equal(canInviteMembers('owner'), true);
  assert.equal(canInviteMembers('admin'), true);

  assert.equal(canInviteMembers('member'), false);
  assert.equal(canInviteMembers('viewer'), false);
  assert.equal(canInviteMembers('degraded'), false);
  assert.equal(canInviteMembers(undefined), false);
});

test('canEditProjectSettings allows Member, Admin, and Owner', () => {
  assert.equal(canEditProjectSettings('owner'), true);
  assert.equal(canEditProjectSettings('admin'), true);
  assert.equal(canEditProjectSettings('member'), true);
  assert.equal(canEditProjectSettings('MEMBER'), true);

  // Viewers are read-only
  assert.equal(canEditProjectSettings('viewer'), false);
  assert.equal(canEditProjectSettings('degraded'), false);
  assert.equal(canEditProjectSettings(null), false);
});

test('hasPermission evaluates full action matrix accurately', () => {
  // Owner has all permissions
  assert.equal(hasPermission('owner', 'manageBilling'), true);
  assert.equal(hasPermission('owner', 'manage_billing'), true);
  assert.equal(hasPermission('owner', 'deleteProject'), true);
  assert.equal(hasPermission('owner', 'inviteMembers'), true);
  assert.equal(hasPermission('owner', 'editProjectSettings'), true);
  assert.equal(hasPermission('owner', 'viewProject'), true);

  // Admin has all except billing
  assert.equal(hasPermission('admin', 'manageBilling'), false);
  assert.equal(hasPermission('admin', 'deleteProject'), true);
  assert.equal(hasPermission('admin', 'delete_project'), true);
  assert.equal(hasPermission('admin', 'inviteMembers'), true);
  assert.equal(hasPermission('admin', 'editProjectSettings'), true);
  assert.equal(hasPermission('admin', 'viewProject'), true);

  // Member can edit and view
  assert.equal(hasPermission('member', 'manageBilling'), false);
  assert.equal(hasPermission('member', 'deleteProject'), false);
  assert.equal(hasPermission('member', 'inviteMembers'), false);
  assert.equal(hasPermission('member', 'editProjectSettings'), true);
  assert.equal(hasPermission('member', 'edit_project_settings'), true);
  assert.equal(hasPermission('member', 'viewProject'), true);

  // Viewer can only view
  assert.equal(hasPermission('viewer', 'manageBilling'), false);
  assert.equal(hasPermission('viewer', 'deleteProject'), false);
  assert.equal(hasPermission('viewer', 'inviteMembers'), false);
  assert.equal(hasPermission('viewer', 'editProjectSettings'), false);
  assert.equal(hasPermission('viewer', 'viewProject'), true);
  assert.equal(hasPermission('viewer', 'view'), true);

  // Unknown action returns false
  assert.equal(hasPermission('owner', 'unknown_action_xyz'), false);
  assert.equal(hasPermission('owner', ''), false);

  // Degraded role returns false for all actions
  assert.equal(hasPermission('degraded', 'manageBilling'), false);
  assert.equal(hasPermission('degraded', 'viewProject'), false);
  assert.equal(hasPermission(null, 'viewProject'), false);
  assert.equal(hasPermission(undefined, 'viewProject'), false);
});

test('fallback handling gracefully sanitizes unknown and degraded roles', () => {
  // Case insensitivity & trimming
  assert.equal(normalizeRole('  OWNER  '), 'owner');
  assert.equal(normalizeRole('Admin'), 'admin');
  assert.equal(normalizeRole('MeMbEr'), 'member');
  assert.equal(normalizeRole('VIEWER'), 'viewer');

  // Degraded or arbitrary strings return null
  assert.equal(normalizeRole('degraded'), null);
  assert.equal(normalizeRole('suspended'), null);
  assert.equal(normalizeRole('guest'), null);
  assert.equal(normalizeRole('root'), null);
  assert.equal(normalizeRole(''), null);
  assert.equal(normalizeRole('   '), null);
  assert.equal(normalizeRole(null), null);
  assert.equal(normalizeRole(undefined), null);

  // getSafeRole falls back to default role (viewer)
  assert.equal(getSafeRole('owner'), 'owner');
  assert.equal(getSafeRole('degraded'), 'viewer');
  assert.equal(getSafeRole(null), 'viewer');
  assert.equal(getSafeRole(undefined), 'viewer');
  assert.equal(getSafeRole('unknown', 'member'), 'member');

  // isValidRole predicate
  assert.equal(isValidRole('owner'), true);
  assert.equal(isValidRole('admin'), true);
  assert.equal(isValidRole('member'), true);
  assert.equal(isValidRole('viewer'), true);
  assert.equal(isValidRole('degraded'), false);
  assert.equal(isValidRole(123), false);
  assert.equal(isValidRole(null), false);
});

test('getPermissionsForRole returns comprehensive permissions map', () => {
  const adminPerms = getPermissionsForRole('admin');
  assert.deepEqual(adminPerms, {
    canManageBilling: false,
    canDeleteProject: true,
    canInviteMembers: true,
    canEditProjectSettings: true,
    canViewProject: true,
  });

  const degradedPerms = getPermissionsForRole('degraded');
  assert.deepEqual(degradedPerms, {
    canManageBilling: false,
    canDeleteProject: false,
    canInviteMembers: false,
    canEditProjectSettings: false,
    canViewProject: false,
  });
});

test('lib/permissions.ts root re-export matches src/lib/permissions.ts', async () => {
  const rootPath = join(root, 'lib/permissions.ts');
  assert.ok(existsSync(rootPath), 'lib/permissions.ts must exist at repository root');

  const rootLib = await import('../lib/permissions.ts');
  assert.equal(typeof rootLib.canManageBilling, 'function');
  assert.equal(typeof rootLib.canDeleteProject, 'function');
  assert.equal(typeof rootLib.canInviteMembers, 'function');
  assert.equal(typeof rootLib.canEditProjectSettings, 'function');
  assert.equal(typeof rootLib.hasPermission, 'function');
  assert.equal(typeof rootLib.normalizeRole, 'function');
});
