"use client"

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/field-input'
import { useAction } from '@/components/use-action'

type N = { id: string; kind: string; title: string; body: string | null; leadId: string | null; conversationId: string | null; read: boolean; at: string }
const TONE: Record<string, string> = { 'lead.missed': 'border-red-600', 'lead.escalated': 'border-amber-600', 'message.new': 'border-primary' }

export function NotificationList({ rows }: { rows: N[] }) {
  const { run, loading, error } = useAction()
  const unread = rows.filter(r => !r.read).length
  return (
    <div className="flex flex-col gap-3">
      <Alert error={error} />
      <div className="flex items-center gap-3">
        <span className="text-sm">{unread} unread</span>
        <Button variant="outline" size="sm" disabled={loading || unread === 0} onClick={() => run('/api/notifications/read', { all: true })}>Mark all read</Button>
      </div>
      {rows.length === 0 && <p className="text-sm">No notifications yet.</p>}
      <ul className="flex flex-col gap-2">
        {rows.map(n => (
          <li key={n.id} className={`flex flex-col gap-1 rounded-md border-l-4 border border-border p-3 text-sm ${TONE[n.kind] ?? ''} ${n.read ? 'opacity-70' : ''}`}>
            <span className="font-medium">{n.read ? '' : '● '}{n.title}</span>
            <span className="text-muted-foreground">{n.body} · {new Date(n.at).toLocaleString()}</span>
            <span className="flex flex-wrap gap-3">
              {n.conversationId && <Link className="underline" href={`/inbox/${n.conversationId}`}>Open conversation</Link>}
              {n.leadId && <Link className="underline" href={`/leads/${n.leadId}`}>Open lead</Link>}
              {!n.read && <button type="button" className="underline" disabled={loading} onClick={() => run('/api/notifications/read', { ids: [n.id] })}>Mark read</button>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
