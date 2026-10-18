"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/field-input'
import { useAction } from '@/components/use-action'

type Member = { id: string; name: string; availability: string; openLeads: number }

export function LeadActions({ leadId, isOwner, acknowledged, open, canReassign, team, ownerId }:
  { leadId: string; isOwner: boolean; acknowledged: boolean; open: boolean; canReassign: boolean; team: Member[]; ownerId: string | null }) {
  const ack = useAction(), note = useAction(), re = useAction()
  const [body, setBody] = useState('')
  const [to, setTo] = useState('')
  const [ok, setOk] = useState<string | null>(null)

  if (!open) return null
  return (
    <div className="flex flex-col gap-4">
      <Alert success={ok} />
      {isOwner && !acknowledged && (
        <div className="flex flex-col gap-1">
          <Button size="lg" disabled={ack.loading} aria-busy={ack.loading}
            onClick={async () => { setOk(null); const r = await ack.run(`/api/leads/${leadId}/acknowledge`); if (r.ok) setOk('Acknowledged. The lead stays with you.') }}>
            {ack.loading ? 'Acknowledging…' : 'Acknowledge lead'}
          </Button>
          <Alert error={ack.error} />
        </div>
      )}

      <form className="flex flex-col gap-2" onSubmit={async e => {
        e.preventDefault(); setOk(null)
        const r = await note.run<{ acknowledged: boolean }>(`/api/leads/${leadId}/notes`, { body })
        if (r.ok) { setBody(''); setOk(r.data.acknowledged ? 'Note saved. It also acknowledged the lead.' : 'Note saved.') }
      }}>
        <label htmlFor="note" className="text-sm font-medium text-foreground">Add a note</label>
        <textarea id="note" value={body} onChange={e => setBody(e.target.value)} rows={2} required
          className="rounded-md border border-input bg-background p-2 text-base text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
        <div><Button type="submit" variant="outline" disabled={note.loading} aria-busy={note.loading}>{note.loading ? 'Saving…' : 'Save note'}</Button></div>
        <Alert error={note.error} />
      </form>

      {canReassign && (
        <form className="flex flex-col gap-2" onSubmit={async e => {
          e.preventDefault(); setOk(null)
          const r = await re.run(`/api/leads/${leadId}/reassign`, { toUserId: to })
          if (r.ok) { setTo(''); setOk('Reassigned. The new owner has been alerted.') }
        }}>
          <label htmlFor="reassign" className="text-sm font-medium text-foreground">Reassign to</label>
          <select id="reassign" value={to} onChange={e => setTo(e.target.value)} required
            className="h-10 rounded-md border border-input bg-background px-2 text-base text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <option value="">Choose a person…</option>
            {team.filter(m => m.id !== ownerId).map(m => (
              <option key={m.id} value={m.id} disabled={m.availability !== 'available'}>
                {m.name} ({m.availability.replace('_', ' ')}, {m.openLeads} open)
              </option>
            ))}
          </select>
          <div><Button type="submit" variant="outline" disabled={re.loading || !to} aria-busy={re.loading}>{re.loading ? 'Reassigning…' : 'Reassign'}</Button></div>
          <Alert error={re.error} />
        </form>
      )}
    </div>
  )
}
