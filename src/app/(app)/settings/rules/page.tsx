import { RulesForm } from '@/components/settings/rules-form'
import { PageTitle } from '@/components/ui-bits'
import { requirePermission } from '@/lib/rbac'
import { getCtxOrNull } from '@/lib/session'
import { getRules, listRoles, listTeam } from '@/services/team'

export default async function RulesPage() {
  const ctx = (await getCtxOrNull())!
  requirePermission(ctx, 'assignment_rules.manage')
  const [rules, team, roles] = await Promise.all([getRules(ctx), listTeam(ctx), listRoles(ctx)])
  return (
    <>
      <PageTitle title="Assignment rules" />
      <p className="text-sm text-muted-foreground">
        New leads go round robin to Available people under their open-lead limit. If the owner does not acknowledge
        within the window, the lead escalates level by level. Use short windows (e.g. 20s) for a live demo.
      </p>
      <RulesForm
        initial={{
          ackWindowSeconds: rules.ack_window_seconds, maxOpenLeads: rules.max_open_leads, idleSeconds: rules.idle_seconds,
          escalationLevels: rules.escalation_levels, backupUserId: rules.backup_user_id, managerRoleId: rules.manager_role_id,
        }}
        users={team.filter(u => !u.deactivated_at).map(u => ({ id: u.id, name: u.name }))}
        roles={roles}
      />
    </>
  )
}
