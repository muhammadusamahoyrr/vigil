"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, FieldInput } from '@/components/field-input'
import { useAction } from '@/components/use-action'

export function SlackEmailForm({ current }: { current: string }) {
  const { run, loading, error, fields } = useAction()
  const [email, setEmail] = useState(current)
  const [ok, setOk] = useState<string | null>(null)
  return (
    <form className="flex max-w-md flex-col gap-2" noValidate onSubmit={async e => {
      e.preventDefault(); setOk(null)
      const r = await run('/api/me/slack', { email })
      if (r.ok) setOk('Linked. Slack alerts will reach you.')
    }}>
      <Alert error={error} success={ok} />
      <FieldInput id="slack-email" label="Slack account email" type="email" required value={email} onChange={setEmail} error={fields.email} autoComplete="email" />
      <div><Button type="submit" disabled={loading} aria-busy={loading}>{loading ? 'Looking you up in Slack…' : 'Link Slack'}</Button></div>
    </form>
  )
}
