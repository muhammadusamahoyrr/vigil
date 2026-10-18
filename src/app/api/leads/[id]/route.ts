import { NextResponse } from 'next/server'
import { route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { getLead } from '@/services/leads'

type P = { params: Promise<{ id: string }> }

export const GET = route<P>(async (req, { params }) => {
  const ctx = await getCtx(req)
  return NextResponse.json(await getLead(ctx, (await params).id))
})
