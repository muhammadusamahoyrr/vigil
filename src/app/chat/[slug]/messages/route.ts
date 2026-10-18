import { NextResponse } from 'next/server'
import { readJson, route } from '@/lib/api'
import { ApiError } from '@/lib/errors'
import { clientIp, rateLimit } from '@/lib/ratelimit'
import { CHAT_COOKIE, CHAT_COOKIE_DAYS, chatCookiePath, customerMessageSchema, getCustomerConversation, sendCustomerMessage } from '@/services/webchat'

type P = { params: Promise<{ slug: string }> }

function token(req: Request): string | null {
  const m = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${CHAT_COOKIE}=([^;]+)`))
  return m ? decodeURIComponent(m[1]) : null
}

// Customer reads their own conversation (cookie token only).
export const GET = route<P>(async (req, { params }) => {
  const { slug } = await params
  return NextResponse.json(await getCustomerConversation(slug, token(req)), { headers: { 'Cache-Control': 'no-store' } })
})

// Customer sends a message. First message creates contact, conversation and lead.
export const POST = route<P>(async (req, { params }) => {
  const { slug } = await params
  if (!rateLimit(`chat:${clientIp(req)}`, 20, 60_000)) throw new ApiError(429, 'You are sending messages too fast. Please wait a moment.')
  const input = customerMessageSchema.parse(await readJson(req))
  const result = await sendCustomerMessage(slug, token(req), input)
  const res = NextResponse.json({ ok: true, duplicate: result.duplicate, started: result.created }, { status: result.created ? 201 : 200 })
  if (result.token) {
    res.cookies.set(CHAT_COOKIE, result.token, {
      httpOnly: true, sameSite: 'lax', path: chatCookiePath(slug),
      secure: process.env.NODE_ENV === 'production', maxAge: CHAT_COOKIE_DAYS * 86_400,
    })
  }
  return res
})
