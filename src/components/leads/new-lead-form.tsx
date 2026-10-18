"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, FieldInput } from '@/components/field-input'
import { useAction } from '@/components/use-action'

export function NewLeadForm() {
  const { run, loading, error, fields } = useAction()
  const [f, setF] = useState({ name: '', phone: '', email: '', message: '' })
  const [ok, setOk] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (v: string) => setF(s => ({ ...s, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setOk(null)
    const r = await run<{ assignmentId: string | null }>('/api/leads', f)
    if (r.ok) {
      setOk(r.data.assignmentId ? 'Lead created and assigned.' : 'Lead created. Nobody is Available yet, it will be assigned automatically.')
      setF({ name: '', phone: '', email: '', message: '' })
    }
  }

  return (
    <details className="rounded-lg border border-border p-4">
      <summary className="cursor-pointer font-semibold text-foreground">+ New lead (manual entry)</summary>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2"><Alert error={error} success={ok} /></div>
        <FieldInput id="lead-name" label="Customer name" required value={f.name} onChange={set('name')} error={fields.name} />
        <FieldInput id="lead-phone" label="Phone" type="tel" value={f.phone} onChange={set('phone')} error={fields.phone} placeholder="+923001234567" />
        <FieldInput id="lead-email" label="Email" type="email" value={f.email} onChange={set('email')} error={fields.email} />
        <FieldInput id="lead-message" label="What do they need?" value={f.message} onChange={set('message')} error={fields.message} />
        <div className="sm:col-span-2">
          <Button type="submit" disabled={loading} aria-busy={loading}>{loading ? 'Creating…' : 'Create lead'}</Button>
        </div>
      </form>
    </details>
  )
}
