import { NotificationList } from '@/components/chat/notification-list'
import { PageTitle } from '@/components/ui-bits'
import { getCtxOrNull } from '@/lib/session'
import { listNotifications } from '@/services/inbox'

export default async function NotificationsPage() {
  const ctx = (await getCtxOrNull())!
  const rows = await listNotifications(ctx)
  return (
    <>
      <PageTitle title="Notifications" />
      <NotificationList rows={rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, leadId: r.lead_id, conversationId: r.conversation_id, read: !!r.read_at, at: r.created_at.toISOString() }))} />
    </>
  )
}
