import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/session'
import { signup, signupSchema } from '@/services/auth'

export const POST = route(async req => {
  const input = signupSchema.parse(await readJson(req))
  const s = await signup(input)
  const res = NextResponse.json({ ok: true, userId: s.userId, workspaceId: s.workspaceId }, { status: 201 })
  res.cookies.set(SESSION_COOKIE, s.token, sessionCookieOptions(s.expiresAt))
  return res
})
