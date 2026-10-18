"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  Bell, CircleUser, Contact, Inbox, LayoutDashboard, LifeBuoy, Menu, Plug, ScrollText, Shield,
  ShieldCheck, SlidersHorizontal, SquareKanban, Target, Users, X,
} from 'lucide-react'
import { LogoutButton } from '@/components/auth/logout-button'
import { AvailabilityControl } from '@/components/availability-control'
import { LiveRefresh } from '@/components/live-refresh'

const ICONS = { dashboard: LayoutDashboard, inbox: Inbox, bell: Bell, leads: Target, recovery: LifeBuoy, contacts: Contact,
  pipeline: SquareKanban, team: Users, roles: ShieldCheck, audit: ScrollText, rules: SlidersHorizontal, plug: Plug, profile: CircleUser }
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number }
export type NavGroup = { title: string; items: NavItem[] }
type User = { id: string; name: string; workspace: string; level: string; availability: string }

function Nav({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const path = usePathname()
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {groups.map(g => (
        <div key={g.title}>
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.title}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map(it => {
              const Icon = ICONS[it.icon]
              const active = path === it.href || (it.href !== '/dashboard' && path.startsWith(it.href + '/')) || path === it.href.split('?')[0]
              return (
                <li key={it.href}>
                  <Link href={it.href} onClick={onNavigate} aria-current={active ? 'page' : undefined}
                    className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                      active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}>
                    <Icon className={`size-4 shrink-0 ${active ? 'text-white' : 'text-slate-400 group-hover:text-white'}`} aria-hidden />
                    <span className="flex-1">{it.label}</span>
                    {!!it.badge && (
                      <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold ${active ? 'bg-white text-indigo-700' : 'bg-rose-500 text-white'}`}>
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

function SidebarContent({ groups, user, onNavigate }: { groups: NavGroup[]; user: User; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2.5 px-3">
        <span className="grid size-8 place-items-center rounded-lg bg-indigo-600 text-white shadow"><Shield className="size-4" aria-hidden /></span>
        <span className="text-lg font-semibold tracking-tight text-white">Vigil</span>
      </Link>
      <div className="flex-1"><Nav groups={groups} onNavigate={onNavigate} /></div>
      <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-indigo-500/20 text-sm font-semibold text-indigo-200" aria-hidden>
            {user.name.split(' ').map(p => p[0]).slice(0, 2).join('')}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{user.name}</p>
            <p className="truncate text-xs text-slate-400"><span className="capitalize">{user.level}</span> · {user.workspace}</p>
          </div>
        </div>
        <AvailabilityControl userId={user.id} current={user.availability} tone="dark" />
        <LogoutButton tone="dark" />
      </div>
    </div>
  )
}

export function AppShell({ groups, user, demo, unreadNotifications, children }:
  { groups: NavGroup[]; user: User; demo: boolean; unreadNotifications: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const path = usePathname()
  useEffect(() => setOpen(false), [path])
  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-slate-950 lg:block">
        <SidebarContent groups={groups} user={user} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-slate-950/60" onClick={() => setOpen(false)} aria-label="Close menu" />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-slate-950 shadow-xl">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-4 rounded-md p-1 text-slate-300 hover:text-white" aria-label="Close menu">
              <X className="size-5" />
            </button>
            <SidebarContent groups={groups} user={user} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        {demo && <p className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-950" role="note">Demo mode: short acknowledgement and escalation timers for a live presentation.</p>}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur sm:px-6 lg:px-8">
          <button type="button" onClick={() => setOpen(true)} className="-ml-1 rounded-md p-1.5 text-slate-700 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <span className="font-semibold text-slate-900 lg:hidden">Vigil</span>
          <span className="hidden text-sm text-slate-500 lg:inline">{user.workspace}</span>
          <div className="ml-auto flex items-center gap-4">
            <LiveRefresh />
            <Link href="/notifications" className="relative rounded-full p-1.5 text-slate-600 hover:bg-slate-100" aria-label={`Notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ''}`}>
              <Bell className="size-5" />
              {unreadNotifications > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">{unreadNotifications}</span>}
            </Link>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  )
}
