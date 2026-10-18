// Who is acting (CLAUDE.md, Ctx). getCtx and systemCtx live in src/lib/session.ts (Step 2).
export type Ctx = {
  workspaceId: string
  userId: string | null // null = system
  level: 'owner' | 'admin' | 'user'
  permissions: string[] // system: ['*']
  isSystem: boolean
}
