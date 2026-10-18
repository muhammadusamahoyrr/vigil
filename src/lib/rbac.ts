// Server-side permission checks. Hiding a button is not security.
import type { Ctx } from './ctx'
import { forbidden } from './errors'

export function hasPermission(ctx: Ctx, key: string): boolean {
  return ctx.isSystem || ctx.permissions.includes('*') || ctx.permissions.includes(key)
}

export function requirePermission(ctx: Ctx, key: string) {
  if (!hasPermission(ctx, key)) throw forbidden()
}

/** Owner, Admin, or anyone allowed to reassign sees every lead; others see only their own. */
export function seesAllLeads(ctx: Ctx): boolean {
  return ctx.isSystem || ctx.level === 'owner' || ctx.level === 'admin' || hasPermission(ctx, 'leads.reassign')
}
