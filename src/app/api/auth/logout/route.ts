import { NextResponse } from 'next/server'
import { route } from '@/lib/api'
import { SESSION_COOKIE, clearedCookieOptions, readSessionToken } from '@/lib/session'
import { logout } from '@/services/auth'

export const POST = route(async req => {
  await logout(await readSessionToken(req))
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', clearedCookieOptions())
  return res
})
