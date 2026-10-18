// Per-user remembered UI choices (F5.5 hidden dashboard tiles).
import 'server-only'
import { z } from 'zod'
import { scoped } from '@/db/scoped'
import type { Ctx } from '@/lib/ctx'

export const TILE_IDS = ['newLeads', 'pipeline', 'firstResponse', 'recovery', 'escalations', 'availability', 'appointments', 'payments'] as const
export const preferencesSchema = z.object({ hiddenTiles: z.array(z.enum(TILE_IDS)).max(TILE_IDS.length) })

export async function hiddenTiles(ctx: Ctx): Promise<string[]> {
  const r = await scoped(ctx).maybeOne<{ hidden_tiles: string[] }>(
    'SELECT hidden_tiles FROM user_preferences WHERE workspace_id = $1 AND user_id = $2', [ctx.userId])
  return r?.hidden_tiles ?? []
}

export async function setHiddenTiles(ctx: Ctx, tiles: string[]) {
  await scoped(ctx).query(
    `INSERT INTO user_preferences (workspace_id, user_id, hidden_tiles) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET hidden_tiles = EXCLUDED.hidden_tiles, updated_at = now()`, [ctx.userId, tiles])
  return { hiddenTiles: tiles }
}
