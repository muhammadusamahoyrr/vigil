import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { connectSlack, connectSlackSchema, slackStatus } from '@/services/slack'

export const GET = route(async req => NextResponse.json(await slackStatus(await getCtx(req))))

export const POST = route(async req => {
  const ctx = await getCtx(req)
  const { botToken } = connectSlackSchema.parse(await readJson(req))
  return NextResponse.json(await connectSlack(ctx, botToken))
})
