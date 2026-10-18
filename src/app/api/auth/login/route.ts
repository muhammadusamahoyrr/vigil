import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session'
import { login, loginSchema } from '@/services/auth'

export const POST = route(async req => {
  const input = loginSchema.parse(await readJson(req))
  const s = await login(input)
  const res = NextResponse.json({ ok: true, userId: s.userId, workspaceId: s.workspaceId })
  res.cookies.set(SESSION_COOKIE, s.token, sessionCookieOptions(s.expiresAt))
  return res
})
