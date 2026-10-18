import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { addMember, addMemberSchema, listTeam } from '@/services/team'

export const GET = route(async req => NextResponse.json(await listTeam(await getCtx(req))))

export const POST = route(async req => {
  const ctx = await getCtx(req)
  const input = addMemberSchema.parse(await readJson(req))
  return NextResponse.json(await addMember(ctx, input), { status: 201 })
})
