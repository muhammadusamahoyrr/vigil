import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/auth/auth-shell'
import { LoginForm } from '@/components/auth/login-form'
import { getCtxOrNull } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (await getCtxOrNull()) redirect('/dashboard')
  return (
    <AuthShell title="Welcome back" subtitle="Log in to your workspace."
      footer={<>New company? <Link href="/signup" className="font-medium text-indigo-600 hover:underline">Create a workspace</Link></>}>
      <LoginForm />
    </AuthShell>
  )
}
