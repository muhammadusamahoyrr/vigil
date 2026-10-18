import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { createLead, createLeadSchema, listLeads } from '@/services/leads'

export const GET = route(async req => {
  const ctx = await getCtx(req)
  const q = new URL(req.url).searchParams
  return NextResponse.json(await listLeads(ctx, { mine: q.get('mine') === '1', page: Number(q.get('page') ?? 1) }))
})

export const POST = route(async req => {
  const ctx = await getCtx(req)
  const input = createLeadSchema.parse(await readJson(req))
  return NextResponse.json(await createLead(ctx, input, 'manual'), { status: 201 })
})
