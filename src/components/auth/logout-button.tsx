"use client"

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function LogoutButton({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dark = tone === 'dark'

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
        className={`flex h-9 items-center justify-center gap-2 rounded-lg text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-60 ${
          dark ? 'border border-white/10 text-slate-200 hover:bg-white/10' : 'border border-slate-300 text-slate-800 hover:bg-slate-100'}`}>
        <LogOut className="size-4" aria-hidden /> {loading ? 'Logging out…' : 'Log out'}
      </button>
      {error && <p role="alert" className={`text-xs ${dark ? 'text-rose-300' : 'text-destructive'}`}>{error}</p>}
    </div>
  )
}
