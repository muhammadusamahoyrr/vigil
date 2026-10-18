"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/field-input'
import { useAction } from '@/components/use-action'

export function ManageMember({ user, roles }: { user: { id: string; name: string; level: string; roleIds: string[] }; roles: { id: string; name: string }[] }) {
  const save = useAction(), deact = useAction()
  const [level, setLevel] = useState(user.level)
  const [roleIds, setRoleIds] = useState(user.roleIds)
  const [ok, setOk] = useState<string | null>(null)
  return (
    <details className="rounded-md border border-border p-2 text-sm">
      <summary className="cursor-pointer">Manage {user.name}</summary>
      <form className="mt-2 flex flex-col gap-2" onSubmit={async e => {
        e.preventDefault(); setOk(null)
        const r = await save.run(`/api/users/${user.id}`, { level, roleIds }, 'PATCH')
        if (r.ok) setOk('Saved. Applies on their next click.')
      }}>
        <Alert error={save.error ?? deact.error} success={ok} />
        <label htmlFor={`lvl-${user.id}`} className="font-medium">Level</label>
        <select id={`lvl-${user.id}`} value={level} onChange={e => setLevel(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2">
          <option value="user">User</option><option value="admin">Admin</option>
        </select>
        <fieldset className="flex flex-col gap-1"><legend className="font-medium">Roles</legend>
          {roles.map(r => (
            <label key={r.id} className="flex items-center gap-2">
              <input type="checkbox" checked={roleIds.includes(r.id)} onChange={e => setRoleIds(s => e.target.checked ? [...s, r.id] : s.filter(x => x !== r.id))} />
              {r.name}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={save.loading}>{save.loading ? 'Saving…' : 'Save'}</Button>
          <Button type="button" size="sm" variant="outline" disabled={deact.loading} onClick={async () => {
            if (!confirm(`Deactivate ${user.name}? Their unacknowledged leads move to others and they are logged out.`)) return
            const r = await deact.run(`/api/users/${user.id}/deactivate`)
            if (r.ok) setOk('Deactivated.')
          }}>{deact.loading ? 'Deactivating…' : 'Deactivate'}</Button>
        </div>
      </form>
    </details>
  )
}
