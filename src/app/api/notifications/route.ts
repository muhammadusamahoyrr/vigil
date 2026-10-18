import { NextResponse } from 'next/server'
import { route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { listNotifications } from '@/services/inbox'

export const GET = route(async req => NextResponse.json(await listNotifications(await getCtx(req))))
