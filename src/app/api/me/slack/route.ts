import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { setMySlackEmail, slackEmailSchema } from '@/services/slack'

export const POST = route(async req => {
  const ctx = await getCtx(req)
  const { email } = slackEmailSchema.parse(await readJson(req))
  return NextResponse.json(await setMySlackEmail(ctx, email))
})
