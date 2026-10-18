"use client"

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, FieldInput } from '@/components/field-input'
import { useAction } from '@/components/use-action'

type C = { id: string; name: string; phone: string; email: string; companyName: string; version: number }

export function ContactActions({ contact, canEdit, canDelete, canCreate }: { contact: C; canEdit: boolean; canDelete: boolean; canCreate: boolean }) {
  const router = useRouter()
  const edit = useAction(), del = useAction(), opp = useAction()
  const [f, setF] = useState(contact)
  const [o, setO] = useState({ name: '', value: '', currency: 'PKR' })
  const [ok, setOk] = useState<string | null>(null)
  const set = (k: keyof C) => (v: string) => setF(s => ({ ...s, [k]: v }))
  return (
    <div className="mt-4 flex flex-col gap-3">
      <Alert success={ok} />
      {canCreate && (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer font-medium">+ Add opportunity</summary>
          <form className="mt-3 grid gap-2" noValidate onSubmit={async e => {
            e.preventDefault(); setOk(null)
            const r = await opp.run('/api/opportunities', { contactId: contact.id, name: o.name, value: Number(o.value || 0), currency: o.currency })
            if (r.ok) { setO({ name: '', value: '', currency: 'PKR' }); setOk('Opportunity added to the first stage.') }
          }}>
            <Alert error={opp.error} />
            <FieldInput id="o-name" label="Opportunity name" required value={o.name} onChange={v => setO(s => ({ ...s, name: v }))} error={opp.fields.name} />
            <FieldInput id="o-value" label="Value" type="number" required value={o.value} onChange={v => setO(s => ({ ...s, value: v }))} error={opp.fields.value} />
            <FieldInput id="o-cur" label="Currency" required value={o.currency} onChange={v => setO(s => ({ ...s, currency: v }))} error={opp.fields.currency} />
            <div><Button type="submit" disabled={opp.loading}>{opp.loading ? 'Adding…' : 'Add opportunity'}</Button></div>
          </form>
        </details>
      )}
      {canEdit && (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer font-medium">Edit contact</summary>
          <form className="mt-3 grid gap-2" noValidate onSubmit={async e => {
            e.preventDefault(); setOk(null)
            const r = await edit.run(`/api/contacts/${contact.id}`, f, 'PATCH')
            if (r.ok) { setOk('Saved.'); setF(s => ({ ...s, version: s.version + 1 })) }
          }}>
            <Alert error={edit.error} />
            <FieldInput id="e-name" label="Name" required value={f.name} onChange={set('name')} error={edit.fields.name} />
            <FieldInput id="e-phone" label="Phone" value={f.phone} onChange={set('phone')} error={edit.fields.phone} />
            <FieldInput id="e-email" label="Email" value={f.email} onChange={set('email')} error={edit.fields.email} />
            <FieldInput id="e-company" label="Company" value={f.companyName} onChange={set('companyName')} />
            <div><Button type="submit" disabled={edit.loading}>{edit.loading ? 'Saving…' : 'Save'}</Button></div>
          </form>
        </details>
      )}
      {canDelete && (
        <div className="flex flex-col gap-1">
          <div><Button variant="outline" disabled={del.loading} onClick={async () => {
            if (!confirm(`Delete ${contact.name}? This cannot be undone.`)) return
            const r = await del.run(`/api/contacts/${contact.id}`, undefined, 'DELETE')
            if (r.ok) router.push('/contacts')
          }}>{del.loading ? 'Deleting…' : 'Delete contact'}</Button></div>
          <Alert error={del.error} />
        </div>
      )}
    </div>
  )
}
