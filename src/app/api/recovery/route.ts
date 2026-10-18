import { NextResponse } from 'next/server'
import { route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { listRecovery } from '@/services/leads'

export const GET = route(async req => NextResponse.json(await listRecovery(await getCtx(req))))
