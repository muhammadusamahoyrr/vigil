import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { getRules, rulesSchema, updateRules } from '@/services/team'

export const GET = route(async req => NextResponse.json(await getRules(await getCtx(req))))

export const PUT = route(async req => {
  const ctx = await getCtx(req)
  const input = rulesSchema.parse(await readJson(req))
  return NextResponse.json(await updateRules(ctx, input))
})
