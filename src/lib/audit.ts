// Writes one audit_logs row using the CALLER's transaction client, so the audit
// row commits or rolls back together with the change it describes.
// audit_logs is immutable in the database (insert only).
import type { PoolClient } from 'pg'
import type { Ctx } from './ctx'

type AuditInput = {
  ctx: Ctx
  action: string // e.g. 'role.updated', 'contact.deleted'
  targetType: string
  targetId?: string | null
  before?: unknown
  after?: unknown
}

export async function audit(client: Pick<PoolClient, 'query'>, a: AuditInput) {
  await client.query(
    `INSERT INTO audit_logs (workspace_id, actor_id, action, target_type, target_id, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      a.ctx.workspaceId,
      a.ctx.isSystem ? null : a.ctx.userId, // system actions: actor_id = NULL, no fake user row
      a.action,
      a.targetType,
      a.targetId ?? null,
      a.before === undefined ? null : JSON.stringify(a.before),
      a.after === undefined ? null : JSON.stringify(a.after),
    ],
  )
}
