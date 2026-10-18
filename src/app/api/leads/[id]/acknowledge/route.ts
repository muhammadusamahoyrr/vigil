import { NextResponse } from 'next/server'
import { route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { acknowledgeLead } from '@/services/leads'

type P = { params: Promise<{ id: string }> }

export const POST = route<P>(async (req, { params }) => {
  const ctx = await getCtx(req)
  return NextResponse.json(await acknowledgeLead(ctx, (await params).id))
})
