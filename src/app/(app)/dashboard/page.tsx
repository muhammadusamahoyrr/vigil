import { Card, PageTitle, TextLink } from '@/components/ui-bits'
import { getCtxOrNull } from '@/lib/session'
import { listLeads, listRecovery } from '@/services/leads'

export default async function DashboardPage() {
  const ctx = (await getCtxOrNull())!
  const [mine, recovery] = await Promise.all([listLeads(ctx, { mine: true, status: 'open' }), listRecovery(ctx)])
  return (
    <>
      <PageTitle title="Dashboard" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="My open leads">
          <p className="text-3xl font-semibold text-foreground">{mine.leads.length}{mine.hasMore ? '+' : ''}</p>
          <TextLink href="/leads?mine=1">Open my leads</TextLink>
        </Card>
        <Card title="Recovery queue">
          <p className="text-3xl font-semibold text-foreground">{recovery.length}</p>
          <TextLink href="/recovery">Open recovery queue</TextLink>
        </Card>
      </div>
      <p className="text-sm text-muted-foreground">Full dashboard metrics arrive in a later step.</p>
    </>
  )
}
