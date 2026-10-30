'use client';

import React, { useState, useMemo } from 'react';
import {
  Users,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Mail,
  Key,
  Database,
  Trash2,
  Check,
  X,
  Search,
  Filter,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  Lock,
  Layers,
  Sparkles,
} from 'lucide-react';

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export type PermissionScope =
  | 'projects:read'
  | 'projects:create'
  | 'projects:update'
  | 'projects:archive'
  | 'projects:delete'
  | 'api_keys:read'
  | 'api_keys:create'
  | 'api_keys:revoke'
  | 'billing:view'
  | 'billing:manage'
  | 'team:view'
  | 'team:invite'
  | 'team:change_role'
  | 'team:remove'
  | 'database:export'
  | 'database:manage';

export interface PermissionDefinition {
  id: PermissionScope;
  name: string;
  description: string;
  category: 'Projects' | 'API Keys' | 'Billing & Subscription' | 'Team Management' | 'Database Operations';
}

export interface RoleDefinition {
  role: Role;
  name: string;
  badgeClass: string;
  description: string;
  hierarchyLevel: number; // 4 = owner, 3 = admin, 2 = member, 1 = viewer
  permissions: PermissionScope[];
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'invited' | 'suspended';
  joinedAt: string;
  lastActiveAt?: string;
  isCurrentUser?: boolean;
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  // Projects
  {
    id: 'projects:read',
    name: 'View Projects',
    description: 'Read and inspect projects, metrics, and details.',
    category: 'Projects',
  },
  {
    id: 'projects:create',
    name: 'Create Projects',
    description: 'Create new active projects within the quota limit.',
    category: 'Projects',
  },
  {
    id: 'projects:update',
    name: 'Update Projects',
    description: 'Edit project name, description, and metadata.',
    category: 'Projects',
  },
  {
    id: 'projects:archive',
    name: 'Archive & Restore',
    description: 'Toggle projects between active and archived states.',
    category: 'Projects',
  },
  {
    id: 'projects:delete',
    name: 'Delete Projects',
    description: 'Permanently remove projects and purge SQLite records.',
    category: 'Projects',
  },

  // API Keys
  {
    id: 'api_keys:read',
    name: 'View API Keys',
    description: 'Inspect active key prefixes, scopes, and last used times.',
    category: 'API Keys',
  },
  {
    id: 'api_keys:create',
    name: 'Generate API Keys',
    description: 'Create new scoped API tokens for machine access.',
    category: 'API Keys',
  },
  {
    id: 'api_keys:revoke',
    name: 'Revoke API Keys',
    description: 'Immediately revoke and delete API credentials.',
    category: 'API Keys',
  },

  // Billing
  {
    id: 'billing:view',
    name: 'View Invoices & Plan',
    description: 'Inspect subscription tier, receipts, and plan limits.',
    category: 'Billing & Subscription',
  },
  {
    id: 'billing:manage',
    name: 'Manage Subscription',
    description: 'Upgrade to Pro, manage Stripe payments, or cancel tier.',
    category: 'Billing & Subscription',
  },

  // Team Management
  {
    id: 'team:view',
    name: 'View Team Members',
    description: 'See team roster, role assignments, and member statuses.',
    category: 'Team Management',
  },
  {
    id: 'team:invite',
    name: 'Invite Members',
    description: 'Send invitation emails to new collaborators.',
    category: 'Team Management',
  },
  {
    id: 'team:change_role',
    name: 'Change Member Roles',
    description: 'Promote or demote members up to caller privilege level.',
    category: 'Team Management',
  },
  {
    id: 'team:remove',
    name: 'Remove Members',
    description: 'Revoke access and remove members from the workspace.',
    category: 'Team Management',
  },

