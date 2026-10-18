"use client"

import { useState } from 'react'
import { useAction } from './use-action'

const LABELS: Record<string, string> = { available: 'Available', busy: 'Busy', on_leave: 'On leave', offline: 'Offline' }
const DOT: Record<string, string> = { available: 'bg-emerald-500', busy: 'bg-amber-500', on_leave: 'bg-rose-500', offline: 'bg-slate-400' }
export const AVAILABILITY_POLICY = 'When you are set to On leave or Offline, your unacknowledged leads move to the next eligible person immediately. Leads you already acknowledged stay with you and appear in the Recovery queue as "owner unavailable" so a manager can reassign them.'

export function AvailabilityControl({ userId, current, label = 'My availability', showPolicy = true, tone = 'light' }:
  { userId: string; current: string; label?: string; showPolicy?: boolean; tone?: 'light' | 'dark' }) {
  const { run, loading, error } = useAction()
  const [value, setValue] = useState(current)
  const [msg, setMsg] = useState<string | null>(null)
  const id = `availability-${userId}`
  const dark = tone === 'dark'

  async function change(status: string) {
    setMsg(null); setValue(status)
    const r = await run<{ moved: number }>(`/api/users/${userId}/availability`, { status })
    if (r.ok) setMsg(r.data.moved > 0 ? `Saved. ${r.data.moved} unacknowledged lead(s) moved on.` : 'Saved.')
    else setValue(current)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={`text-xs font-medium ${dark ? 'text-slate-400' : 'text-slate-600'}`}>{label}</label>
      <div className="relative">
        <span aria-hidden className={`pointer-events-none absolute left-2.5 top-1/2 size-2 -translate-y-1/2 rounded-full ${DOT[value]}`} />
        <select id={id} value={value} disabled={loading} onChange={e => change(e.target.value)}
          className={`h-9 w-full rounded-lg pl-7 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
            dark ? 'border border-white/10 bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-900'}`}>
          {Object.entries(LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {showPolicy && <p className={`text-[11px] leading-snug ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{AVAILABILITY_POLICY}</p>}
      {loading && <p className={`text-xs ${dark ? 'text-slate-300' : 'text-slate-600'}`}>Saving…</p>}
      {msg && <p role="status" className={`text-xs ${dark ? 'text-emerald-300' : 'text-emerald-700'}`}>{msg}</p>}
      {error && <p role="alert" className={`text-xs ${dark ? 'text-rose-300' : 'text-destructive'}`}>{error}</p>}
    </div>
  )
}
