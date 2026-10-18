"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, FieldInput } from '@/components/field-input'
import { useAction } from '@/components/use-action'

export function SlackConnectForm({ connected }: { connected: boolean }) {
  const { run, loading, error, fields } = useAction()
  const [token, setToken] = useState('')
  const [ok, setOk] = useState<string | null>(null)
  return (
    <form className="mt-2 flex max-w-xl flex-col gap-2" noValidate onSubmit={async e => {
      e.preventDefault(); setOk(null)
      const r = await run<{ team: string }>('/api/integrations/slack', { botToken: token })
      if (r.ok) { setToken(''); setOk(`Connected to Slack workspace "${r.data.team}".`) }
    }}>
      <Alert error={error} success={ok} />
      <FieldInput id="slack-token" label={connected ? 'Replace bot token' : 'Bot User OAuth Token'} type="password" required
        value={token} onChange={setToken} error={fields.botToken} autoComplete="off" hint="Starts with xoxb-. Stored encrypted; never shown again in full." />
      <div><Button type="submit" disabled={loading || !token} aria-busy={loading}>{loading ? 'Checking with Slack…' : connected ? 'Update token' : 'Connect Slack'}</Button></div>
    </form>
  )
}
