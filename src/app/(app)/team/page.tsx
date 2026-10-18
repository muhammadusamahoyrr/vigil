import { AvailabilityControl } from '@/components/availability-control'
import { AddMemberForm } from '@/components/team/add-member-form'
import { ManageMember } from '@/components/team/manage-member'
import { Badge, Card, PageTitle } from '@/components/ui-bits'
import { hasPermission } from '@/lib/rbac'
import { getCtxOrNull } from '@/lib/session'
import { listRoles, listTeam } from '@/services/team'

const TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = { available: 'good', busy: 'warn', on_leave: 'bad', offline: 'neutral' }

export default async function TeamPage() {
  const ctx = (await getCtxOrNull())!
  const [team, roles] = await Promise.all([listTeam(ctx), listRoles(ctx)])
  const canManage = hasPermission(ctx, 'users.manage')
  return (
    <>
      <PageTitle title="Team" />
      {canManage && <AddMemberForm roles={roles} />}
      <Card>
        <ul className="divide-y divide-border">
          {team.map(u => (
            <li key={u.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col">
                <span className="font-medium text-foreground">{u.name} {u.deactivated_at && <Badge>Deactivated</Badge>}</span>
                <span className="text-xs text-muted-foreground break-all">{u.email} · <span className="capitalize">{u.level}</span>{u.roles.length ? ` · ${u.roles.join(', ')}` : ''}</span>
                <span className="mt-1 flex flex-wrap gap-2">
                  <Badge tone={TONE[u.availability]}>{u.availability.replace('_', ' ')}</Badge>
                  <Badge>{u.open_leads} open lead(s)</Badge>
                  <Badge tone={u.slack_linked ? 'good' : 'warn'}>{u.slack_linked ? 'Slack linked' : 'Slack not linked'}</Badge>
                </span>
              </div>
              {canManage && u.id !== ctx.userId && !u.deactivated_at && !(u.level === 'owner' && ctx.level !== 'owner') && (
                <div className="flex flex-col gap-2">
                  <AvailabilityControl userId={u.id} current={u.availability} label={`Set ${u.name}'s availability`} showPolicy={false} />
                  {u.level !== 'owner' && <ManageMember user={{ id: u.id, name: u.name, level: u.level, roleIds: u.role_ids }} roles={roles} />}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
