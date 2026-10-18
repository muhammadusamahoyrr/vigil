import Link from 'next/link'
import { Badge, Card, PageTitle, REASON_LABEL, SOURCE_LABEL, fmt } from '@/components/ui-bits'
import { getCtxOrNull } from '@/lib/session'
import { listRecovery } from '@/services/leads'

export default async function RecoveryPage() {
  const ctx = (await getCtxOrNull())!
  const rows = await listRecovery(ctx)
  return (
    <>
      <PageTitle title="Recovery queue" />
      <p className="text-sm text-muted-foreground">
        Leads that need attention: not acknowledged in time, escalated twice or more, idle, owner unavailable, or no owner.
        Open a lead to reassign it.
      </p>
      <Card>
        {rows.length === 0 ? <p className="text-foreground">Nothing needs recovery right now.</p> : (
          <ul className="divide-y divide-border">
            {rows.map(r => (
              <li key={r.lead_id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/leads/${r.lead_id}`} className="font-medium text-foreground underline-offset-4 hover:underline">{r.contact_name}</Link>
                  <span className="text-xs text-muted-foreground">{SOURCE_LABEL[r.source] ?? r.source} · created {fmt(r.lead_created_at)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(r.reasons as string[]).map(x => <Badge key={x} tone={x === 'idle' ? 'warn' : 'bad'}>{REASON_LABEL[x] ?? x}</Badge>)}
                </div>
                <span className="text-sm text-foreground">Owner: {r.owner_name ?? '—'}{r.owner_availability && r.owner_availability !== 'available' ? ` (${r.owner_availability.replace('_', ' ')})` : ''} · escalations: {r.escalation_count}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
