"use client"

import { useAction } from '@/components/use-action'

export function MoveStage({ oppId, version, current, stages }: { oppId: string; version: number; current: string; stages: { id: string; name: string }[] }) {
  const { run, loading, error } = useAction()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`mv-${oppId}`} className="text-xs text-muted-foreground">Move to stage</label>
      <select id={`mv-${oppId}`} value={current} disabled={loading}
        onChange={e => run(`/api/opportunities/${oppId}/move`, { stageId: e.target.value, version })}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm">
        {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {loading && <span className="text-xs text-muted-foreground">Moving…</span>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
