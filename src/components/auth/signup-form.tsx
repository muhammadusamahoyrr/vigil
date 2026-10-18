'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FormError } from './field'

export function SignupForm() {
  const router = useRouter()
  const [form, setForm] = useState({ workspaceName: '', name: '', email: '', password: '' })
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null); setFields({})
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not create the workspace. Please try again.')
        setFields(data.fields ?? {})
        return
      }
      router.replace('/dashboard')
      router.refresh()
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <FormError message={error} />
      <Field id="workspaceName" label="Company / workspace name" autoComplete="organization"
             value={form.workspaceName} onChange={set('workspaceName')} error={fields.workspaceName} />
      <Field id="name" label="Your name" autoComplete="name" value={form.name} onChange={set('name')} error={fields.name} />
      <Field id="email" label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={fields.email} />
      <Field id="password" label="Password" type="password" autoComplete="new-password" hint="At least 10 characters."
             value={form.password} onChange={set('password')} error={fields.password} />
      <Button type="submit" size="lg" disabled={loading} aria-busy={loading}>
        {loading ? 'Creating workspace…' : 'Create workspace'}
      </Button>
    </form>
  )
}
