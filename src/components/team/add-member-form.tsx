"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, FieldInput } from '@/components/field-input'
import { useAction } from '@/components/use-action'

export function AddMemberForm({ roles }: { roles: { id: string; name: string }[] }) {
  const { run, loading, error, fields } = useAction()
  const [f, setF] = useState({ name: '', email: '', password: '', level: 'user', roleId: roles.find(r => r.name === 'Sales')?.id ?? '' })
  const [ok, setOk] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (v: string) => setF(s => ({ ...s, [k]: v }))

  return (
    <details className="rounded-lg border border-border p-4">
      <summary className="cursor-pointer font-semibold text-foreground">+ Add team member</summary>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" noValidate onSubmit={async e => {
        e.preventDefault(); setOk(null)
        const r = await run('/api/team', f)
        if (r.ok) { setOk(`${f.name} added. They can log in with the temporary password.`); setF(s => ({ ...s, name: '', email: '', password: '' })) }
      }}>
        <div className="sm:col-span-2"><Alert error={error} success={ok} /></div>
        <FieldInput id="m-name" label="Name" required value={f.name} onChange={set('name')} error={fields.name} />
        <FieldInput id="m-email" label="Email" type="email" required value={f.email} onChange={set('email')} error={fields.email} />
        <FieldInput id="m-password" label="Temporary password" type="password" required value={f.password} onChange={set('password')} error={fields.password} hint="At least 10 characters." autoComplete="new-password" />
        <div className="flex flex-col gap-1">
          <label htmlFor="m-level" className="text-sm font-medium text-foreground">Level</label>
          <select id="m-level" value={f.level} onChange={e => set('level')(e.target.value)} className="h-10 rounded-md border border-input bg-background px-2 text-base text-foreground">
            <option value="user">User</option><option value="admin">Admin</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="m-role" className="text-sm font-medium text-foreground">Role</label>
          <select id="m-role" value={f.roleId} onChange={e => set('roleId')(e.target.value)} className="h-10 rounded-md border border-input bg-background px-2 text-base text-foreground">
            <option value="">No role</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2"><Button type="submit" disabled={loading} aria-busy={loading}>{loading ? 'Adding…' : 'Add member'}</Button></div>
      </form>
    </details>
  )
}
