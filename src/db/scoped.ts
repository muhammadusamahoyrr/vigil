// Workspace-scoped queries. Every request/service query goes through scoped(ctx).
//
// Rule: $1 is ALWAYS ctx.workspaceId, added automatically. Write your own
// parameters from $2:
//   const db = scoped(ctx)
//   await db.one('SELECT * FROM contacts WHERE workspace_id = $1 AND id = $2', [id])
// assertWorkspace() rejects any SQL that does not filter on workspace_id = $1,
// so a forgotten filter fails loudly in development instead of leaking data.
import type { PoolClient, QueryResultRow } from 'pg'
import { pool } from './client'
import type { Ctx } from '@/lib/ctx'

export class NotFoundError extends Error {
  status = 404
  constructor(message = 'Not found') { super(message) }
}

export class ConflictError extends Error {
  status = 409
  constructor(message = 'This record was changed by someone else. Reload and try again.') { super(message) }
}

const WORKSPACE_FILTER = /workspace_id\s*=\s*\$1(?!\d)/i
// INSERT INTO t (workspace_id, ...) VALUES ($1, ...): workspace_id first, value $1
const WORKSPACE_INSERT = /^\s*insert\s+into\s+\w+\s*\(\s*workspace_id\s*(,[^)]*)?\)\s*values\s*\(\s*\$1\s*[,)]/i

export function assertWorkspace(text: string) {
  if (!WORKSPACE_FILTER.test(text) && !WORKSPACE_INSERT.test(text)) {
    throw new Error(
      `Unscoped query: SQL must filter on "workspace_id = $1" or insert workspace_id first as $1. Query: ${text.slice(0, 120)}`,
    )
  }
}

type Queryable = Pick<PoolClient, 'query'>

function helpers(ctx: Ctx, conn: Queryable) {
  async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
    assertWorkspace(text)
    return conn.query<T>(text, [ctx.workspaceId, ...params])
  }
  return {
    workspaceId: ctx.workspaceId,
    query,
    /** All rows. */
    async many<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
      return (await query<T>(text, params)).rows
    },
    /** Exactly one row, or NotFoundError (404). A record of another workspace is simply not found. */
    async one<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
      const { rows } = await query<T>(text, params)
      if (rows.length === 0) throw new NotFoundError()
      return rows[0]
    },
    /** First row or null. */
    async maybeOne<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
      const { rows } = await query<T>(text, params)
      return rows[0] ?? null
    },
    /** Raw client for calling lead-engine functions inside a tx (they check workspaces themselves). */
    raw: conn,
  }
}

export type Scoped = ReturnType<typeof helpers>

/** Scoped helpers bound to a client that is ALREADY inside a transaction (no nested BEGIN). */
export function bindScoped(ctx: Ctx, client: Queryable): Scoped {
  return helpers(ctx, client)
}

export function scoped(ctx: Ctx) {
  return {
    ...helpers(ctx, pool),
    /** Run fn in one transaction; audit rows written with tx.raw share it. */
    async tx<T>(fn: (tx: Scoped) => Promise<T>): Promise<T> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(helpers(ctx, client))
        await client.query('COMMIT')
        return result
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        throw e
      } finally {
        client.release()
      }
    },
  }
}
