"use client"

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

/** Subscribes to /api/stream; refetches server data on every event and on reconnect (Q11). */
export function LiveRefresh() {
  const router = useRouter()
  const [live, setLive] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => router.refresh(), 250) }
    const es = new EventSource('/api/stream')
    es.onopen = () => { setLive(true); refresh() }
    es.onmessage = refresh
    es.onerror = () => setLive(false)
    return () => { clearTimeout(timer); es.close() }
  }, [router])
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium text-muted-foreground" aria-live="polite">
      <span aria-hidden className="relative flex size-2">
        {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
        <span className={`relative inline-flex size-2 rounded-full ${live ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      </span>
      {live ? 'Live' : 'Reconnecting…'}
    </span>
  )
}
