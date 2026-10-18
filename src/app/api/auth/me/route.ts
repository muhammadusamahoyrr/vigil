import { NextResponse } from 'next/server'
import { route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { getMe } from '@/services/auth'

export const GET = route(async req => {
  const ctx = await getCtx(req)
  return NextResponse.json(await getMe(ctx))
})
