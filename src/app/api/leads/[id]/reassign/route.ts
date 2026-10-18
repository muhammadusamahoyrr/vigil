import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { reassignLead, reassignSchema } from '@/services/leads'

type P = { params: Promise<{ id: string }> }

export const POST = route<P>(async (req, { params }) => {
  const ctx = await getCtx(req)
  const { toUserId } = reassignSchema.parse(await readJson(req))
  return NextResponse.json(await reassignLead(ctx, (await params).id, toUserId))
})