  // Database
  {
    id: 'database:export',
    name: 'Export Data (CSV/JSON)',
    description: 'Download workspace projects and audit telemetry.',
    category: 'Database Operations',
  },
  {
    id: 'database:manage',
    name: 'Database Maintenance',
    description: 'Trigger SQLite VACUUM, run PRAGMA diagnostics, or purge account.',
    category: 'Database Operations',
  },
];

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  owner: {
    role: 'owner',
    name: 'Owner',
    badgeClass: 'bg-purple-500/10 text-purple-300 border-purple-500/30 shadow-sm shadow-purple-500/10',
    description: 'Full workspace authority including billing, workspace deletion, and team governance.',
    hierarchyLevel: 4,
    permissions: PERMISSION_DEFINITIONS.map((p) => p.id),
  },
  admin: {
    role: 'admin',
    name: 'Admin',
    badgeClass: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 shadow-sm shadow-emerald-500/10',
    description: 'Manage projects, API keys, and team invitations. Cannot manage billing or delete workspace.',
    hierarchyLevel: 3,
    permissions: [
      'projects:read',
      'projects:create',
      'projects:update',
      'projects:archive',
      'projects:delete',
      'api_keys:read',
      'api_keys:create',
      'api_keys:revoke',
      'billing:view',
      'team:view',
      'team:invite',
      'team:change_role',
      'team:remove',
      'database:export',
    ],
  },
  member: {
    role: 'member',
    name: 'Member',
    badgeClass: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    description: 'Collaborate on projects, create API keys for personal workflows, and view telemetry.',
    hierarchyLevel: 2,
    permissions: [
      'projects:read',
      'projects:create',
      'projects:update',
      'projects:archive',
      'api_keys:read',
      'api_keys:create',
      'billing:view',
      'team:view',
      'database:export',
    ],
  },
  viewer: {
    role: 'viewer',
    name: 'Viewer',
    badgeClass: 'bg-zinc-800 text-zinc-300 border-white/10',
    description: 'Read-only access to projects, metrics, and team directory. Cannot modify resources.',
    hierarchyLevel: 1,
    permissions: ['projects:read', 'api_keys:read', 'billing:view', 'team:view'],
  },
};

/**
 * Checks whether a role has a given permission.
 */
export function hasPermission(role: Role, permission: PermissionScope): boolean {
  const roleDef = ROLE_DEFINITIONS[role];
  if (!roleDef) return false;
  return roleDef.permissions.includes(permission);
}

/**
 * Returns all permissions granted to a given role.
 */
export function getRolePermissions(role: Role): PermissionScope[] {
  return ROLE_DEFINITIONS[role]?.permissions ?? [];
}

/**
 * Determines if an actor role is allowed to change or remove a target role.
 * An actor can only manage members whose hierarchy level is strictly lower than their own.
 */
export function canManageRole(actorRole: Role, targetRole: Role): boolean {
  const actorLevel = ROLE_DEFINITIONS[actorRole]?.hierarchyLevel ?? 0;
  const targetLevel = ROLE_DEFINITIONS[targetRole]?.hierarchyLevel ?? 0;
  return actorLevel > targetLevel;
}

/**
 * Determines if an actor can assign a particular role to someone else.
 * Cannot assign a role equal to or higher than one's own role (except owner).
 */
export function isRoleAssignable(actorRole: Role, roleToAssign: Role): boolean {
  const actorLevel = ROLE_DEFINITIONS[actorRole]?.hierarchyLevel ?? 0;
  const assignLevel = ROLE_DEFINITIONS[roleToAssign]?.hierarchyLevel ?? 0;
  if (actorRole === 'owner') return true;
  return actorLevel > assignLevel;
}

export const DEFAULT_TEAM_MEMBERS: TeamMember[] = [
  {
    id: 'user_owner_1',
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    role: 'owner',
    status: 'active',
    joinedAt: '2026-01-15',
    lastActiveAt: 'Just now',
    isCurrentUser: true,
  },
  {
    id: 'user_admin_2',
    name: 'Sarah Chen',
    email: 'sarah.chen@example.com',
    role: 'admin',
    status: 'active',
    joinedAt: '2026-03-20',
    lastActiveAt: '2 hours ago',
  },
  {
    id: 'user_member_3',
    name: 'Marcus Brody',
    email: 'marcus.brody@example.com',
    role: 'member',
    status: 'active',
    joinedAt: '2026-06-11',
    lastActiveAt: 'Yesterday',
  },
  {
    id: 'user_invited_4',
    name: 'Elena Rostova',
    email: 'elena.rostova@example.com',
    role: 'viewer',
    status: 'invited',
    joinedAt: '2026-10-28',
  },
];

export interface TeamRolePermissionsProps {
  currentUserRole?: Role;
  currentUserId?: string;
  teamMembers?: TeamMember[];
  onInviteMember?: (email: string, role: Role) => Promise<void> | void;
  onUpdateRole?: (memberId: string, newRole: Role) => Promise<void> | void;
  onRemoveMember?: (memberId: string) => Promise<void> | void;
  className?: string;
}

