import { route } from '@/lib/api'
import { getCtx } from '@/lib/session'
import { exportCsv } from '@/services/crm'

type P = { params: Promise<{ entity: string }> }

// Same serialize() as list and detail: masked values stay masked in the file.
export const GET = route<P>(async (req, { params }) => {
  const { entity } = await params
  const csv = await exportCsv(await getCtx(req), entity)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${entity}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
})
