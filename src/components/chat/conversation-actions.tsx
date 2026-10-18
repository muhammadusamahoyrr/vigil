"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/field-input'
import { useAction } from '@/components/use-action'

export function ConversationActions({ conversationId, leadId, canReply, canAcknowledge }:
  { conversationId: string; leadId: string | null; canReply: boolean; canAcknowledge: boolean }) {
  const reply = useAction(), ack = useAction()
  const [body, setBody] = useState('')
  const [ok, setOk] = useState<string | null>(null)
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3">
      <Alert error={reply.error ?? ack.error} success={ok} />
      {canAcknowledge && leadId && (
        <div>
          <Button size="lg" disabled={ack.loading} aria-busy={ack.loading} onClick={async () => {
            setOk(null)
            const r = await ack.run(`/api/leads/${leadId}/acknowledge`)
            if (r.ok) setOk('Acknowledged. The lead stays with you.')
          }}>{ack.loading ? 'Acknowledging…' : 'Acknowledge lead'}</Button>
        </div>
      )}
      {canReply ? (
        <form className="flex flex-col gap-2" onSubmit={async e => {
          e.preventDefault(); setOk(null)
          const r = await reply.run<{ acknowledged: boolean }>(`/api/inbox/${conversationId}/reply`, { body })
          if (r.ok) { setBody(''); setOk(r.data.acknowledged ? 'Sent. Replying also acknowledged the lead.' : 'Sent. The customer sees it now.') }
        }}>
          <label htmlFor="reply" className="text-sm font-medium">Reply to customer</label>
          <textarea id="reply" rows={3} value={body} onChange={e => setBody(e.target.value)} required
            className="rounded-md border border-input bg-background p-2 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
          <div><Button type="submit" size="lg" disabled={reply.loading || !body.trim()} aria-busy={reply.loading}>{reply.loading ? 'Sending…' : 'Send reply'}</Button></div>
        </form>
      ) : <p className="text-sm text-muted-foreground">You cannot reply here (needs the &quot;Send messages&quot; permission, web chat only).</p>}
    </div>
  )
}
