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
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
      <span aria-hidden className={`inline-block size-2 rounded-full ${live ? 'bg-green-600' : 'bg-amber-500'}`} />
      {live ? 'Live' : 'Reconnecting…'}
    </span>
  )
}
