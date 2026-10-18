"use client"

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function LogoutButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function logout() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })
      if (!res.ok) throw new Error()
      router.replace('/login')
      router.refresh()
    } catch {
      setError('Could not log out. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={logout} disabled={loading} aria-busy={loading}
        className="flex h-9 items-center justify-center gap-2 rounded-md border border-border text-sm font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
        <LogOut className="size-4" aria-hidden /> {loading ? 'Logging out…' : 'Log out'}
      </button>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
