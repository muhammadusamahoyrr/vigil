// The fixed permission keys (CLAUDE.md, Permissions). Same list as the permissions table.
export const PERMISSION_KEYS = [
  'crm.view', 'crm.create', 'crm.edit', 'crm.delete', 'crm.export',
  'opportunity_value.view', 'conversations.view', 'conversations.send',
  'leads.reassign', 'payments.create', 'appointments.manage',
  'assignment_rules.manage', 'config.manage', 'integrations.manage',
  'audit.view', 'users.manage',
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  'crm.view': 'View CRM records', 'crm.create': 'Create CRM records', 'crm.edit': 'Edit CRM records',
  'crm.delete': 'Delete CRM records', 'crm.export': 'Export CSV', 'opportunity_value.view': 'See opportunity value',
  'conversations.view': 'View conversations', 'conversations.send': 'Send messages', 'leads.reassign': 'Reassign leads',
  'payments.create': 'Request payments', 'appointments.manage': 'Manage appointments',
  'assignment_rules.manage': 'Manage assignment rules', 'config.manage': 'Manage pipelines and fields',
  'integrations.manage': 'Manage integrations', 'audit.view': 'View audit log', 'users.manage': 'Manage users and roles',
}
