import Link from 'next/link'
import { Countdown } from '@/components/countdown'
import { Badge, Card, PageTitle, fmt, leadStatus } from '@/components/ui-bits'
import { getCtxOrNull } from '@/lib/session'
import { listConversations } from '@/services/inbox'

const iso = (d: Date | string | null) => (d instanceof Date ? d.toISOString() : d)

export default async function InboxPage() {
  const ctx = (await getCtxOrNull())!
  const rows = await listConversations(ctx)
  return (
    <>
      <PageTitle title="Inbox" />
      <p className="text-sm text-muted-foreground">Customer conversations from Vigil Web Chat. You see the ones whose lead you own{ctx.level !== 'user' ? '; as Owner/Admin you see all' : ''}.</p>
      <Card>
        {rows.length === 0 ? <p>No conversations yet. Share your web chat link to start one.</p> : (
          <ul className="divide-y divide-border">
            {rows.map(r => {
              const st = leadStatus(r)
              return (
                <li key={r.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col">
                    <Link href={`/inbox/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                      {r.contact_name}{r.unread > 0 ? ` (${r.unread} unread)` : ''}
                    </Link>
                    <span className="truncate text-xs text-muted-foreground">{r.preview ?? '—'} · {fmt(r.last_message_at)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {r.unread > 0 && <Badge tone="bad">{r.unread} new</Badge>}
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <span>Owner: {r.owner_name ?? '—'}</span>
                    {r.lead_status === 'open' && r.owner_id && <Countdown deadline={iso(r.deadline_at)} acknowledgedAt={iso(r.acknowledged_at)} />}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}
