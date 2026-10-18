import { NextResponse } from 'next/server'
import { route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { listConversations } from '@/services/inbox'

export const GET = route(async req => NextResponse.json(await listConversations(await getCtx(req))))
