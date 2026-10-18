import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { rolePermissionsSchema, setRolePermissions } from '@/services/admin'

type P = { params: Promise<{ id: string }> }

export const PUT = route<P>(async (req, { params }) => {
  const ctx = await getCtx(req)
  const { keys } = rolePermissionsSchema.parse(await readJson(req))
  return NextResponse.json(await setRolePermissions(ctx, (await params).id, keys))
})
