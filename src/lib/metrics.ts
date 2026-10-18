// Every dashboard number comes from here (CLAUDE.md, Dashboard definitions).
// personal = a User's own figures; Owner/Admin see company-wide.
import 'server-only'
import { scoped } from '@/db/scoped'
import type { Ctx } from './ctx'
import { hasPermission } from './rbac'

export const isCompanyWide = (ctx: Ctx) => ctx.level === 'owner' || ctx.level === 'admin'

// "today" and "this month" start at local midnight in the workspace timezone
const TODAY = `(date_trunc('day', now() AT TIME ZONE w.timezone) AT TIME ZONE w.timezone)`
const MONTH = `(date_trunc('month', now() AT TIME ZONE w.timezone) AT TIME ZONE w.timezone)`

export async function dashboard(ctx: Ctx) {
  const db = scoped(ctx)
  const me = isCompanyWide(ctx) ? null : ctx.userId

  const newLeadsToday = (await db.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM leads l JOIN workspaces w ON w.id = l.workspace_id
       LEFT JOIN lead_assignments a ON a.lead_id = l.id AND a.closed_at IS NULL
      WHERE l.workspace_id = $1 AND l.created_at >= ${TODAY} AND ($2::uuid IS NULL OR a.user_id = $2)`, [me])).n

  const pipeline = hasPermission(ctx, 'opportunity_value.view')
    ? await db.many<{ stage: string; total: string; count: number }>(
        `SELECT s.name AS stage, COALESCE(sum(o.value), 0)::text AS total, count(o.id)::int AS count
           FROM stages s JOIN opportunities o ON o.stage_id = s.id
          WHERE o.workspace_id = $1 AND NOT s.is_won AND NOT s.is_lost AND ($2::uuid IS NULL OR o.owner_id = $2)
          GROUP BY s.id, s.name, s.position ORDER BY s.position`, [me])
    : null

  const firstResponse = (await db.one<{ seconds: number | null; n: number }>(
    `SELECT round(extract(epoch FROM avg(time_to_first_response)))::int AS seconds, count(time_to_first_response)::int AS n
       FROM lead_first_response WHERE workspace_id = $1 AND ($2::uuid IS NULL OR responder_id = $2)`, [me]))

  const recovery = (await db.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM recovery_queue WHERE workspace_id = $1 AND ($2::uuid IS NULL OR owner_id = $2)`, [me])).n

  const escalations = await db.one<{ escalated: number; reassigned: number }>(
    `SELECT count(*) FILTER (WHERE outcome = 'escalated')::int AS escalated,
            count(*) FILTER (WHERE outcome = 'reassigned')::int AS reassigned
       FROM lead_assignments
      WHERE workspace_id = $1 AND closed_at > now() - interval '24 hours' AND ($2::uuid IS NULL OR user_id = $2)`, [me])

  const availability = await db.many<{ availability: string; n: number }>(
    `SELECT availability, count(*)::int AS n FROM users
      WHERE workspace_id = $1 AND deactivated_at IS NULL AND ($2::uuid IS NULL OR id = $2)
      GROUP BY availability`, [me])

  const appointments = (await db.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM appointments
      WHERE workspace_id = $1 AND status = 'confirmed' AND starts_at_utc > now() AND ($2::uuid IS NULL OR user_id = $2)`, [me])).n

  // collected = confirmed by the provider webhook minus refunds; projected shown separately
  const money = await db.one<{ collected: string; projected: string }>(
    `SELECT
       (SELECT COALESCE(sum(p.amount - p.refunded_amount), 0) FROM payments p JOIN workspaces w ON w.id = p.workspace_id
         WHERE p.workspace_id = $1 AND p.status IN ('paid', 'refunded') AND p.paid_at >= ${MONTH}
           AND ($2::uuid IS NULL OR p.requested_by = $2))::text AS collected,
       ((SELECT COALESCE(sum(o.value), 0) FROM opportunities o JOIN stages s ON s.id = o.stage_id
          WHERE o.workspace_id = $1 AND NOT s.is_won AND NOT s.is_lost AND ($2::uuid IS NULL OR o.owner_id = $2))
        + (SELECT COALESCE(sum(p.amount), 0) FROM payments p
          WHERE p.workspace_id = $1 AND p.status = 'pending' AND ($2::uuid IS NULL OR p.requested_by = $2)))::text AS projected`, [me])

  return {
    personal: !!me,
    newLeadsToday, pipeline, firstResponse, recovery,
    escalations24h: escalations.escalated, manualReassigns24h: escalations.reassigned,
    availability, appointments,
    collectedThisMonth: money.collected,
    projected: hasPermission(ctx, 'opportunity_value.view') ? money.projected : null,
  }
}
