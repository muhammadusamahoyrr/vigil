'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FormError } from './field'

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 401 invalid credentials, 423 locked: the server message says what to do
        setError(data.error ?? 'Could not log in. Please try again.')
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
      <Field id="email" label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} />
      <Field id="password" label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
      <Button type="submit" size="lg" disabled={loading} aria-busy={loading}>
        {loading ? 'Logging in…' : 'Log in'}
      </Button>
    </form>
  )
}
