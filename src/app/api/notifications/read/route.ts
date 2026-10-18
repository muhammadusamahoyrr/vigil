import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { markNotificationsRead, markReadSchema } from '@/services/inbox'

export const POST = route(async req => {
  const ctx = await getCtx(req)
  return NextResponse.json(await markNotificationsRead(ctx, markReadSchema.parse(await readJson(req))))
})
