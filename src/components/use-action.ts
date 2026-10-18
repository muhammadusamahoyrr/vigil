"use client"

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Result<T> = { ok: true; data: T } | { ok: false; error: string; fields: Record<string, string> }

/** POST/PUT JSON to our API, with loading + error state, then refresh server data. */
export function useAction() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  async function run<T = unknown>(url: string, body?: unknown, method = 'POST'): Promise<Result<T>> {
    setLoading(true); setError(null); setFields({})
    try {
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = data.error ?? `Request failed (${res.status}). Please try again.`
        setError(msg); setFields(data.fields ?? {})
        return { ok: false, error: msg, fields: data.fields ?? {} }
      }
      router.refresh()
      return { ok: true, data: data as T }
    } catch {
      const msg = 'Network error. Check your connection and try again.'
      setError(msg)
      return { ok: false, error: msg, fields: {} }
    } finally {
      setLoading(false)
    }
  }
  return { run, loading, error, fields, setError }
}
