import Link from 'next/link'
import { Countdown } from '@/components/countdown'
import { NewLeadForm } from '@/components/leads/new-lead-form'
import { Badge, DataTable, FilterPill, PageTitle, SOURCE_LABEL, btn, fmt, leadStatus } from '@/components/ui-bits'
import { hasPermission } from '@/lib/rbac'
import { getCtxOrNull } from '@/lib/session'
import { listLeads } from '@/services/leads'

type SP = Promise<{ mine?: string; page?: string; today?: string }>
const iso = (d: Date | string | null) => (d instanceof Date ? d.toISOString() : d)

export default async function LeadsPage({ searchParams }: { searchParams: SP }) {
  const ctx = (await getCtxOrNull())!
  const sp = await searchParams
  const today = sp.today === '1'
  const data = await listLeads(ctx, { mine: sp.mine === '1', page: Number(sp.page ?? 1), today })
  const qs = (o: Record<string, string | undefined>) => '/leads?' + new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString()
  return (
    <>
      <PageTitle title="Leads" description="Every inbound lead with exactly one accountable owner and a live acknowledgement timer.">
        {hasPermission(ctx, 'assignment_rules.manage') && <Link href="/settings/rules" className={btn.outline}>Assignment rules</Link>}
      </PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        {data.canSeeAll && <FilterPill href={qs({ today: today ? '1' : undefined })} active={!data.onlyMine}>Owner: All</FilterPill>}
        <FilterPill href={qs({ mine: '1', today: today ? '1' : undefined })} active={data.onlyMine}>Owner: Me</FilterPill>
        <FilterPill href={qs({ mine: data.onlyMine && data.canSeeAll ? '1' : undefined, today: today ? undefined : '1' })} active={today}>Created: Today</FilterPill>
      </div>
      {hasPermission(ctx, 'crm.create') && <div id="new"><NewLeadForm /></div>}
      <DataTable head={['Lead', 'Source', 'Owner', 'Status', 'Ack window', 'Escalations', 'Received']}
        empty={data.leads.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No leads match. Share your web chat link or add one above.</p> : null}>
        {data.leads.map(l => {
          const st = leadStatus({ ...l, lead_status: l.status })
          return (
            <tr key={l.id} className="hover:bg-accent/40">
              <td className="px-4 py-3">
                <Link href={`/leads/${l.id}`} className="font-medium hover:underline">{l.contact_name}</Link>
                {l.phone && <span className="block text-xs text-muted-foreground">{l.phone}</span>}
              </td>
              <td className="px-4 py-3"><Badge>{SOURCE_LABEL[l.source] ?? l.source}</Badge></td>
              <td className="px-4 py-3 text-muted-foreground">{l.owner_name ?? '—'}</td>
              <td className="px-4 py-3"><Badge tone={st.tone}>{st.label}</Badge></td>
              <td className="px-4 py-3">{l.status === 'open' && l.owner_id ? <Countdown deadline={iso(l.deadline_at)} acknowledgedAt={iso(l.acknowledged_at)} /> : '—'}</td>
              <td className="px-4 py-3 tabular-nums text-muted-foreground">{l.escalations}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(l.created_at)}</td>
            </tr>
          )
        })}
      </DataTable>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{data.leads.length} lead(s) on this page · updates in real time</span>
        <span className="flex gap-2">
          {data.page > 1 && <Link className={btn.outline} href={qs({ mine: data.onlyMine ? '1' : undefined, today: today ? '1' : undefined, page: String(data.page - 1) })}>‹ Prev</Link>}
          {data.hasMore && <Link className={btn.outline} href={qs({ mine: data.onlyMine ? '1' : undefined, today: today ? '1' : undefined, page: String(data.page + 1) })}>Next ›</Link>}
        </span>
      </div>
    </>
  )
}
