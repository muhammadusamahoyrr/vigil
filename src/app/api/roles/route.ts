import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { createRole, listRolesWithPermissions, roleSchema } from '@/services/admin'

export const GET = route(async req => NextResponse.json(await listRolesWithPermissions(await getCtx(req))))

export const POST = route(async req => {
  const ctx = await getCtx(req)
  return NextResponse.json(await createRole(ctx, roleSchema.parse(await readJson(req))), { status: 201 })
})
