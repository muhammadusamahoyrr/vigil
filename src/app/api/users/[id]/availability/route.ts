import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { availabilitySchema, setAvailability } from '@/services/team'

type P = { params: Promise<{ id: string }> }

export const POST = route<P>(async (req, { params }) => {
  const ctx = await getCtx(req)
  const { status } = availabilitySchema.parse(await readJson(req))
  return NextResponse.json(await setAvailability(ctx, (await params).id, status))
})
