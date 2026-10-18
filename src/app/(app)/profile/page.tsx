import { SlackEmailForm } from '@/components/settings/slack-email-form'
import { Badge, Card, PageTitle } from '@/components/ui-bits'
import { getCtxOrNull } from '@/lib/session'
import { mySlack } from '@/services/slack'

export default async function ProfilePage() {
  const ctx = (await getCtxOrNull())!
  const s = await mySlack(ctx)
  return (
    <>
      <PageTitle title="Profile" />
      <Card title="Slack alerts">
        <p className="mb-3 text-sm text-foreground">
          Status: <Badge tone={s.slack_user_id ? 'good' : 'warn'}>{s.slack_user_id ? `Linked (${s.slack_email})` : 'Not linked'}</Badge>
        </p>
        <p className="mb-3 text-sm text-muted-foreground">
          Join the company Slack workspace, then enter the email of your Slack account. When a lead is assigned or escalated to you, you get a Slack direct message.
        </p>
        <SlackEmailForm current={s.slack_email ?? ''} />
      </Card>
    </>
  )
}
