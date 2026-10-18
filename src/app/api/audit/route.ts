import { NextResponse } from 'next/server'
import { route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { listAudit } from '@/services/admin'

export const GET = route(async req => {
  const q = new URL(req.url).searchParams
  return NextResponse.json(await listAudit(await getCtx(req), {
    action: q.get('action') ?? undefined, userId: q.get('user') ?? undefined,
    from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, page: Number(q.get('page') ?? 1),
  }))
})
