import { RolesMatrix } from '@/components/settings/roles-matrix'
import { PageTitle } from '@/components/ui-bits'
import { PERMISSION_LABELS } from '@/lib/permissions'
import { requirePermission } from '@/lib/rbac'
import { getCtxOrNull } from '@/lib/session'
import { listRolesWithPermissions } from '@/services/admin'

export default async function RolesPage() {
  const ctx = (await getCtxOrNull())!
  requirePermission(ctx, 'users.manage')
  const { roles, keys } = await listRolesWithPermissions(ctx)
  return (
    <>
      <PageTitle title="Roles and permissions" />
      <p className="text-sm text-muted-foreground">Owner and Admin always have every permission. A User gets the permissions of their roles. Changes apply on the member&apos;s next click, no re-login needed.</p>
      <RolesMatrix roles={roles} keys={keys.map(k => ({ key: k, label: PERMISSION_LABELS[k] }))} />
    </>
  )
}
