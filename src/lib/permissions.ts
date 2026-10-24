/**
 * Role-Based Access Control (RBAC) for Workspaces.
 *
 * Defines workspace role hierarchy (Owner > Admin > Member > Viewer),
 * permission matrix evaluation, and defensive fallback handling for
 * degraded or unrecognized role strings.
 */

export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export type PermissionAction =
  | 'manageBilling'
  | 'manage_billing'
  | 'billing:manage'
  | 'deleteProject'
  | 'delete_project'
  | 'projects:delete'
  | 'inviteMembers'
  | 'invite_members'
  | 'members:invite'
  | 'editProjectSettings'
  | 'edit_project_settings'
  | 'projects:edit'
  | 'viewProject'
  | 'view_project'
  | 'projects:view'
  | 'view'
  | string;

/**
 * Validates whether a given string is a recognized WorkspaceRole.
 */
export function isValidRole(role: unknown): role is WorkspaceRole {
  if (typeof role !== 'string') return false;
  const normalized = role.trim().toLowerCase();
  return (WORKSPACE_ROLES as readonly string[]).includes(normalized);
}

/**
 * Normalizes an arbitrary role string to a valid WorkspaceRole or null.
 * Handles casing, whitespace, and strips invalid/degraded inputs.
 */
export function normalizeRole(role?: string | null): WorkspaceRole | null {
  if (!role || typeof role !== 'string') return null;
  const normalized = role.trim().toLowerCase();
  return isValidRole(normalized) ? (normalized as WorkspaceRole) : null;
}

/**
 * Returns the role if valid, or falls back to a safe default role (Viewer).
 */
export function getSafeRole(
  role?: string | null,
  fallback: WorkspaceRole = 'viewer'
): WorkspaceRole {
  return normalizeRole(role) ?? fallback;
}

/**
 * Returns the numeric weight of a role in the hierarchy.
 * Unknown or degraded roles return 0.
 */
export function getRoleWeight(role?: string | null): number {
  const normalized = normalizeRole(role);
  return normalized ? ROLE_HIERARCHY[normalized] : 0;
}

/**
 * Compares two roles according to the hierarchy.
 * Returns true if candidate role has at least the privilege level of target role.
 * Fails closed (returns false) if either role is invalid or unknown.
 */
export function isAtLeastRole(
  candidateRole: string | null | undefined,
  requiredRole: WorkspaceRole
): boolean {
  const candidateWeight = getRoleWeight(candidateRole);
  const requiredWeight = ROLE_HIERARCHY[requiredRole] ?? Infinity;
  return candidateWeight >= requiredWeight;
}

/**
 * Billing management: Owner exclusive.
 * Only workspace owners can view, change, or cancel subscriptions.
 */
export function canManageBilling(role?: string | null): boolean {
  return isAtLeastRole(role, 'owner');
}

/**
 * Project deletion: Admin and above (Owner, Admin).
 * Destructive resource removals require administrative authority.
 */
export function canDeleteProject(role?: string | null): boolean {
  return isAtLeastRole(role, 'admin');
}

/**
 * Member invitation: Admin and above (Owner, Admin).
 * Adding users to workspace roster requires administrative role.
 */
export function canInviteMembers(role?: string | null): boolean {
  return isAtLeastRole(role, 'admin');
}

/**
 * Project settings editing: Member and above (Owner, Admin, Member).
 * Allows active contributors to update project name, metadata, and configuration.
 * Viewers are read-only and denied.
 */
export function canEditProjectSettings(role?: string | null): boolean {
  return isAtLeastRole(role, 'member');
}

/**
 * Viewing project and workspace resources: Viewer and above.
 * All recognized roles have read access.
 */
export function canViewProject(role?: string | null): boolean {
  return isAtLeastRole(role, 'viewer');
}

/**
 * Unified permission matrix evaluator.
 * Evaluates whether a role is authorized for a specified action.
 * Unknown actions or degraded roles safely fail closed (return false).
 */
export function hasPermission(
  role: string | null | undefined,
  action: PermissionAction
): boolean {
  if (!action || typeof action !== 'string') return false;

  const normalizedAction = action.trim().toLowerCase();

  switch (normalizedAction) {
    case 'managebilling':
    case 'manage_billing':
    case 'billing:manage':
    case 'billing':
      return canManageBilling(role);

    case 'deleteproject':
    case 'delete_project':
    case 'projects:delete':
    case 'delete':
      return canDeleteProject(role);

    case 'invitemembers':
    case 'invite_members':
    case 'members:invite':
    case 'invite':
      return canInviteMembers(role);

    case 'editprojectsettings':
    case 'edit_project_settings':
    case 'projects:edit':
    case 'edit':
      return canEditProjectSettings(role);

    case 'viewproject':
    case 'view_project':
    case 'projects:view':
    case 'view':
    case 'read':
      return canViewProject(role);

    default:
      return false;
  }
}

/**
 * Returns a full permission dictionary for the specified role.
 */
export function getPermissionsForRole(role?: string | null) {
  return {
    canManageBilling: canManageBilling(role),
    canDeleteProject: canDeleteProject(role),
    canInviteMembers: canInviteMembers(role),
    canEditProjectSettings: canEditProjectSettings(role),
    canViewProject: canViewProject(role),
  };
}
