import { SlackConnectForm } from '@/components/settings/slack-connect-form'
import { Badge, Card, PageTitle, fmt } from '@/components/ui-bits'
import { requirePermission } from '@/lib/rbac'
import { getCtxOrNull } from '@/lib/session'
import { slackStatus } from '@/services/slack'

export default async function IntegrationsPage() {
  const ctx = (await getCtxOrNull())!
  requirePermission(ctx, 'integrations.manage')
  const s = await slackStatus(ctx)
  const formUrl = await import('@/services/workspace').then(m => m.publicFormUrl(ctx))
  return (
    <>
      <PageTitle title="Integrations" />
      <Card title="Slack (escalation alerts)">
        <div className="flex flex-col gap-2 text-sm text-foreground">
          <p>Status: <Badge tone={s.connected ? 'good' : s.status === 'error' ? 'bad' : 'warn'}>{s.status.replace('_', ' ')}</Badge>
            {s.team ? ` · workspace "${s.team}"` : ''}{s.maskedToken ? ` · token ${s.maskedToken}` : ''}</p>
          <p>Last worked: {fmt(s.lastOkAt)}</p>
          {s.lastError && <p className="text-destructive">Last error: {s.lastError}</p>}
          <p className="text-muted-foreground">
            Can: send each employee a direct message when a lead is assigned or escalated to them.
            Cannot: reach people who have not joined the Slack workspace or not set their Slack email in Profile.
          </p>
          <SlackConnectForm connected={s.connected} />
        </div>
      </Card>
      <Card title="Failed alerts">
        {s.failed.length === 0 ? <p className="text-sm text-foreground">No failed alerts.</p> : (
          <ul className="flex flex-col gap-2 text-sm text-foreground">
            {s.failed.map(f => <li key={f.id}>{fmt(f.created_at)} · to {f.recipient ?? 'unknown'} · {f.attempts} attempt(s) · {f.last_error}</li>)}
          </ul>
        )}
      </Card>
      <Card title="Slack sync history">
        <ul className="flex flex-col gap-1 text-sm text-foreground">
          {s.events.map((e, i) => <li key={i}>{fmt(e.created_at)} · {e.event_type} · {e.status}{e.error ? ` · ${e.error}` : ''}</li>)}
          {s.events.length === 0 && <li>No calls yet.</li>}
        </ul>
      </Card>
      <Card title="Public web form">
        <p className="text-sm text-foreground">Share this link; each submission becomes a lead with source &quot;Web form&quot;.</p>
        <p className="mt-2 break-all font-mono text-sm text-foreground">{formUrl}</p>
      </Card>
    </>
  )
}
