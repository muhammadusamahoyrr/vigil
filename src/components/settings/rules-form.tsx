"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, FieldInput } from '@/components/field-input'
import { useAction } from '@/components/use-action'

type Level = { type: 'next_available' | 'backup' | 'manager'; seconds: number }
type Rules = { ackWindowSeconds: number; maxOpenLeads: number; idleSeconds: number; escalationLevels: Level[]; backupUserId: string | null; managerRoleId: string | null }
const TYPE_LABEL = { next_available: 'Next available person', backup: 'Backup person', manager: 'Manager role' }

export function RulesForm({ initial, users, roles }: { initial: Rules; users: { id: string; name: string }[]; roles: { id: string; name: string }[] }) {
  const { run, loading, error, fields } = useAction()
  const [r, setR] = useState(initial)
  const [ok, setOk] = useState<string | null>(null)
  const num = (k: 'ackWindowSeconds' | 'maxOpenLeads' | 'idleSeconds') => (v: string) => setR(s => ({ ...s, [k]: Number(v) }))
  const setLevel = (i: number, patch: Partial<Level>) => setR(s => ({ ...s, escalationLevels: s.escalationLevels.map((l, j) => j === i ? { ...l, ...patch } : l) }))

  return (
    <form className="flex max-w-2xl flex-col gap-4" noValidate onSubmit={async e => {
      e.preventDefault(); setOk(null)
      const res = await run('/api/rules', r, 'PUT')
      if (res.ok) setOk('Rules saved. New assignments use them immediately.')
    }}>
      <Alert error={error} success={ok} />
      <div className="grid gap-3 sm:grid-cols-3">
        <FieldInput id="ack" label="Acknowledgement window (seconds)" type="number" required value={String(r.ackWindowSeconds)} onChange={num('ackWindowSeconds')} error={fields.ackWindowSeconds} />
        <FieldInput id="max" label="Max open leads per person" type="number" required value={String(r.maxOpenLeads)} onChange={num('maxOpenLeads')} error={fields.maxOpenLeads} />
        <FieldInput id="idle" label="Idle after (seconds)" type="number" required value={String(r.idleSeconds)} onChange={num('idleSeconds')} error={fields.idleSeconds} />
      </div>

      <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <legend className="px-1 font-semibold text-foreground">Escalation chain</legend>
        {r.escalationLevels.map((l, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`lt-${i}`} className="text-sm text-foreground">Level {i + 1} goes to</label>
              <select id={`lt-${i}`} value={l.type} onChange={e => setLevel(i, { type: e.target.value as Level['type'] })} className="h-10 rounded-md border border-input bg-background px-2 text-base text-foreground">
                {Object.entries(TYPE_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`ls-${i}`} className="text-sm text-foreground">Seconds to acknowledge</label>
              <input id={`ls-${i}`} type="number" min={5} value={l.seconds} onChange={e => setLevel(i, { seconds: Number(e.target.value) })} className="h-10 w-28 rounded-md border border-input bg-background px-2 text-base text-foreground" />
            </div>
            <Button type="button" variant="outline" disabled={r.escalationLevels.length === 1}
              onClick={() => setR(s => ({ ...s, escalationLevels: s.escalationLevels.filter((_, j) => j !== i) }))}>Remove</Button>
          </div>
        ))}
        <div><Button type="button" variant="outline" onClick={() => setR(s => ({ ...s, escalationLevels: [...s.escalationLevels, { type: 'manager', seconds: s.ackWindowSeconds }] }))}>+ Add level</Button></div>
        {fields.escalationLevels && <p className="text-sm text-destructive">Error: {fields.escalationLevels}</p>}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="backup" className="text-sm font-medium text-foreground">Backup person</label>
          <select id="backup" value={r.backupUserId ?? ''} onChange={e => setR(s => ({ ...s, backupUserId: e.target.value || null }))} className="h-10 rounded-md border border-input bg-background px-2 text-base text-foreground">
            <option value="">None</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="mgr" className="text-sm font-medium text-foreground">Manager role</label>
          <select id="mgr" value={r.managerRoleId ?? ''} onChange={e => setR(s => ({ ...s, managerRoleId: e.target.value || null }))} className="h-10 rounded-md border border-input bg-background px-2 text-base text-foreground">
            <option value="">None</option>{roles.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
      </div>
      <div><Button type="submit" disabled={loading} aria-busy={loading}>{loading ? 'Saving…' : 'Save rules'}</Button></div>
    </form>
  )
}
