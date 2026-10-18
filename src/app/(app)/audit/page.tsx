import Link from 'next/link'
import { Card, PageTitle, fmt } from '@/components/ui-bits'
import { requirePermission } from '@/lib/rbac'
import { getCtxOrNull } from '@/lib/session'
import { listAudit } from '@/services/admin'
import { listTeam } from '@/services/team'

type SP = Promise<{ action?: string; user?: string; from?: string; to?: string; page?: string }>
const short = (v: unknown) => v === null || v === undefined ? '' : JSON.stringify(v).slice(0, 300)

export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  const ctx = (await getCtxOrNull())!
  requirePermission(ctx, 'audit.view')
  const sp = await searchParams
  const [data, team] = await Promise.all([
    listAudit(ctx, { action: sp.action, userId: sp.user, from: sp.from, to: sp.to, page: Number(sp.page ?? 1) }),
    listTeam(ctx),
  ])
  const qs = (page: number) => new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), page: String(page) }).toString()
  const sel = 'h-10 rounded-md border border-input bg-background px-2 text-base text-foreground'
  return (
    <>
      <PageTitle title="Audit log" />
      <p className="text-sm text-muted-foreground">Read-only. Entries cannot be edited or deleted by anyone; the database rejects it.</p>
      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="flex flex-col gap-1"><label htmlFor="action" className="text-sm font-medium">Event type</label>
          <select id="action" name="action" defaultValue={sp.action ?? ''} className={sel}>
            <option value="">All</option>{data.actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select></div>
        <div className="flex flex-col gap-1"><label htmlFor="user" className="text-sm font-medium">User</label>
          <select id="user" name="user" defaultValue={sp.user ?? ''} className={sel}>
            <option value="">Anyone (incl. system)</option>{team.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select></div>
        <div className="flex flex-col gap-1"><label htmlFor="from" className="text-sm font-medium">From</label>
          <input id="from" name="from" type="date" defaultValue={sp.from ?? ''} className={sel} /></div>
        <div className="flex flex-col gap-1"><label htmlFor="to" className="text-sm font-medium">To</label>
          <input id="to" name="to" type="date" defaultValue={sp.to ?? ''} className={sel} /></div>
        <button type="submit" className="h-10 rounded-lg border border-border px-4 font-medium">Filter</button>
      </form>
      <Card>
        <ul className="divide-y divide-border">
          {data.rows.map(r => (
            <li key={r.id} className="py-2 text-sm text-foreground">
              <span className="font-mono font-medium">{r.action}</span> · {r.actor_name ?? 'System'} · {fmt(r.created_at)}
              <span className="text-muted-foreground"> · {r.target_type}{r.target_id ? ` ${String(r.target_id).slice(0, 8)}` : ''}</span>
              {(r.before || r.after) && (
                <details className="mt-1"><summary className="cursor-pointer text-xs underline">Before / after</summary>
                  <p className="break-all font-mono text-xs text-muted-foreground">before: {short(r.before)}</p>
                  <p className="break-all font-mono text-xs text-muted-foreground">after: {short(r.after)}</p>
                </details>
              )}
            </li>
          ))}
          {data.rows.length === 0 && <li className="py-2 text-sm">No entries match.</li>}
        </ul>
        <div className="mt-3 flex gap-4 text-sm">
          {data.page > 1 && <Link className="underline" href={`/audit?${qs(data.page - 1)}`}>Previous</Link>}
          {data.hasMore && <Link className="underline" href={`/audit?${qs(data.page + 1)}`}>Next</Link>}
        </div>
      </Card>
    </>
  )
}
