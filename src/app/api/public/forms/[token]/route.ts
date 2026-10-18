import { NextResponse } from 'next/server'
import { findWorkspaceByFormToken } from '@/db/auth'
import { readJson, route } from '@/lib/api'
import { ApiError } from '@/lib/errors'
import { clientIp, rateLimit } from '@/lib/ratelimit'
import { systemCtx } from '@/lib/session'
import { createLead, createLeadSchema } from '@/services/leads'

type P = { params: Promise<{ token: string }> }

// Public web form: no login. The workspace comes ONLY from the URL token, looked up in the DB.
export const POST = route<P>(async (req, { params }) => {
  if (!rateLimit(`form:${clientIp(req)}`, 5, 60_000)) {
    throw new ApiError(429, 'Too many submissions. Please wait a minute and try again.')
  }
  const ws = await findWorkspaceByFormToken((await params).token)
  if (!ws) throw new ApiError(404, 'This form does not exist.')
  const body = (await readJson(req)) as Record<string, unknown>
  // Honeypot: people never see the "website" field, bots fill it. Pretend success, store nothing.
  if (typeof body?.website === 'string' && body.website.trim() !== '') return NextResponse.json({ ok: true })
  const input = createLeadSchema.parse(body)
  if (!input.phone && !input.email) {
    throw new ApiError(400, 'Leave a phone number or an email so we can reach you.', { phone: 'Phone or email is required.' })
  }
  await createLead(systemCtx(ws.id), input, 'form')
  return NextResponse.json({ ok: true }, { status: 201 })
})
