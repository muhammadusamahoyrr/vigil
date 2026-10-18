"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type Msg = { from: 'customer' | 'agent'; body: string; at: string; agent: string | null }
type Conv = { messages: Msg[] } | null

const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '')

export function ChatClient({ slug, initial }: { slug: string; initial: Conv }) {
  const [conv, setConv] = useState<Conv>(initial)
  const [form, setForm] = useState({ name: '', phone: '', email: '', message: '' })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [link, setLink] = useState<'live' | 'polling' | 'off'>('off')
  const keyRef = useRef<string | null>(null)   // reused on retry, so a resend is not a duplicate
  const endRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    const res = await fetch(`/chat/${slug}/messages`, { cache: 'no-store' })
    if (res.ok) setConv((await res.json()).conversation)
  }, [slug])

  // realtime: SSE pings for this conversation only; fall back to polling if the stream drops
  const started = !!conv
  useEffect(() => {
    if (!started) return
    let poll: ReturnType<typeof setInterval> | undefined
    const es = new EventSource(`/chat/${slug}/stream`)
    es.onopen = () => { setLink('live'); clearInterval(poll); poll = undefined; void refresh() }
    es.onmessage = () => void refresh()
    es.onerror = () => {
      setLink('polling')
      if (!poll) poll = setInterval(() => void refresh(), 5000)
    }
    return () => { es.close(); clearInterval(poll) }
  }, [started, slug, refresh])

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [conv?.messages.length])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (sending) return
    setSending(true); setError(null); setFields({})
    keyRef.current ??= newKey()
    try {
      const body = conv
        ? { idempotencyKey: keyRef.current, message: form.message }
        : { idempotencyKey: keyRef.current, message: form.message, name: form.name, phone: form.phone, email: form.email }
      const res = await fetch(`/chat/${slug}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Could not send. Please try again.'); setFields(data.fields ?? {}); return }
      keyRef.current = null
      setForm(f => ({ ...f, message: '' }))
      await refresh()
    } catch {
      setError('Network problem. Your message was not lost: press Send again.')
    } finally {
      setSending(false)
    }
  }

  const input = 'h-10 w-full rounded-md border border-input bg-background px-3 text-base text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-3" aria-live="polite" aria-label="Conversation">
        {!conv && <p className="text-sm text-foreground">Hi! Tell us who you are and what you need. Someone from our team will answer here.</p>}
        <ol className="flex flex-col gap-2">
          {conv?.messages.map((m, i) => (
            <li key={i} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.from === 'customer' ? 'self-end bg-primary text-primary-foreground' : 'self-start border border-border bg-background text-foreground'}`}>
              <span className="block text-xs opacity-80">{m.from === 'customer' ? 'You' : m.agent ?? 'Team'} · {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="whitespace-pre-wrap break-words">{m.body}</span>
            </li>
          ))}
        </ol>
        <div ref={endRef} />
      </div>
      {conv && (
        <p className="pb-1 text-xs text-muted-foreground" role="status">
          {link === 'live' ? '● Connected: replies appear instantly' : link === 'polling' ? '○ Reconnecting: checking for replies every few seconds' : 'Connecting…'}
        </p>
      )}
      <form onSubmit={send} className="flex flex-col gap-2 border-t border-border pt-3" noValidate>
        {error && <p role="alert" className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive">{error}</p>}
        {!conv && (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor="c-name" className="text-sm font-medium">Your name</label>
              <input id="c-name" className={input} autoComplete="name" value={form.name} aria-invalid={!!fields.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              {fields.name && <p className="text-sm text-destructive">Error: {fields.name}</p>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="c-phone" className="text-sm font-medium">Phone</label>
                <input id="c-phone" type="tel" className={input} autoComplete="tel" placeholder="+923001234567" value={form.phone} aria-invalid={!!fields.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="c-email" className="text-sm font-medium">or Email</label>
                <input id="c-email" type="email" className={input} autoComplete="email" value={form.email} aria-invalid={!!fields.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
            </div>
            {(fields.phone || fields.email) && <p className="text-sm text-destructive">Error: {fields.phone ?? fields.email}</p>}
          </>
        )}
        <label htmlFor="c-message" className="text-sm font-medium">Message</label>
        <textarea id="c-message" rows={2} value={form.message} aria-invalid={!!fields.message}
          onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
          className="rounded-md border border-input bg-background p-2 text-base text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
        {fields.message && <p className="text-sm text-destructive">Error: {fields.message}</p>}
        <Button type="submit" size="lg" disabled={sending || !form.message.trim()} aria-busy={sending}>{sending ? 'Sending…' : 'Send'}</Button>
      </form>
    </div>
  )
}
