// Route wrapper: CSRF check for mutating methods, consistent JSON errors, safe logging.
// Every API route is written as: export const POST = route(async req => { ... })
import 'server-only'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { assertSameOrigin } from './csrf'
import { ApiError } from './errors'

type Handler<C> = (req: Request, context: C) => Promise<Response>

export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, context) => {
    try {
      assertSameOrigin(req)
      return await handler(req, context)
    } catch (e) {
      return errorResponse(e, req)
    }
  }
}

export function errorResponse(e: unknown, req?: Request) {
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {}
    for (const issue of e.issues) {
      const key = issue.path.join('.') || 'form'
      fields[key] ??= issue.message
    }
    return NextResponse.json({ error: 'Please fix the highlighted fields.', fields }, { status: 400 })
  }
  if (e instanceof ApiError) {
    return NextResponse.json({ error: e.message, ...(e.fields ? { fields: e.fields } : {}) }, { status: e.status })
  }
  const status = (e as { status?: unknown })?.status
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return NextResponse.json({ error: (e as Error).message }, { status })
  }
  // never log bodies, cookies, tokens or credentials: only the route and error message
  console.error(`[api] ${req?.method ?? ''} ${req ? new URL(req.url).pathname : ''}:`, (e as Error)?.message)
  return NextResponse.json({ error: 'Something went wrong on our side. Please try again.' }, { status: 500 })
}

/** Parse a JSON body; invalid JSON becomes a 400, not a 500. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON.')
  }
}
