"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, FieldInput } from '@/components/field-input'

export function PublicLeadForm({ token }: { token: string }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', message: '', website: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [done, setDone] = useState(false)
  const set = (k: keyof typeof f) => (v: string) => setF(s => ({ ...s, [k]: v }))

  if (done) return <Alert success="Thank you! We received your request and will contact you soon." />
  return (
    <form className="flex flex-col gap-3" noValidate onSubmit={async e => {
      e.preventDefault(); setLoading(true); setError(null); setFields({})
      try {
        const res = await fetch(`/api/public/forms/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { setError(data.error ?? 'Could not send. Please try again.'); setFields(data.fields ?? {}); return }
        setDone(true)
      } catch { setError('Network error. Please try again.') } finally { setLoading(false) }
    }}>
      <Alert error={error} />
      <FieldInput id="pf-name" label="Your name" required value={f.name} onChange={set('name')} error={fields.name} autoComplete="name" />
      <FieldInput id="pf-phone" label="Phone" type="tel" value={f.phone} onChange={set('phone')} error={fields.phone} autoComplete="tel" placeholder="+923001234567" />
      <FieldInput id="pf-email" label="Email" type="email" value={f.email} onChange={set('email')} error={fields.email} autoComplete="email" />
      <FieldInput id="pf-message" label="How can we help?" value={f.message} onChange={set('message')} error={fields.message} />
      {/* honeypot: hidden from people and assistive tech; bots fill it */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="pf-website">Website</label>
        <input id="pf-website" tabIndex={-1} autoComplete="off" value={f.website} onChange={e => set('website')(e.target.value)} />
      </div>
      <Button type="submit" size="lg" disabled={loading} aria-busy={loading}>{loading ? 'Sending…' : 'Send'}</Button>
    </form>
  )
}
