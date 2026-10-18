"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, FieldInput } from '@/components/field-input'
import { useAction } from '@/components/use-action'

type Role = { id: string; name: string; keys: string[]; members: number }

export function RolesMatrix({ roles, keys }: { roles: Role[]; keys: { key: string; label: string }[] }) {
  const { run, loading, error, fields } = useAction()
  const [state, setState] = useState(() => Object.fromEntries(roles.map(r => [r.id, r.keys])))
  const [name, setName] = useState('')
  const [ok, setOk] = useState<string | null>(null)

  async function toggle(role: Role, key: string, on: boolean) {
    setOk(null)
    const prev = state[role.id] ?? []
    const next = on ? [...prev, key] : prev.filter(k => k !== key)
    setState(s => ({ ...s, [role.id]: next }))
    const r = await run(`/api/roles/${role.id}`, { keys: next }, 'PUT')
    if (!r.ok) setState(s => ({ ...s, [role.id]: prev }))
    else setOk(`${role.name}: saved.`)
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert error={error} success={ok} />
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[480px] text-sm">
          <caption className="sr-only">Permissions per role</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="p-2 text-left font-medium">Permission</th>
              {roles.map(r => <th key={r.id} scope="col" className="p-2 text-left font-medium">{r.name} <span className="font-normal text-muted-foreground">({r.members})</span></th>)}
            </tr>
          </thead>
          <tbody>
            {keys.map(k => (
              <tr key={k.key} className="border-b border-border last:border-0">
                <th scope="row" className="p-2 text-left font-normal">{k.label} <span className="text-xs text-muted-foreground">{k.key}</span></th>
                {roles.map(r => (
                  <td key={r.id} className="p-2">
                    <input type="checkbox" className="size-5" disabled={loading} aria-label={`${r.name}: ${k.label}`}
                      checked={(state[r.id] ?? []).includes(k.key)} onChange={e => toggle(r, k.key, e.target.checked)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="flex flex-wrap items-end gap-2" noValidate onSubmit={async e => {
        e.preventDefault(); setOk(null)
        const r = await run('/api/roles', { name, keys: [] })
        if (r.ok) { setName(''); setOk('Role created. Reload to see it in the table.'); location.reload() }
      }}>
        <div className="w-64"><FieldInput id="role-name" label="New role name" required value={name} onChange={setName} error={fields.name} /></div>
        <Button type="submit" disabled={loading || !name}>Create role</Button>
      </form>
    </div>
  )
}
