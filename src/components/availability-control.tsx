"use client"

import { useState } from 'react'
import { useAction } from './use-action'

const LABELS: Record<string, string> = { available: 'Available', busy: 'Busy', on_leave: 'On leave', offline: 'Offline' }
export const AVAILABILITY_POLICY = 'When you are set to On leave or Offline, your unacknowledged leads move to the next eligible person immediately. Leads you already acknowledged stay with you and appear in the Recovery queue as "owner unavailable" so a manager can reassign them.'

export function AvailabilityControl({ userId, current, label = 'My availability', showPolicy = true }:
  { userId: string; current: string; label?: string; showPolicy?: boolean }) {
  const { run, loading, error } = useAction()
  const [msg, setMsg] = useState<string | null>(null)
  const id = `availability-${userId}`

  async function change(status: string) {
    setMsg(null)
    const r = await run<{ moved: number }>(`/api/users/${userId}/availability`, { status })
    if (r.ok) setMsg(r.data.moved > 0 ? `Saved. ${r.data.moved} unacknowledged lead(s) moved to the next person.` : 'Saved.')
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>
      <select id={id} defaultValue={current} disabled={loading} onChange={e => change(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 outline-none">
        {Object.entries(LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {showPolicy && <p className="max-w-sm text-xs text-muted-foreground">{AVAILABILITY_POLICY}</p>}
      {loading && <p className="text-xs text-muted-foreground">Saving…</p>}
      {msg && <p role="status" className="text-xs text-green-800 dark:text-green-400">{msg}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
