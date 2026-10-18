import { NextResponse } from 'next/server'
import { route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { getConversation } from '@/services/inbox'

type P = { params: Promise<{ id: string }> }

export const GET = route<P>(async (req, { params }) => NextResponse.json(await getConversation(await getCtx(req), (await params).id)))
