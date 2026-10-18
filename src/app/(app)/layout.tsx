import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LogoutButton } from '@/components/auth/logout-button'
import { AvailabilityControl } from '@/components/availability-control'
import { LiveRefresh } from '@/components/live-refresh'
import { hasPermission } from '@/lib/rbac'
import { getCtxOrNull } from '@/lib/session'
import { getMe } from '@/services/auth'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtxOrNull()
  if (!ctx) redirect('/login')
  const me = await getMe(ctx)
  const nav = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/leads', label: 'Leads' },
    { href: '/recovery', label: 'Recovery' },
    { href: '/contacts', label: 'Contacts' },
    { href: '/pipeline', label: 'Pipeline' },
    { href: '/team', label: 'Team' },
    ...(hasPermission(ctx, 'users.manage') ? [{ href: '/settings/roles', label: 'Roles' }] : []),
    ...(hasPermission(ctx, 'audit.view') ? [{ href: '/audit', label: 'Audit log' }] : []),
    ...(hasPermission(ctx, 'assignment_rules.manage') ? [{ href: '/settings/rules', label: 'Assignment rules' }] : []),
    ...(hasPermission(ctx, 'integrations.manage') ? [{ href: '/settings/integrations', label: 'Integrations' }] : []),
    { href: '/profile', label: 'Profile' },
  ]
  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-start justify-between gap-4 px-4 py-3">
          <div className="flex flex-col gap-1">
            <Link href="/dashboard" className="text-xl font-semibold text-foreground">Vigil</Link>
            <span className="text-xs text-muted-foreground">{me.name} · {me.workspaceName} · <span className="capitalize">{me.level}</span></span>
            <LiveRefresh />
          </div>
          <AvailabilityControl userId={me.userId!} current={me.availability} />
          <LogoutButton />
        </div>
        <nav aria-label="Main" className="mx-auto w-full max-w-6xl overflow-x-auto px-4 pb-2">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {nav.map(n => (
              <li key={n.href}><Link href={n.href} className="underline-offset-4 hover:underline focus-visible:underline">{n.label}</Link></li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">{children}</main>
    </div>
  )
}
