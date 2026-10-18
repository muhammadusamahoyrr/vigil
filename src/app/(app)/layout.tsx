import { redirect } from 'next/navigation'
import { AppShell, type NavGroup } from '@/components/app-shell/app-shell'
import { hasPermission } from '@/lib/rbac'
import { getCtxOrNull } from '@/lib/session'
import { getMe } from '@/services/auth'
import { unreadConversations, unreadNotifications } from '@/services/inbox'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtxOrNull()
  if (!ctx) redirect('/login')
  const [me, unreadChats, unreadNotes] = await Promise.all([getMe(ctx), unreadConversations(ctx), unreadNotifications(ctx)])
  const admin: NavGroup['items'] = [
    { href: '/team', label: 'Team', icon: 'team' },
    ...(hasPermission(ctx, 'users.manage') ? [{ href: '/settings/roles', label: 'Roles', icon: 'roles' as const }] : []),
    ...(hasPermission(ctx, 'audit.view') ? [{ href: '/audit', label: 'Audit log', icon: 'audit' as const }] : []),
    ...(hasPermission(ctx, 'assignment_rules.manage') ? [{ href: '/settings/rules', label: 'Assignment rules', icon: 'rules' as const }] : []),
    ...(hasPermission(ctx, 'integrations.manage') ? [{ href: '/settings/integrations', label: 'Integrations', icon: 'plug' as const }] : []),
    { href: '/profile', label: 'Profile', icon: 'profile' },
  ]
  const groups: NavGroup[] = [
    { title: 'Workspace', items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
      { href: '/inbox', label: 'Inbox', icon: 'inbox', badge: unreadChats },
      { href: '/notifications', label: 'Notifications', icon: 'bell', badge: unreadNotes },
    ] },
    { title: 'Leads', items: [
      { href: '/leads', label: 'Leads', icon: 'leads' },
      { href: '/recovery', label: 'Recovery queue', icon: 'recovery' },
    ] },
    { title: 'CRM', items: [
      { href: '/contacts', label: 'Contacts', icon: 'contacts' },
      { href: '/pipeline', label: 'Pipeline', icon: 'pipeline' },
    ] },
    { title: 'Settings', items: admin },
  ]
  return (
    <AppShell groups={groups} demo={process.env.DEMO_MODE === 'true'} unreadNotifications={unreadNotes}
      user={{ id: me.userId!, name: me.name, workspace: me.workspaceName, level: me.level, availability: me.availability }}>
      {children}
    </AppShell>
  )
}
