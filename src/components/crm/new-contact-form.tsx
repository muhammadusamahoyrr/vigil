"use client"

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, FieldInput } from '@/components/field-input'
import { useAction } from '@/components/use-action'

export function NewContactForm() {
  const router = useRouter()
  const { run, loading, error, fields } = useAction()
  const [f, setF] = useState({ name: '', phone: '', email: '', companyName: '' })
  const set = (k: keyof typeof f) => (v: string) => setF(s => ({ ...s, [k]: v }))
  return (
    <details className="rounded-lg border border-border p-4">
      <summary className="cursor-pointer font-semibold">+ New contact</summary>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" noValidate onSubmit={async e => {
        e.preventDefault()
        const r = await run<{ id: string }>('/api/contacts', f)
        if (r.ok) router.push(`/contacts/${r.data.id}`)
      }}>
        <div className="sm:col-span-2"><Alert error={error} /></div>
        <FieldInput id="c-name" label="Name" required value={f.name} onChange={set('name')} error={fields.name} />
        <FieldInput id="c-company" label="Company" value={f.companyName} onChange={set('companyName')} error={fields.companyName} />
        <FieldInput id="c-phone" label="Phone" type="tel" value={f.phone} onChange={set('phone')} error={fields.phone} />
        <FieldInput id="c-email" label="Email" type="email" value={f.email} onChange={set('email')} error={fields.email} />
        <div className="sm:col-span-2"><Button type="submit" disabled={loading} aria-busy={loading}>{loading ? 'Saving…' : 'Create contact'}</Button></div>
      </form>
    </details>
  )
}
