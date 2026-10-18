// Server-side permission checks. Hiding a button is not security.
import type { Ctx } from './ctx'
import { forbidden } from './errors'

export function hasPermission(ctx: Ctx, key: string): boolean {
  return ctx.isSystem || ctx.permissions.includes('*') || ctx.permissions.includes(key)
}

export function requirePermission(ctx: Ctx, key: string) {
  if (!hasPermission(ctx, key)) throw forbidden()
}

/**
 * Field-level protection (F1.4). Every list, detail and CSV export of
 * opportunities goes through this: without opportunity_value.view the value is
 * removed (null) and value_masked is set so the UI can say why.
 */
export function serializeOpportunities<T extends Record<string, unknown>>(ctx: Ctx, rows: T[]): (T & { value_masked: boolean })[] {
  const canSee = hasPermission(ctx, 'opportunity_value.view')
  return rows.map(r => (canSee ? { ...r, value_masked: false } : { ...r, value: null, value_masked: true }))
}

/** Owner, Admin, or anyone allowed to reassign sees every lead; others see only their own. */
export function seesAllLeads(ctx: Ctx): boolean {
  return ctx.isSystem || ctx.level === 'owner' || ctx.level === 'admin' || hasPermission(ctx, 'leads.reassign')
}
