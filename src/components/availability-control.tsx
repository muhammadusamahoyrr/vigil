"use client"

import { useState } from 'react'
import { useAction } from './use-action'

const LABELS: Record<string, string> = { available: 'Available', busy: 'Busy', on_leave: 'On leave', offline: 'Offline' }
const DOT: Record<string, string> = { available: 'bg-emerald-400', busy: 'bg-amber-400', on_leave: 'bg-rose-400', offline: 'bg-zinc-500' }
export const AVAILABILITY_POLICY = 'When you are set to On leave or Offline, your unacknowledged leads move to the next eligible person immediately. Leads you already acknowledged stay with you and appear in the Recovery queue as "owner unavailable" so a manager can reassign them.'

export function AvailabilityControl({ userId, current, label = 'My availability', showPolicy = true }:
  { userId: string; current: string; label?: string; showPolicy?: boolean }) {
  const { run, loading, error } = useAction()
  const [value, setValue] = useState(current)
  const [msg, setMsg] = useState<string | null>(null)
  const id = `availability-${userId}`

  async function change(status: string) {
    setMsg(null); setValue(status)
    const r = await run<{ moved: number }>(`/api/users/${userId}/availability`, { status })
    if (r.ok) setMsg(r.data.moved > 0 ? `Saved. ${r.data.moved} unacknowledged lead(s) moved on.` : 'Saved.')
    else setValue(current)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative">
        <span aria-hidden className={`pointer-events-none absolute left-2.5 top-1/2 size-2 -translate-y-1/2 rounded-full ${DOT[value]}`} />
        <select id={id} value={value} disabled={loading} onChange={e => change(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background pl-7 pr-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {Object.entries(LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {showPolicy && <p className="text-[11px] leading-snug text-muted-foreground">{AVAILABILITY_POLICY}</p>}
      {loading && <p className="text-xs text-muted-foreground">Saving…</p>}
      {msg && <p role="status" className="text-xs text-emerald-400">{msg}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
