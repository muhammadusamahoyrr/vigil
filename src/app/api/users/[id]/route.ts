import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { updateUser, userUpdateSchema } from '@/services/admin'

type P = { params: Promise<{ id: string }> }

export const PATCH = route<P>(async (req, { params }) => {
  const ctx = await getCtx(req)
  return NextResponse.json(await updateUser(ctx, (await params).id, userUpdateSchema.parse(await readJson(req))))
})
