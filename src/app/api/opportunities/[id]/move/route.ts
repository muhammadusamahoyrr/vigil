import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { moveOpportunity, moveSchema } from '@/services/crm'

type P = { params: Promise<{ id: string }> }

export const POST = route<P>(async (req, { params }) => {
  const ctx = await getCtx(req)
  const { stageId, version } = moveSchema.parse(await readJson(req))
  return NextResponse.json(await moveOpportunity(ctx, (await params).id, stageId, version))
})
