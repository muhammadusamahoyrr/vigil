import { notFound } from 'next/navigation'
import { PublicLeadForm } from '@/components/leads/public-lead-form'
import { findWorkspaceByFormToken } from '@/db/auth'

export const dynamic = 'force-dynamic'

export default async function PublicFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ws = await findWorkspaceByFormToken(token)
  if (!ws) notFound()
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Contact {ws.name}</h1>
        <p className="mt-2 text-foreground">Leave your details and someone from our team will get back to you shortly.</p>
      </div>
      <PublicLeadForm token={token} />
    </main>
  )
}
