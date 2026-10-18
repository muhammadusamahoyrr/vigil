import 'server-only'
import { scoped } from '@/db/scoped'
import type { Ctx } from '@/lib/ctx'
import { requirePermission } from '@/lib/rbac'

export async function publicFormUrl(ctx: Ctx) {
  requirePermission(ctx, 'integrations.manage')
  // workspaces has no workspace_id column; join its 1:1 assignment_rules row to stay scoped
  const w = await scoped(ctx).one<{ public_form_token: string }>(
    `SELECT w.public_form_token FROM workspaces w
       JOIN assignment_rules r ON r.workspace_id = w.id
      WHERE r.workspace_id = $1`, [])
  return `${process.env.APP_URL ?? ''}/f/${w.public_form_token}`
}
