import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { addLeadNote, noteSchema } from '@/services/leads'

type P = { params: Promise<{ id: string }> }

export const POST = route<P>(async (req, { params }) => {
  const ctx = await getCtx(req)
  const { body } = noteSchema.parse(await readJson(req))
  return NextResponse.json(await addLeadNote(ctx, (await params).id, body), { status: 201 })
})
