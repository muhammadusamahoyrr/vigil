import { Tiles, type Tile } from '@/components/dashboard/tiles'
import { PageTitle } from '@/components/ui-bits'
import { dashboard } from '@/lib/metrics'
import { getCtxOrNull } from '@/lib/session'
import { hiddenTiles } from '@/services/preferences'

const money = (v: string | null, cur = 'PKR') => v === null ? 'Hidden' : `${cur} ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const dur = (s: number | null) => s === null ? '—' : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
const LBL: Record<string, string> = { available: 'Available', busy: 'Busy', on_leave: 'On leave', offline: 'Offline' }

export default async function DashboardPage() {
  const ctx = (await getCtxOrNull())!
  const [d, hidden] = await Promise.all([dashboard(ctx), hiddenTiles(ctx)])
  const tiles: Tile[] = [
    { id: 'newLeads', title: 'New leads today', value: String(d.newLeadsToday), href: `/leads?today=1${d.personal ? '&mine=1' : ''}`, hint: 'Created since local midnight' },
    { id: 'recovery', title: 'Recovery queue', value: String(d.recovery), href: '/recovery', hint: 'Overdue, escalated 2+, idle, owner unavailable or no owner' },
    { id: 'escalations', title: 'Escalations (24h)', value: String(d.escalations24h), href: '/audit?action=lead.escalated', hint: `Automatic only. Manual reassigns: ${d.manualReassigns24h}` },
    { id: 'firstResponse', title: 'Avg time to first response', value: dur(d.firstResponse.seconds), hint: `First assignment to first acknowledgement, ${d.firstResponse.n} lead(s)` },
    { id: 'availability', title: 'Employee availability', value: d.availability.map(a => `${LBL[a.availability]} ${a.n}`).join(' · ') || '—', href: '/team' },
    { id: 'pipeline', title: 'Open pipeline value', value: d.pipeline === null ? 'Hidden (no permission)' : money(String(d.pipeline.reduce((s, p) => s + Number(p.total), 0))),
      detail: d.pipeline?.map(p => `${p.stage}: ${money(p.total)} (${p.count})`), href: '/pipeline' },
    { id: 'appointments', title: 'Upcoming appointments', value: String(d.appointments) },
    { id: 'payments', title: 'Payments received this month', value: money(d.collectedThisMonth), hint: d.projected === null ? 'Collected revenue only' : `Collected only. Projected (open deals + unpaid requests): ${money(d.projected)}` },
  ]
  return (
    <>
      <PageTitle title="Dashboard" />
      <p className="text-sm text-muted-foreground">{d.personal ? 'Your personal figures (your leads, your response time).' : 'Company-wide figures.'} Click a tile to open the records behind it.</p>
      <Tiles tiles={tiles} hidden={hidden} />
    </>
  )
}
