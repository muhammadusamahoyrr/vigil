import Link from 'next/link'
import { NewContactForm } from '@/components/crm/new-contact-form'
import { Card, PageTitle, fmt } from '@/components/ui-bits'
import { hasPermission } from '@/lib/rbac'
import { getCtxOrNull } from '@/lib/session'
import { listContacts } from '@/services/crm'

type SP = Promise<{ q?: string; page?: string }>

export default async function ContactsPage({ searchParams }: { searchParams: SP }) {
  const ctx = (await getCtxOrNull())!
  const sp = await searchParams
  const data = await listContacts(ctx, { q: sp.q, page: Number(sp.page ?? 1) })
  const link = (p: number) => `/contacts?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`
  return (
    <>
      <PageTitle title="Contacts">
        {hasPermission(ctx, 'crm.export') && <a href="/api/export/contacts" download className="text-sm underline underline-offset-4">Export CSV</a>}
      </PageTitle>
      <form method="get" className="flex flex-wrap items-end gap-2" role="search">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">Search name, phone or email</label>
          <input id="q" name="q" defaultValue={sp.q ?? ''} className="h-10 w-72 max-w-full rounded-md border border-input bg-background px-3 text-base" />
        </div>
        <button type="submit" className="h-10 rounded-lg border border-border px-4 font-medium">Search</button>
      </form>
      {hasPermission(ctx, 'crm.create') && <NewContactForm />}
      <Card>
        <ul className="divide-y divide-border">
          {data.contacts.map(c => (
            <li key={c.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col">
                <Link href={`/contacts/${c.id}`} className="font-medium underline-offset-4 hover:underline">{c.name}</Link>
                <span className="text-xs text-muted-foreground break-all">{[c.phone, c.email, c.company_name].filter(Boolean).join(' · ') || '—'}</span>
              </div>
              <span className="text-sm text-foreground">{c.opportunities} opportunit{c.opportunities === 1 ? 'y' : 'ies'} · assigned: {c.assigned_to ?? '—'} · {fmt(c.created_at)}</span>
            </li>
          ))}
          {data.contacts.length === 0 && <li className="py-3 text-sm">No contacts found.</li>}
        </ul>
        <div className="mt-3 flex gap-4 text-sm">
          {data.page > 1 && <Link className="underline" href={link(data.page - 1)}>Previous</Link>}
          {data.hasMore && <Link className="underline" href={link(data.page + 1)}>Next</Link>}
        </div>
      </Card>
    </>
  )
}
