import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { replySchema, replyToConversation } from '@/services/inbox'

type P = { params: Promise<{ id: string }> }

export const POST = route<P>(async (req, { params }) => {
  const ctx = await getCtx(req)
  const { body } = replySchema.parse(await readJson(req))
  return NextResponse.json(await replyToConversation(ctx, (await params).id, body), { status: 201 })
})
