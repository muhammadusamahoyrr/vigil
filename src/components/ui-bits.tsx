import Link from 'next/link'

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      {children}
    </div>
  )
}

export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {title && <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>}
      {children}
    </section>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
    good: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    warn: 'bg-amber-50 text-amber-900 ring-amber-200',
    bad: 'bg-rose-50 text-rose-800 ring-rose-200',
  }
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>{children}</span>
}

export const inputClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-base text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive'

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="font-medium underline underline-offset-4">{children}</Link>
}

export const SOURCE_LABEL: Record<string, string> = { manual: 'Manual', form: 'Web form', message: 'WhatsApp', chat: 'Web chat' }

/** New / Assigned / Acknowledged / Escalated / Recovered, from the open assignment. */
export function leadStatus(a: { owner_id?: string | null; acknowledged_at?: unknown; level?: number | null; reason?: string | null; lead_status?: string | null }):
  { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' } {
  if (a.lead_status && a.lead_status !== 'open') return { label: a.lead_status, tone: 'neutral' }
  if (!a.owner_id) return { label: 'New (no owner yet)', tone: 'warn' }
  if (a.acknowledged_at) return { label: 'Acknowledged', tone: 'good' }
  if (a.reason === 'lead.recovered') return { label: 'Recovered', tone: 'warn' }
  if (a.reason === 'lead.escalated' || (a.level ?? 0) > 0) return { label: 'Escalated', tone: 'bad' }
  return { label: 'Assigned', tone: 'neutral' }
}
export const REASON_LABEL: Record<string, string> = {
  overdue: 'Overdue (not acknowledged in time)',
  escalated_twice: 'Escalated 2+ times',
  idle: 'Idle (no recent action)',
  owner_unavailable: 'Owner unavailable',
  no_owner: 'No owner',
}
export const ASSIGN_REASON: Record<string, string> = {
  'lead.assigned': 'Assigned', 'lead.escalated': 'Escalated', 'lead.reassigned': 'Reassigned by manager',
  'lead.owner_unavailable': 'Moved (owner unavailable)', 'lead.recovered': 'Recovered',
}
export const OUTCOME_LABEL: Record<string, string> = {
  escalated: 'escalated away', reassigned: 'reassigned away', owner_unavailable: 'moved (owner unavailable)', completed: 'completed',
}
export const fmt = (d: string | Date | null) => d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }) : '—'
