import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { contactSchema, deleteContact, getContact, updateContact } from '@/services/crm'

type P = { params: Promise<{ id: string }> }

export const GET = route<P>(async (req, { params }) => NextResponse.json(await getContact(await getCtx(req), (await params).id)))

export const PATCH = route<P>(async (req, { params }) => {
  const ctx = await getCtx(req)
  return NextResponse.json(await updateContact(ctx, (await params).id, contactSchema.parse(await readJson(req))))
})

export const DELETE = route<P>(async (req, { params }) => NextResponse.json(await deleteContact(await getCtx(req), (await params).id)))
