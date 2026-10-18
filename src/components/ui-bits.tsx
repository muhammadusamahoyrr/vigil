import Link from 'next/link'

export function PageTitle({ title, description, children }: { title: string; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      {title && <h2 className="mb-4 text-[15px] font-semibold tracking-tight">{title}</h2>}
      {children}
    </section>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const tones = {
    neutral: 'border border-border text-muted-foreground',
    good: 'bg-secondary text-foreground',
    warn: 'border border-amber-400/40 text-amber-300',
    bad: 'bg-foreground text-background',
  }
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

export const inputClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive'

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="font-medium underline underline-offset-4">{children}</Link>
}

export const SOURCE_LABEL: Record<string, string> = { manual: 'Manual', form: 'Web form', message: 'WhatsApp', chat: 'Web chat' }

/** New / Assigned / Acknowledged / Escalated / Recovered, from the open assignment. */
export function leadStatus(a: { owner_id?: string | null; acknowledged_at?: unknown; level?: number | null; reason?: string | null; lead_status?: string | null }):
  { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' } {
  if (a.lead_status && a.lead_status !== 'open') return { label: a.lead_status, tone: 'neutral' }
  if (!a.owner_id) return { label: 'New, no owner', tone: 'warn' }
  if (a.acknowledged_at) return { label: 'Acknowledged', tone: 'good' }
  if (a.reason === 'lead.recovered') return { label: 'Recovered', tone: 'warn' }
  if (a.reason === 'lead.escalated' || (a.level ?? 0) > 0) return { label: 'Escalated', tone: 'bad' }
  return { label: 'Awaiting ack', tone: 'neutral' }
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

/** Table shell: scrolls inside its card on narrow screens, never the page. */
export function DataTable({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border">
              {head.map(h => <th key={h} scope="col" className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">{children}</tbody>
        </table>
      </div>
      {empty}
    </div>
  )
}

export const btn = {
  primary: 'inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring outline-none',
  outline: 'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring outline-none',
}

export function FilterPill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}
      className={`inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium ${active ? 'border-transparent bg-secondary text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>
      {children}
    </Link>
  )
}
