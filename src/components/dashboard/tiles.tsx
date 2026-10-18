"use client"

import Link from 'next/link'
import { useState } from 'react'
import { ArrowUpRight, CalendarClock, EyeOff, LifeBuoy, Timer, TrendingUp, TriangleAlert, Users, Wallet, Zap } from 'lucide-react'
import { useAction } from '@/components/use-action'

const ICON = { newLeads: Zap, recovery: LifeBuoy, escalations: TriangleAlert, firstResponse: Timer, availability: Users,
  pipeline: TrendingUp, appointments: CalendarClock, payments: Wallet }

export type Tile = { id: string; title: string; value: string; href?: string; hint?: string; detail?: string[] }

export function Tiles({ tiles, hidden: initial }: { tiles: Tile[]; hidden: string[] }) {
  const [hidden, setHidden] = useState(initial)
  const { run, error } = useAction()
  const save = async (next: string[]) => { setHidden(next); await run('/api/me/preferences', { hiddenTiles: next }) }
  const visible = tiles.filter(t => !hidden.includes(t.id))
  const off = tiles.filter(t => hidden.includes(t.id))
  return (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-2 xl:grid-cols-4">
        {visible.map(t => {
          const Icon = ICON[t.id as keyof typeof ICON] ?? Zap
          return (
            <section key={t.id} aria-labelledby={`t-${t.id}`} className="group relative border-b border-border p-5 sm:border-r [&:nth-child(2n)]:sm:border-r-0 xl:[&:nth-child(2n)]:border-r xl:[&:nth-child(4n)]:border-r-0">
              <div className="flex items-center justify-between gap-2">
                <h2 id={`t-${t.id}`} className="flex items-center gap-2 text-[13px] text-muted-foreground"><Icon className="size-3.5" aria-hidden />{t.title}</h2>
                <button type="button" onClick={() => save([...hidden, t.id])} aria-label={`Hide ${t.title}`}
                  className="rounded p-1 text-muted-foreground/60 opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100">
                  <EyeOff className="size-3.5" />
                </button>
              </div>
              {t.href
                ? <Link href={t.href} className="mt-3 flex items-baseline gap-1.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="text-[28px] font-semibold leading-none tracking-tight">{t.value}</span>
                    <ArrowUpRight className="size-4 text-muted-foreground" aria-label="Open records" />
                  </Link>
                : <p className="mt-3 text-[28px] font-semibold leading-none tracking-tight">{t.value}</p>}
              {t.detail && t.detail.length > 0 && <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">{t.detail.map(x => <li key={x}>{x}</li>)}</ul>}
              {t.hint && <p className="mt-2 text-xs text-muted-foreground">{t.hint}</p>}
            </section>
          )
        })}
      </div>
      {off.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Hidden:</span>
          {off.map(t => <button key={t.id} type="button" onClick={() => save(hidden.filter(h => h !== t.id))} className="rounded-md border border-border px-2 py-1 hover:text-foreground">+ {t.title}</button>)}
        </div>
      )}
    </div>
  )
}
