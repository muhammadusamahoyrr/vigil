import Link from 'next/link'
import { ConversationActions } from '@/components/chat/conversation-actions'
import { Countdown } from '@/components/countdown'
import { Badge, Card, PageTitle, fmt, leadStatus } from '@/components/ui-bits'
import { hasPermission } from '@/lib/rbac'
import { getCtxOrNull } from '@/lib/session'
import { getConversation } from '@/services/inbox'

const iso = (d: Date | string | null) => (d instanceof Date ? d.toISOString() : d)

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = (await getCtxOrNull())!
  const { conversation: c, messages, escalations } = await getConversation(ctx, (await params).id)
  const st = leadStatus(c)
  return (
    <>
      <p className="text-sm"><Link href="/inbox" className="underline underline-offset-4">← Inbox</Link></p>
      <PageTitle title={c.contact_name}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{c.channel === 'web' ? 'Web chat' : c.channel}</Badge>
          <Badge tone={st.tone}>{st.label}</Badge>
          {escalations > 0 && <Badge tone="warn">Escalated ×{escalations}</Badge>}
        </div>
      </PageTitle>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Messages">
          <ol className="flex flex-col gap-2" aria-live="polite">
            {messages.map(m => (
              <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.direction === 'out' ? 'self-end bg-primary text-primary-foreground' : 'self-start border border-border'}`}>
                <span className="block text-xs opacity-80">{m.direction === 'out' ? (m.sent_by_name ?? 'Team') : c.contact_name} · {fmt(m.created_at)}</span>
                <span className="whitespace-pre-wrap break-words">{m.body}</span>
              </li>
            ))}
          </ol>
          {c.customer_read_at && messages.some(m => m.direction === 'out') && (
            <p className="mt-2 text-xs text-muted-foreground">Customer last viewed the chat {fmt(c.customer_read_at)}</p>
          )}
          <ConversationActions conversationId={c.id} leadId={c.lead_id} canReply={hasPermission(ctx, 'conversations.send') && c.channel === 'web'}
            canAcknowledge={c.owner_id === ctx.userId && !c.acknowledged_at && c.lead_status === 'open'} />
        </Card>
        <Card title="Lead">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="font-medium">Owner</dt><dd>{c.owner_name ?? 'Nobody yet'}</dd>
            <dt className="font-medium">Status</dt>
            <dd>{c.lead_status === 'open' && c.owner_id ? <Countdown deadline={iso(c.deadline_at)} acknowledgedAt={iso(c.acknowledged_at)} /> : c.lead_status ?? '—'}</dd>
            <dt className="font-medium">Level</dt><dd>{c.level ?? '—'}</dd>
            <dt className="font-medium">Phone</dt><dd>{c.phone ?? '—'}</dd>
            <dt className="font-medium">Email</dt><dd className="break-all">{c.email ?? '—'}</dd>
          </dl>
          {c.lead_id && <p className="mt-3 text-sm"><Link className="underline" href={`/leads/${c.lead_id}`}>Open lead: ownership chain and reassign</Link></p>}
        </Card>
      </div>
    </>
  )
}
