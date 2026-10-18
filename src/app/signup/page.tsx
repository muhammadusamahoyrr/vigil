import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/auth/auth-shell'
import { SignupForm } from '@/components/auth/signup-form'
import { getCtxOrNull } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function SignupPage() {
  if (await getCtxOrNull()) redirect('/dashboard')
  return (
    <AuthShell title="Create your workspace" subtitle="You become the Owner. Invite your team next."
      footer={<>Already have an account? <Link href="/login" className="font-medium text-indigo-600 hover:underline">Log in</Link></>}>
      <SignupForm />
    </AuthShell>
  )
}
