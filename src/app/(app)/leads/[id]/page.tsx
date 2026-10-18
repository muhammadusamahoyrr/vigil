import Link from 'next/link'
import { Countdown } from '@/components/countdown'
import { LeadActions } from '@/components/leads/lead-actions'
import { ASSIGN_REASON, Badge, Card, OUTCOME_LABEL, PageTitle, SOURCE_LABEL, fmt } from '@/components/ui-bits'
import { hasPermission } from '@/lib/rbac'
import { getCtxOrNull } from '@/lib/session'
import { getLead } from '@/services/leads'
import { listTeam } from '@/services/team'

const iso = (d: Date | string | null) => (d instanceof Date ? d.toISOString() : d)

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = (await getCtxOrNull())!
  const { lead, history, activities, conversationId } = await getLead(ctx, (await params).id)
  const canReassign = hasPermission(ctx, 'leads.reassign')
  const team = canReassign ? (await listTeam(ctx)).filter(u => !u.deactivated_at) : []
  return (
    <>
      <p className="text-sm"><Link href="/leads" className="underline underline-offset-4">← All leads</Link></p>
      <PageTitle title={lead.contact_name}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{SOURCE_LABEL[lead.source] ?? lead.source}</Badge>
          {conversationId && <Link href={`/inbox/${conversationId}`} className="text-sm underline underline-offset-4">Open chat</Link>}
        </div>
      </PageTitle>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Ownership">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-foreground">
            <dt className="font-medium">Owner</dt>
            <dd>{lead.owner_name ?? 'Nobody yet'}{lead.owner_availability && lead.owner_availability !== 'available' ? ` (${lead.owner_availability.replace('_', ' ')})` : ''}</dd>
            <dt className="font-medium">Status</dt>
            <dd>{lead.status === 'open' ? <Countdown deadline={iso(lead.deadline_at)} acknowledgedAt={iso(lead.acknowledged_at)} /> : lead.status}</dd>
            <dt className="font-medium">Level</dt><dd>{lead.level ?? '—'}</dd>
            <dt className="font-medium">Created</dt><dd>{fmt(lead.created_at)}</dd>
          </dl>
          <div className="mt-4">
            <LeadActions leadId={lead.id} isOwner={lead.owner_id === ctx.userId} acknowledged={!!lead.acknowledged_at}
              open={lead.status === 'open'} canReassign={canReassign}
              team={team.map(u => ({ id: u.id, name: u.name, availability: u.availability, openLeads: u.open_leads }))}
              ownerId={lead.owner_id} />
          </div>
        </Card>

        <Card title="Contact">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-foreground">
            <dt className="font-medium">Name</dt><dd className="break-words">{lead.contact_name}</dd>
            <dt className="font-medium">Phone</dt><dd>{lead.phone ?? '—'}</dd>
            <dt className="font-medium">Email</dt><dd className="break-all">{lead.email ?? '—'}</dd>
            {lead.opted_out && (<><dt className="font-medium">Messaging</dt><dd>Opted out</dd></>)}
          </dl>
        </Card>
      </div>

      <Card title="Ownership chain">
        <ol className="flex flex-col gap-2">
          {history.map((h, i) => (
            <li key={h.id} className="rounded-md border border-border p-3 text-sm text-foreground">
              <span className="font-medium">{i + 1}. {h.user_name}</span> · {ASSIGN_REASON[h.reason] ?? h.reason} at {fmt(h.assigned_at)} (level {h.level})
              <br />
              {h.acknowledged_at ? `Acknowledged ${fmt(h.acknowledged_at)}` : 'Not acknowledged'}
              {h.closed_at ? ` · Ended ${fmt(h.closed_at)}: ${OUTCOME_LABEL[h.outcome] ?? h.outcome}` : ' · Current owner'}
              {h.retry_at && !h.closed_at ? ' · Nobody eligible to escalate to, retrying' : ''}
            </li>
          ))}
          {history.length === 0 && <li className="text-sm text-foreground">Not assigned yet: nobody is Available. It is assigned automatically when someone is.</li>}
        </ol>
      </Card>

      <Card title="Activity">
        <ul className="flex flex-col gap-2">
          {activities.map(a => (
            <li key={a.id} className="text-sm text-foreground">
              <span className="font-medium capitalize">{a.kind.replace('_', ' ')}</span>
              {' · '}{a.actor_name ?? 'System'} · {fmt(a.created_at)}
              {a.body && <p className="whitespace-pre-wrap break-words text-muted-foreground">{a.body}</p>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
