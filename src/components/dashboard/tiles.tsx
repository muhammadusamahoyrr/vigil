"use client"

import Link from 'next/link'
import { useState } from 'react'
import { useAction } from '@/components/use-action'

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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {visible.map(t => (
          <section key={t.id} className="flex flex-col gap-1 rounded-lg border border-border p-4" aria-labelledby={`t-${t.id}`}>
            <div className="flex items-start justify-between gap-2">
              <h2 id={`t-${t.id}`} className="text-sm font-medium text-muted-foreground">{t.title}</h2>
              <button type="button" onClick={() => save([...hidden, t.id])} className="text-xs underline underline-offset-2" aria-label={`Hide ${t.title}`}>Hide</button>
            </div>
            {t.href
              ? <Link href={t.href} className="text-2xl font-semibold text-foreground underline-offset-4 hover:underline">{t.value}</Link>
              : <p className="text-2xl font-semibold text-foreground">{t.value}</p>}
            {t.detail && <ul className="text-xs text-muted-foreground">{t.detail.map(x => <li key={x}>{x}</li>)}</ul>}
            {t.hint && <p className="text-xs text-muted-foreground">{t.hint}</p>}
          </section>
        ))}
      </div>
      {off.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">Hidden:
          {off.map(t => <button key={t.id} type="button" onClick={() => save(hidden.filter(h => h !== t.id))} className="rounded-full border border-border px-2 py-0.5 text-xs">Show {t.title}</button>)}
        </p>
      )}
    </div>
  )
}
