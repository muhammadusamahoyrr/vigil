import Link from 'next/link'
import { MoveStage } from '@/components/crm/move-stage'
import { Badge, PageTitle } from '@/components/ui-bits'
import { hasPermission } from '@/lib/rbac'
import { getCtxOrNull } from '@/lib/session'
import { board } from '@/services/crm'

const money = (v: unknown, c: string) => v === null ? 'Value hidden' : `${c} ${Number(v).toLocaleString('en-US')}`

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const ctx = (await getCtxOrNull())!
  const { p } = await searchParams
  const b = await board(ctx, p)
  const canEdit = hasPermission(ctx, 'crm.edit')
  return (
    <>
      <PageTitle title="Pipeline">
        <div className="flex flex-wrap gap-3 text-sm">
          {b.pipelines.map(x => <Link key={x.id} href={`/pipeline?p=${x.id}`} className={x.id === b.pipeline?.id ? 'font-semibold underline' : 'underline-offset-4 hover:underline'}>{x.name}</Link>)}
          {hasPermission(ctx, 'crm.export') && <a href="/api/export/opportunities" download className="underline underline-offset-4">Export CSV</a>}
        </div>
      </PageTitle>
      {!b.pipeline ? <p>No pipeline yet.</p> : (
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
          {b.pipeline.stages.map(s => {
            const items = b.opportunities.filter(o => o.stage_id === s.id)
            return (
              <section key={s.id} aria-labelledby={`st-${s.id}`} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <h2 id={`st-${s.id}`} className="flex flex-wrap items-center gap-2 font-semibold">
                  {s.name} <span className="text-sm font-normal text-muted-foreground">({items.length})</span>
                  {s.is_won && <Badge tone="good">Won</Badge>}{s.is_lost && <Badge tone="bad">Lost</Badge>}
                </h2>
                {s.required_fields.length > 0 && <p className="text-xs text-muted-foreground">Requires: {s.required_fields.join(', ')}</p>}
                {items.map(o => (
                  <article key={o.id} className="flex flex-col gap-1 rounded-md border border-border p-2 text-sm">
                    <span className="font-medium">{o.name}</span>
                    <Link href={`/contacts/${o.contact_id}`} className="text-xs underline">{o.contact_name}</Link>
                    <span className="text-xs">{money(o.value, o.currency)}</span>
                    {canEdit && <MoveStage oppId={o.id} version={o.version} current={s.id} stages={b.pipeline!.stages.map(x => ({ id: x.id, name: x.name }))} />}
                  </article>
                ))}
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
