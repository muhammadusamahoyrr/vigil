import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { preferencesSchema, setHiddenTiles } from '@/services/preferences'

export const POST = route(async req => {
  const ctx = await getCtx(req)
  const { hiddenTiles } = preferencesSchema.parse(await readJson(req))
  return NextResponse.json(await setHiddenTiles(ctx, hiddenTiles))
})
