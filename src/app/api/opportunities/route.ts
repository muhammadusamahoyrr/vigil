import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { createOpportunity, opportunitySchema } from '@/services/crm'

export const POST = route(async req => {
  const ctx = await getCtx(req)
  return NextResponse.json(await createOpportunity(ctx, opportunitySchema.parse(await readJson(req))), { status: 201 })
})
