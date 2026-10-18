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
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${live ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`} aria-live="polite">
      <span aria-hidden className="relative flex size-2">
        {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
        <span className={`relative inline-flex size-2 rounded-full ${live ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      </span>
      {live ? 'Live' : 'Reconnecting…'}
    </span>
  )
}