export default function TeamRolePermissions({
  currentUserRole = 'owner',
  currentUserId = 'user_owner_1',
  teamMembers: initialMembers = DEFAULT_TEAM_MEMBERS,
  onInviteMember,
  onUpdateRole,
  onRemoveMember,
  className = '',
}: TeamRolePermissionsProps) {
  const [activeTab, setActiveTab] = useState<'roster' | 'matrix' | 'policies'>('roster');
  const [members, setMembers] = useState<TeamMember[]>(initialMembers);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('member');
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [matrixCategory, setMatrixCategory] = useState<string>('All');

  // Filter members
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      const matchesSearch =
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = roleFilter === 'all' || m.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [members, searchQuery, roleFilter]);

  // Handle Invite Form Submission
  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteEmail.includes('@')) {
      setActionNotice('Please enter a valid email address.');
      return;
    }

    const newMember: TeamMember = {
      id: `user_${Date.now()}`,
      name: inviteEmail.split('@')[0],
      email: inviteEmail,
      role: inviteRole,
      status: 'invited',
      joinedAt: '2026-10-30',
    };

    setMembers((prev) => [...prev, newMember]);
    if (onInviteMember) {
      onInviteMember(inviteEmail, inviteRole);
    }

    setActionNotice(`Invitation sent to ${inviteEmail} with role ${ROLE_DEFINITIONS[inviteRole].name}.`);
    setInviteEmail('');
    setShowInviteModal(false);
  };

  // Handle Role Change
  const handleRoleChange = (memberId: string, newRole: Role) => {
    const member = members.find((m) => m.id === memberId);
    if (!member) return;

    if (!canManageRole(currentUserRole, member.role)) {
      setActionNotice(`You do not have permission to modify ${member.name}'s role.`);
      return;
    }

    if (!isRoleAssignable(currentUserRole, newRole)) {
      setActionNotice(`You cannot assign a role of level ${newRole}.`);
      return;
    }

    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
    );

    if (onUpdateRole) {
      onUpdateRole(memberId, newRole);
    }

    setActionNotice(`Updated ${member.name}'s role to ${ROLE_DEFINITIONS[newRole].name}.`);
  };

  // Handle Member Removal
  const handleRemoveMember = (memberId: string) => {
    const member = members.find((m) => m.id === memberId);
    if (!member) return;

    if (member.role === 'owner') {
      setActionNotice('The workspace Owner cannot be removed.');
      return;
    }

    if (!canManageRole(currentUserRole, member.role)) {
      setActionNotice(`You do not have permission to remove ${member.name}.`);
      return;
    }

    setMembers((prev) => prev.filter((m) => m.id !== memberId));

    if (onRemoveMember) {
      onRemoveMember(memberId);
    }

    setActionNotice(`Removed ${member.name} from the workspace.`);
  };

  // Resend Invite
  const handleResendInvite = (member: TeamMember) => {
    setActionNotice(`Invitation resent to ${member.email}.`);
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    PERMISSION_DEFINITIONS.forEach((p) => set.add(p.category));
    return ['All', ...Array.from(set)];
  }, []);

  const filteredPermissions = useMemo(() => {
    if (matrixCategory === 'All') return PERMISSION_DEFINITIONS;
    return PERMISSION_DEFINITIONS.filter((p) => p.category === matrixCategory);
  }, [matrixCategory]);

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-[#121217] p-5 space-y-6 shadow-xl shadow-black/20 ${className}`}
      data-testid="team-role-permissions"
    >
      {/* Header with Title and Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Team &amp; Role Permissions</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Manage team members, assign granular security roles, and enforce least-privilege policies.
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1.5 bg-zinc-900/80 p-1 rounded-xl border border-white/5 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab('roster')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:outline-2 focus:outline-emerald-500 ${
              activeTab === 'roster'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Team Members ({members.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('matrix')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:outline-2 focus:outline-emerald-500 ${
              activeTab === 'matrix'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Permissions Matrix
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('policies')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:outline-2 focus:outline-emerald-500 ${
              activeTab === 'policies'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Security Policies
          </button>
        </div>
      </div>

      {/* Notice Banner if an action happened */}
      {actionNotice && (
        <div
          role="alert"
          className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-300 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{actionNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            className="text-zinc-400 hover:text-white p-1 rounded focus:outline-none focus:outline-2 focus:outline-emerald-500"
            aria-label="Dismiss notification"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* TAB 1: TEAM MEMBERS ROSTER */}
      {activeTab === 'roster' && (
        <div className="space-y-4">
          {/* Controls: Search, Role Filter, and Invite Button */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-1 items-center gap-2 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search team members..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl bg-zinc-900/60 border border-white/10 pl-9 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:outline-2 focus:outline-emerald-500 focus:border-emerald-500"
                  aria-label="Search team members by name or email"
                />
              </div>

              {/* Role Filter Dropdown */}
              <div className="relative">
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as 'all' | Role)}
                  className="rounded-xl bg-zinc-900/60 border border-white/10 px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:outline-2 focus:outline-emerald-500"
                  aria-label="Filter by role"
                >
                  <option value="all">All Roles</option>
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
            </div>

            {/* Invite Button */}
            {hasPermission(currentUserRole, 'team:invite') && (
              <button
                type="button"
                onClick={() => setShowInviteModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md shadow-purple-600/20 transition-all focus:outline-none focus:outline-2 focus:outline-purple-400 self-start sm:self-auto"
                aria-label="Invite new team member"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Invite Member</span>
              </button>
            )}
          </div>

          {/* Members Table */}
          <div className="overflow-x-auto rounded-xl border border-white/5 bg-zinc-950/40">
            <table className="w-full text-left text-xs" aria-label="Team Members Roster">
              <thead>
                <tr className="border-b border-white/5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                  <th scope="col" className="px-4 py-3">Member</th>
                  <th scope="col" className="px-4 py-3">Role</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Joined</th>
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                      No team members found matching your search.
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map((member) => {
                    const roleDef = ROLE_DEFINITIONS[member.role];
                    const canEdit = canManageRole(currentUserRole, member.role);
                    const isSelf = member.isCurrentUser || member.id === currentUserId;

                    return (
                      <tr key={member.id} className="hover:bg-white/[0.02] transition-colors">
                        {/* Member Identity */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center font-bold text-xs text-zinc-300">
                              {member.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-medium text-white flex items-center gap-1.5">
                                <span>{member.name}</span>
                                {isSelf && (
                                  <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20 font-normal">
                                    You
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                <span>{member.email}</span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Role Selector or Badge */}
                        <td className="px-4 py-3">
                          {canEdit ? (
                            <select
                              value={member.role}
                              onChange={(e) => handleRoleChange(member.id, e.target.value as Role)}
                              className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border ${roleDef.badgeClass} bg-transparent cursor-pointer focus:outline-none focus:outline-2 focus:outline-emerald-500`}
                              aria-label={`Change role for ${member.name}`}
                            >
                              <option value="owner" disabled={!isRoleAssignable(currentUserRole, 'owner')} className="bg-zinc-900 text-white">
                                Owner
                              </option>
                              <option value="admin" disabled={!isRoleAssignable(currentUserRole, 'admin')} className="bg-zinc-900 text-white">
                                Admin
                              </option>
                              <option value="member" disabled={!isRoleAssignable(currentUserRole, 'member')} className="bg-zinc-900 text-white">
                                Member
                              </option>
                              <option value="viewer" disabled={!isRoleAssignable(currentUserRole, 'viewer')} className="bg-zinc-900 text-white">
                                Viewer
                              </option>
                            </select>
                          ) : (
                            <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full border ${roleDef.badgeClass}`}>
                              {roleDef.name}
                            </span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          {member.status === 'active' ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                              Pending Invite
                            </span>
                          )}
                        </td>

                        {/* Joined Date */}
                        <td className="px-4 py-3 font-mono text-[11px] text-zinc-400">
                          {member.joinedAt}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {member.status === 'invited' && (
                              <button
                                type="button"
                                onClick={() => handleResendInvite(member)}
                                className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-300 transition-colors focus:outline-none focus:outline-2 focus:outline-emerald-500"
                                aria-label={`Resend invitation to ${member.email}`}
                              >
                                Resend
                              </button>
                            )}

                            {canEdit && !isSelf && (
                              <button
                                type="button"
                                onClick={() => handleRemoveMember(member.id)}
                                className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors focus:outline-none focus:outline-2 focus:outline-red-500"
                                aria-label={`Remove ${member.name} from workspace`}
                                title={`Remove ${member.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: PERMISSIONS MATRIX */}
      {activeTab === 'matrix' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Granular Access Control Matrix</h3>
              <p className="text-xs text-zinc-400">
                Audited list of operational capabilities enforced per role tier.
              </p>
            </div>

            {/* Category filter pills */}
            <div className="flex flex-wrap items-center gap-1 bg-zinc-900/80 p-1 rounded-xl border border-white/5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setMatrixCategory(cat)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:outline-2 focus:outline-emerald-500 ${
                    matrixCategory === cat
                      ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Matrix Table */}
          <div className="overflow-x-auto rounded-xl border border-white/5 bg-zinc-950/40">
            <table className="w-full text-left text-xs" aria-label="Role Permissions Matrix">
              <thead>
                <tr className="border-b border-white/5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                  <th scope="col" className="px-4 py-3">Permission Scope</th>
                  <th scope="col" className="px-4 py-3 text-center w-24">Owner</th>
                  <th scope="col" className="px-4 py-3 text-center w-24">Admin</th>
                  <th scope="col" className="px-4 py-3 text-center w-24">Member</th>
                  <th scope="col" className="px-4 py-3 text-center w-24">Viewer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredPermissions.map((perm) => (
                  <tr key={perm.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-white">{perm.name}</div>
                      <div className="text-[11px] text-zinc-500">{perm.description}</div>
                      <span className="inline-block mt-0.5 text-[9px] uppercase tracking-wider font-mono text-zinc-400">
                        {perm.id}
                      </span>
                    </td>
                    {(['owner', 'admin', 'member', 'viewer'] as Role[]).map((r) => {
                      const granted = hasPermission(r, perm.id);
                      return (
                        <td key={r} className="px-4 py-2.5 text-center">
                          {granted ? (
                            <div className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                              <Check className="h-3.5 w-3.5" />
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-zinc-900 border border-white/5 text-zinc-600">
                              <X className="h-3 w-3" />
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: SECURITY POLICIES */}
      {activeTab === 'policies' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-white/5 bg-zinc-900/30 p-4 space-y-2">
            <div className="flex items-center gap-2 text-purple-400">
              <ShieldCheck className="h-4 w-4" />
              <h4 className="text-xs font-semibold text-white">Least Privilege Access</h4>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Every role is bounded by explicit capability checks. Viewers cannot mutate SQLite records;
              Members cannot revoke workspace-level credentials; and only the verified Owner can invoke
              account deletion or Stripe plan migrations.
            </p>
          </div>

          <div className="rounded-xl border border-white/5 bg-zinc-900/30 p-4 space-y-2">
            <div className="flex items-center gap-2 text-emerald-400">
              <Database className="h-4 w-4" />
              <h4 className="text-xs font-semibold text-white">SQLite Concurrency &amp; WAL Safety</h4>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              LiteSaaS runs on WAL (Write-Ahead Logging) mode. Multiple team members can read concurrent queries
              without locking the engine. Single write transactions run through busy_timeout lock retry windows.
            </p>
          </div>

          <div className="rounded-xl border border-white/5 bg-zinc-900/30 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sky-400">
              <Key className="h-4 w-4" />
              <h4 className="text-xs font-semibold text-white">Scoped API Credentials</h4>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              API keys carry explicit scope strings (`projects:read,projects:write`). Machine callers authenticate
              statelessly via Bearer or x-api-key headers without consuming user session slots.
            </p>
          </div>

          <div className="rounded-xl border border-white/5 bg-zinc-900/30 p-4 space-y-2">
            <div className="flex items-center gap-2 text-amber-400">
              <ShieldAlert className="h-4 w-4" />
              <h4 className="text-xs font-semibold text-white">Owner Safeguards</h4>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              The Owner role cannot be demoted or removed by other team members. Workspace ownership transfers
              require explicit multi-factor password verification to prevent accidental lockouts.
            </p>
          </div>
        </div>
      )}

      {/* INVITE MODAL DIALOG */}
      {showInviteModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#121217] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-purple-400" />
                <h3 id="invite-modal-title" className="text-sm font-semibold text-white">
                  Invite Team Member
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded focus:outline-none focus:outline-2 focus:outline-emerald-500"
                aria-label="Close invite modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleInviteSubmit} className="space-y-4">
              <div>
                <label htmlFor="invite-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Email Address
                </label>
                <input
                  id="invite-email"
                  type="email"
                  required
                  placeholder="collaborator@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:outline-2 focus:outline-purple-500"
                />
              </div>

              <div>
                <label htmlFor="invite-role" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Role &amp; Permissions Tier
                </label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Role)}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3 py-2 text-xs text-white focus:outline-none focus:outline-2 focus:outline-purple-500"
                >
                  <option value="member">Member — Create and edit projects, create personal API keys</option>
                  <option value="admin">Admin — Manage team invites and system API keys</option>
                  <option value="viewer">Viewer — Read-only access to projects and dashboard</option>
                </select>
                <p className="text-[11px] text-zinc-400 mt-1">
                  {ROLE_DEFINITIONS[inviteRole].description}
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-3.5 py-1.5 rounded-xl border border-white/10 text-xs font-medium text-zinc-300 hover:bg-white/5 transition-colors focus:outline-none focus:outline-2 focus:outline-zinc-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white shadow-md shadow-purple-600/20 transition-all focus:outline-none focus:outline-2 focus:outline-purple-400"
                >
                  Send Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Aliases for developer convenience
export {
  TeamRolePermissions,
  TeamRolePermissions as TeamMemberRolePermissions,
  TeamRolePermissions as RolePermissionsMatrix,
};
