import Link from 'next/link'
import { Countdown } from '@/components/countdown'
import { Greeting } from '@/components/dashboard/greeting'
import { Tiles, type Tile } from '@/components/dashboard/tiles'
import { Badge, DataTable, REASON_LABEL, SOURCE_LABEL, btn, leadStatus } from '@/components/ui-bits'
import { dashboard } from '@/lib/metrics'
import { hasPermission } from '@/lib/rbac'
import { getCtxOrNull } from '@/lib/session'
import { getMe } from '@/services/auth'
import { listLeads, listRecovery } from '@/services/leads'
import { hiddenTiles } from '@/services/preferences'

const money = (v: string | number | null, cur = 'PKR') => v === null ? 'Hidden' : `${cur} ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const dur = (s: number | null) => s === null ? '—' : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
const iso = (d: Date | string | null) => (d instanceof Date ? d.toISOString() : d)
const LBL: Record<string, string> = { available: 'Available', busy: 'Busy', on_leave: 'On leave', offline: 'Offline' }
const DOT: Record<string, string> = { available: 'bg-emerald-400', busy: 'bg-amber-400', on_leave: 'bg-rose-400', offline: 'bg-zinc-500' }

export default async function DashboardPage() {
  const ctx = (await getCtxOrNull())!
  const [d, hidden, me, open, recovery] = await Promise.all([
    dashboard(ctx), hiddenTiles(ctx), getMe(ctx), listLeads(ctx, { status: 'open', mine: false }), listRecovery(ctx),
  ])
  // unacknowledged first, soonest deadline first
  const attention = [...open.leads]
    .sort((a, b) => Number(!!a.acknowledged_at) - Number(!!b.acknowledged_at) || (new Date(a.deadline_at ?? 0).getTime() - new Date(b.deadline_at ?? 0).getTime()))
    .slice(0, 6)
  const pipelineTotal = d.pipeline?.reduce((s, p) => s + Number(p.total), 0) ?? 0
  const shades = ['bg-zinc-100 text-zinc-900', 'bg-zinc-300 text-zinc-900', 'bg-zinc-500 text-white', 'bg-zinc-700 text-white', 'bg-zinc-800 text-white']

  const tiles: Tile[] = [
    { id: 'newLeads', title: 'New leads today', value: String(d.newLeadsToday), href: `/leads?today=1${d.personal ? '&mine=1' : ''}`, hint: 'Since local midnight' },
    { id: 'firstResponse', title: 'Avg first response', value: dur(d.firstResponse.seconds), hint: `Assign → acknowledge, ${d.firstResponse.n} lead(s)` },
    { id: 'recovery', title: 'Recovery queue', value: String(d.recovery), href: '/recovery', hint: 'Needs a manager' },
    { id: 'escalations', title: 'Escalations (24h)', value: String(d.escalations24h), href: hasPermission(ctx, 'audit.view') ? '/audit?action=lead.escalated' : undefined, hint: `${d.manualReassigns24h} manual reassign(s) counted separately` },
    { id: 'pipeline', title: 'Open pipeline', value: d.pipeline === null ? 'Hidden' : money(pipelineTotal), href: '/pipeline' },
    { id: 'payments', title: 'Collected this month', value: money(d.collectedThisMonth), hint: d.projected === null ? 'Provider-confirmed only' : `Projected: ${money(d.projected)}` },
    { id: 'appointments', title: 'Upcoming appointments', value: String(d.appointments) },
    { id: 'availability', title: 'Team available', value: String(d.availability.find(a => a.availability === 'available')?.n ?? 0), href: '/team' },
  ]

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Greeting name={me.name.split(' ')[0]} />
          <p className="mt-1.5 text-sm text-muted-foreground">
            A live operational view showing <span className="font-medium text-foreground">{d.personal ? 'your personal' : 'company-wide'}</span> figures. Figures with an arrow open the records behind them.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/inbox" className={btn.outline}>Inbox</Link>
          {hasPermission(ctx, 'crm.create') && <Link href="/leads#new" className={btn.primary}>+ Create lead</Link>}
        </div>
      </div>

      <Tiles tiles={tiles} hidden={hidden} />

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          {d.pipeline !== null && (
            <section aria-labelledby="pipe" className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-baseline justify-between">
                <h2 id="pipe" className="text-[15px] font-semibold tracking-tight">Open pipeline value by stage</h2>
                <span className="text-lg font-semibold tracking-tight">{money(pipelineTotal)}</span>
              </div>
              {pipelineTotal === 0 ? <p className="mt-4 text-sm text-muted-foreground">No open opportunities yet. Add one from a contact page.</p> : (
                <>
                  <div className="mt-4 flex h-9 overflow-hidden rounded-md">
                    {d.pipeline.filter(p => Number(p.total) > 0).map((p, i) => (
                      <div key={p.stage} className={`grid place-items-center px-2 text-[11px] font-semibold ${shades[i % shades.length]}`} style={{ width: `${(Number(p.total) / pipelineTotal) * 100}%` }} title={`${p.stage}: ${money(p.total)}`}>
                        <span className="truncate">{money(p.total)}</span>
                      </div>
                    ))}
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    {d.pipeline.map(p => <li key={p.stage}>● {p.stage} · {money(p.total)} ({p.count})</li>)}
                  </ul>
                </>
              )}
            </section>
          )}

          <section aria-labelledby="attn">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="attn" className="text-[15px] font-semibold tracking-tight">Leads requiring immediate attention</h2>
              <Link href="/leads" className="text-xs text-muted-foreground hover:text-foreground">All leads →</Link>
            </div>
            <DataTable head={['Lead', 'Source', 'Owner', 'Ack window', 'Status']}
              empty={attention.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No open leads. New ones appear here instantly.</p> : null}>
              {attention.map(l => {
                const st = leadStatus(l)
                return (
                  <tr key={l.id} className="hover:bg-accent/40">
                    <td className="px-4 py-3"><Link href={`/leads/${l.id}`} className="font-medium hover:underline">{l.contact_name}</Link></td>
                    <td className="px-4 py-3"><Badge>{SOURCE_LABEL[l.source] ?? l.source}</Badge></td>
                    <td className="px-4 py-3 text-muted-foreground">{l.owner_name ?? '—'}</td>
                    <td className="px-4 py-3">{l.owner_id ? <Countdown deadline={iso(l.deadline_at)} acknowledgedAt={iso(l.acknowledged_at)} /> : '—'}</td>
                    <td className="px-4 py-3"><Badge tone={st.tone}>{st.label}</Badge></td>
                  </tr>
                )
              })}
            </DataTable>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section aria-labelledby="avail" className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 id="avail" className="text-[15px] font-semibold tracking-tight">Employee availability</h2>
              <Link href="/team" className="text-xs text-muted-foreground hover:text-foreground">Manage</Link>
            </div>
            <ul className="mt-3 divide-y divide-border">
              {['available', 'busy', 'on_leave', 'offline'].map(s => (
                <li key={s} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="flex items-center gap-2.5"><span aria-hidden className={`size-2 rounded-full ${DOT[s]}`} />{LBL[s]}</span>
                  <span className="font-medium tabular-nums">{d.availability.find(a => a.availability === s)?.n ?? 0}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="rec" className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 id="rec" className="text-[15px] font-semibold tracking-tight">Recovery queue</h2>
              <Link href="/recovery" className="text-xs text-muted-foreground hover:text-foreground">All</Link>
            </div>
            {recovery.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nothing needs recovery.</p> : (
              <ul className="mt-3 divide-y divide-border">
                {recovery.slice(0, 5).map(r => (
                  <li key={r.lead_id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                    <Link href={`/leads/${r.lead_id}`} className="min-w-0 font-medium hover:underline"><span className="block truncate">{r.contact_name}</span>
                      <span className="block truncate text-xs font-normal text-muted-foreground">{r.owner_name ?? 'No owner'}</span></Link>
                    <Badge tone="bad">{REASON_LABEL[(r.reasons as string[])[0]]?.split(' (')[0] ?? 'Attention'}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
