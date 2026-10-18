import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { contactSchema, createContact, listContacts } from '@/services/crm'

export const GET = route(async req => {
  const q = new URL(req.url).searchParams
  return NextResponse.json(await listContacts(await getCtx(req), { q: q.get('q') ?? undefined, page: Number(q.get('page') ?? 1) }))
})

export const POST = route(async req => {
  const ctx = await getCtx(req)
  return NextResponse.json(await createContact(ctx, contactSchema.parse(await readJson(req))), { status: 201 })
})
