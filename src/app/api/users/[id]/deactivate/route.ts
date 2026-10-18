import { NextResponse } from 'next/server'
import { route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { deactivateUser } from '@/services/admin'

type P = { params: Promise<{ id: string }> }

export const POST = route<P>(async (req, { params }) => NextResponse.json(await deactivateUser(await getCtx(req), (await params).id)))
