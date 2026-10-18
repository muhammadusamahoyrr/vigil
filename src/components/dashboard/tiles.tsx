"use client"

import Link from 'next/link'
import { useState } from 'react'
import { Activity, CalendarClock, EyeOff, LifeBuoy, Timer, TrendingUp, TriangleAlert, Users, Wallet, Zap } from 'lucide-react'
import { useAction } from '@/components/use-action'

const ICON = { newLeads: Zap, recovery: LifeBuoy, escalations: TriangleAlert, firstResponse: Timer, availability: Users,
  pipeline: TrendingUp, appointments: CalendarClock, payments: Wallet }
const TINT: Record<string, string> = {
  newLeads: 'bg-indigo-50 text-indigo-600', recovery: 'bg-rose-50 text-rose-600', escalations: 'bg-amber-50 text-amber-600',
  firstResponse: 'bg-sky-50 text-sky-600', availability: 'bg-emerald-50 text-emerald-600', pipeline: 'bg-violet-50 text-violet-600',
  appointments: 'bg-teal-50 text-teal-600', payments: 'bg-lime-50 text-lime-700',
}

export type Tile = { id: string; title: string; value: string; href?: string; hint?: string; detail?: string[] }

export function Tiles({ tiles, hidden: initial }: { tiles: Tile[]; hidden: string[] }) {
  const [hidden, setHidden] = useState(initial)
  const { run, error } = useAction()
  const save = async (next: string[]) => { setHidden(next); await run('/api/me/preferences', { hiddenTiles: next }) }
  const visible = tiles.filter(t => !hidden.includes(t.id))
  const off = tiles.filter(t => hidden.includes(t.id))
  return (
    <div className="flex flex-col gap-4">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map(t => {
          const Icon = ICON[t.id as keyof typeof ICON] ?? Activity
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className={`grid size-9 place-items-center rounded-lg ${TINT[t.id] ?? 'bg-slate-100 text-slate-600'}`}><Icon className="size-4.5" aria-hidden /></span>
              </div>
              <h2 id={`t-${t.id}`} className="mt-3 text-sm font-medium text-slate-500">{t.title}</h2>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{t.value}</p>
              {t.detail && t.detail.length > 0 && <ul className="mt-2 flex flex-col gap-0.5 text-xs text-slate-500">{t.detail.map(x => <li key={x}>{x}</li>)}</ul>}
              {t.hint && <p className="mt-2 text-xs leading-relaxed text-slate-500">{t.hint}</p>}
            </>
          )
          return (
            <section key={t.id} aria-labelledby={`t-${t.id}`} className="group relative rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
              <button type="button" onClick={() => save([...hidden, t.id])} aria-label={`Hide ${t.title}`}
                className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-slate-400 opacity-60 hover:bg-slate-100 hover:text-slate-700 focus-visible:opacity-100 group-hover:opacity-100">
                <EyeOff className="size-4" />
              </button>
              {t.href
                ? <Link href={t.href} className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">{body}<span className="mt-3 inline-block text-xs font-medium text-indigo-600">View records →</span></Link>
                : body}
            </section>
          )
        })}
      </div>
      {off.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span>Hidden tiles:</span>
          {off.map(t => <button key={t.id} type="button" onClick={() => save(hidden.filter(h => h !== t.id))} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium hover:bg-slate-50">+ {t.title}</button>)}
        </div>
      )}
    </div>
  )
}
