"use client"

import { useEffect, useState } from 'react'

/** Remaining acknowledgement time. Display only: the deadline itself lives in the database. */
export function Countdown({ deadline, acknowledgedAt }: { deadline: string | null; acknowledgedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (acknowledgedAt || !deadline) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [deadline, acknowledgedAt])

  if (acknowledgedAt) return <span className="font-medium text-green-800 dark:text-green-400">✓ Acknowledged</span>
  if (!deadline) return <span className="font-medium text-amber-800 dark:text-amber-400">No owner yet</span>
  const s = Math.round((new Date(deadline).getTime() - now) / 1000)
  if (s <= 0) return <span className="font-medium text-red-700 dark:text-red-400">⚠ Overdue {-s}s, escalating</span>
  const m = Math.floor(s / 60)
  return (
    <span className="font-medium tabular-nums text-foreground">
      ⏱ {m > 0 ? `${m}m ` : ''}{s % 60}s left
    </span>
  )
}
