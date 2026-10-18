"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  Bell, ChevronsUpDown, CircleUser, Contact, Inbox, LayoutDashboard, LifeBuoy, Menu, Plug, ScrollText, ShieldCheck,
  SlidersHorizontal, SquareKanban, Target, Users, X, Zap,
} from 'lucide-react'
import { LogoutButton } from '@/components/auth/logout-button'
import { AvailabilityControl } from '@/components/availability-control'
import { LiveRefresh } from '@/components/live-refresh'

const ICONS = { dashboard: LayoutDashboard, inbox: Inbox, bell: Bell, leads: Target, recovery: LifeBuoy, contacts: Contact,
  pipeline: SquareKanban, team: Users, roles: ShieldCheck, audit: ScrollText, rules: SlidersHorizontal, plug: Plug, profile: CircleUser }
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number }
export type NavGroup = { title: string; items: NavItem[] }
type User = { id: string; name: string; workspace: string; level: string; availability: string }

export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className={`grid place-items-center rounded-lg bg-foreground text-background ${size === 'lg' ? 'size-9' : 'size-8'}`}>
        <Zap className="size-4" aria-hidden fill="currentColor" />
      </span>
      <span className={`font-semibold tracking-tight ${size === 'lg' ? 'text-xl' : 'text-[15px]'}`}>Vigil</span>
    </span>
  )
}

const isActive = (path: string, href: string) => path === href || (href !== '/dashboard' && path.startsWith(href + '/'))

function Nav({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const path = usePathname()
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {groups.map(g => (
        <div key={g.title}>
          <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">{g.title}</p>
          <ul className="flex flex-col gap-px">
            {g.items.map(it => {
              const Icon = ICONS[it.icon]
              const active = isActive(path, it.href)
              return (
                <li key={it.href}>
                  <Link href={it.href} onClick={onNavigate} aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                      active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}`}>
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1">{it.label}</span>
                    {!!it.badge && (
                      <span className="grid min-w-5 place-items-center rounded-full bg-foreground px-1.5 text-[11px] font-semibold leading-5 text-background">
                        {it.badge}<span className="sr-only"> unread</span>
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

const STATUS: Record<string, { label: string; dot: string }> = {
  available: { label: 'Available', dot: 'bg-emerald-400' }, busy: { label: 'Busy', dot: 'bg-amber-400' },
  on_leave: { label: 'On leave', dot: 'bg-rose-400' }, offline: { label: 'Offline', dot: 'bg-zinc-500' },
}

/** Compact account button; availability, profile and logout open in a menu above it. */
function AccountMenu({ user, onNavigate }: { user: User; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  const st = STATUS[user.availability] ?? STATUS.offline
  return (
    <div ref={ref} className="relative border-t border-border p-2.5">
      {open && (
        <div id="account-menu" role="dialog" aria-label="Account" className="absolute inset-x-2.5 bottom-full mb-2 flex flex-col gap-3 rounded-xl border border-border bg-popover p-3 shadow-2xl">
          <AvailabilityControl userId={user.id} current={user.availability} />
          <Link href="/profile" onClick={() => { setOpen(false); onNavigate?.() }}
            className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
            <CircleUser className="size-4" aria-hidden /> Profile & Slack alerts
          </Link>
          <LogoutButton />
        </div>
      )}
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="account-menu"
        className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        <span className="relative grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold" aria-hidden>
          {user.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
          <span className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-sidebar ${st.dot}`} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{user.name}</span>
          <span className="block truncate text-xs text-muted-foreground"><span className="capitalize">{user.level}</span> · {st.label}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </div>
  )
}

function SidebarContent({ groups, user, onNavigate }: { groups: NavGroup[]; user: User; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pb-4 pt-5">
        <Link href="/dashboard" onClick={onNavigate} className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo />
          <span className="mt-1 block truncate pl-[42px] text-xs text-muted-foreground">{user.workspace}</span>
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 pb-4"><Nav groups={groups} onNavigate={onNavigate} /></div>
      <AccountMenu user={user} onNavigate={onNavigate} />
    </div>
  )
}

const TITLES: [string, string, string][] = [
  ['/dashboard', 'Workspace', 'Dashboard'], ['/inbox', 'Workspace', 'Inbox'], ['/notifications', 'Workspace', 'Notifications'],
  ['/leads', 'Operations', 'Leads'], ['/recovery', 'Operations', 'Recovery queue'], ['/contacts', 'Customers', 'Contacts'],
  ['/pipeline', 'Customers', 'Pipeline'], ['/team', 'Administration', 'Team'], ['/settings/roles', 'Administration', 'Roles'],
  ['/audit', 'Administration', 'Audit log'], ['/settings/rules', 'Administration', 'Assignment rules'],
  ['/settings/integrations', 'Administration', 'Integrations'], ['/profile', 'Account', 'Profile'],
]

export function AppShell({ groups, user, unreadNotifications, children }:
  { groups: NavGroup[]; user: User; unreadNotifications: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const path = usePathname()
  useEffect(() => setOpen(false), [path])
  const crumb = TITLES.find(([p]) => isActive(path, p)) ?? ['Workspace', 'Vigil']
  const [section, page] = crumb.length === 3 ? [crumb[1], crumb[2]] : crumb
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-sidebar lg:block">
        <SidebarContent groups={groups} user={user} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} aria-label="Close menu" />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] border-r border-border bg-sidebar shadow-2xl">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-4 rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label="Close menu">
              <X className="size-5" />
            </button>
            <SidebarContent groups={groups} user={user} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <button type="button" onClick={() => setOpen(true)} className="-ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <p className="text-sm text-muted-foreground"><span className="hidden sm:inline">{section} / </span><span className="font-medium text-foreground">{page}</span></p>
          <div className="ml-auto flex items-center gap-2.5">
            <LiveRefresh />
            <Link href="/notifications" className="relative grid size-9 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={`Notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ''}`}>
              <Bell className="size-4" />
              {unreadNotifications > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-foreground ring-2 ring-background" aria-hidden />}
            </Link>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  )
}
