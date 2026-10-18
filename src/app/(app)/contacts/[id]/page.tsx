import Link from 'next/link'
import { ContactActions } from '@/components/crm/contact-actions'
import { Badge, Card, PageTitle, SOURCE_LABEL, fmt } from '@/components/ui-bits'
import { hasPermission } from '@/lib/rbac'
import { getCtxOrNull } from '@/lib/session'
import { getContact } from '@/services/crm'

const money = (v: unknown, c: string) => v === null ? 'Hidden' : `${c} ${Number(v).toLocaleString('en-US')}`

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = (await getCtxOrNull())!
  const d = await getContact(ctx, (await params).id)
  const c = d.contact
  const owner = d.leads.find(l => l.status === 'open')?.owner_name
  return (
    <>
      <p className="text-sm"><Link href="/contacts" className="underline underline-offset-4">← All contacts</Link></p>
      <PageTitle title={c.name}>{c.opted_out && <Badge tone="warn">Opted out of messages</Badge>}</PageTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="font-medium">Phone</dt><dd>{c.phone ?? '—'}</dd>
            <dt className="font-medium">Email</dt><dd className="break-all">{c.email ?? '—'}</dd>
            <dt className="font-medium">Company</dt><dd>{c.company_name ?? '—'}</dd>
            <dt className="font-medium">Assigned employee</dt><dd>{owner ?? '—'}</dd>
          </dl>
          <ContactActions contact={{ id: c.id, name: c.name, phone: c.phone ?? '', email: c.email ?? '', companyName: c.company_name ?? '', version: c.version }}
            canEdit={hasPermission(ctx, 'crm.edit')} canDelete={hasPermission(ctx, 'crm.delete')} canCreate={hasPermission(ctx, 'crm.create')} />
        </Card>
        <Card title="Opportunities">
          <ul className="flex flex-col gap-2 text-sm">
            {d.opportunities.map(o => (
              <li key={o.id}>{o.name} · {o.pipeline_name} / <span className="font-medium">{o.stage_name}</span> · {money(o.value, o.currency)}{o.value_masked ? ' (needs "See opportunity value")' : ''} · payment: {o.payment_status}</li>
            ))}
            {d.opportunities.length === 0 && <li>None yet.</li>}
          </ul>
        </Card>
        <Card title="Leads">
          <ul className="flex flex-col gap-2 text-sm">
            {d.leads.map(l => <li key={l.id}><Link href={`/leads/${l.id}`} className="underline">{SOURCE_LABEL[l.source] ?? l.source} lead</Link> · {l.status} · owner {l.owner_name ?? '—'} · {fmt(l.created_at)}</li>)}
            {d.leads.length === 0 && <li>None.</li>}
          </ul>
        </Card>
        <Card title="Conversations">
          <ul className="flex flex-col gap-2 text-sm">
            {d.conversations.map(v => <li key={v.id}>{v.channel} · {v.messages} message(s) · last {fmt(v.last_message_at)}</li>)}
            {d.conversations.length === 0 && <li>No conversations yet.</li>}
          </ul>
        </Card>
        <Card title="Payments">
          <ul className="flex flex-col gap-2 text-sm">
            {d.payments.map(p => <li key={p.id}>{p.currency} {p.amount} · {p.status} · requested by {p.requested_by} · ref {p.provider_ref}</li>)}
            {d.payments.length === 0 && <li>No payments yet.</li>}
          </ul>
        </Card>
        <Card title="Appointments">
          <ul className="flex flex-col gap-2 text-sm">
            {d.appointments.map(a => <li key={a.id}>{a.title} · {fmt(a.starts_at_utc)} ({a.timezone}) · {a.employee} · {a.status}</li>)}
            {d.appointments.length === 0 && <li>No appointments yet.</li>}
          </ul>
        </Card>
      </div>
      <Card title="Activity history">
        <ul className="flex flex-col gap-2 text-sm">
          {d.activities.map(a => <li key={a.id}><span className="font-medium capitalize">{a.kind.replace('_', ' ')}</span> · {a.actor_name ?? 'System'} · {fmt(a.created_at)}{a.body ? ` · ${a.body}` : ''}</li>)}
        </ul>
      </Card>
    </>
  )
}
