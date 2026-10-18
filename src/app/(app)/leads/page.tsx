import Link from 'next/link'
import { Countdown } from '@/components/countdown'
import { NewLeadForm } from '@/components/leads/new-lead-form'
import { Badge, Card, PageTitle, SOURCE_LABEL, fmt } from '@/components/ui-bits'
import { hasPermission } from '@/lib/rbac'
import { getCtxOrNull } from '@/lib/session'
import { listLeads } from '@/services/leads'

type SP = Promise<{ mine?: string; page?: string; today?: string }>

export default async function LeadsPage({ searchParams }: { searchParams: SP }) {
  const ctx = (await getCtxOrNull())!
  const sp = await searchParams
  const data = await listLeads(ctx, { mine: sp.mine === '1', page: Number(sp.page ?? 1), today: sp.today === '1' })
  return (
    <>
      <PageTitle title="Leads">
        {data.canSeeAll && (
          <div className="flex gap-3 text-sm">
            <Link href="/leads" aria-current={!data.onlyMine ? 'page' : undefined} className={!data.onlyMine ? 'font-semibold underline' : 'underline-offset-4 hover:underline'}>All leads</Link>
            <Link href="/leads?mine=1" aria-current={data.onlyMine ? 'page' : undefined} className={data.onlyMine ? 'font-semibold underline' : 'underline-offset-4 hover:underline'}>My leads</Link>
          </div>
        )}
      </PageTitle>
      {sp.today === '1' && <p className="text-sm text-foreground">Showing leads created today. <Link href="/leads" className="underline">Show all</Link></p>}
      {hasPermission(ctx, 'crm.create') && <NewLeadForm />}
      <Card>
        {data.leads.length === 0 ? (
          <p className="text-foreground">No leads yet. Add one above, or share your public web form.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.leads.map(l => (
              <li key={l.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col">
                  <Link href={`/leads/${l.id}`} className="font-medium text-foreground underline-offset-4 hover:underline">{l.contact_name}</Link>
                  <span className="text-xs text-muted-foreground">{SOURCE_LABEL[l.source] ?? l.source} · {fmt(l.created_at)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-foreground">Owner: {l.owner_name ?? '—'}</span>
                  {l.status === 'open'
                    ? <Countdown deadline={l.deadline_at?.toISOString?.() ?? l.deadline_at} acknowledgedAt={l.acknowledged_at?.toISOString?.() ?? l.acknowledged_at} />
                    : <Badge>{l.status}</Badge>}
                  {l.escalations > 0 && <Badge tone="warn">Escalated ×{l.escalations}</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex gap-4 text-sm">
          {data.page > 1 && <Link className="underline" href={`/leads?${data.onlyMine ? 'mine=1&' : ''}page=${data.page - 1}`}>Previous</Link>}
          {data.hasMore && <Link className="underline" href={`/leads?${data.onlyMine ? 'mine=1&' : ''}page=${data.page + 1}`}>Next</Link>}
        </div>
      </Card>
    </>
  )
}
