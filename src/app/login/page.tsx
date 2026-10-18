import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/auth/auth-shell'
import { LoginForm } from '@/components/auth/login-form'
import { getCtxOrNull } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (await getCtxOrNull()) redirect('/dashboard')
  return (
    <AuthShell title="Sign in" subtitle="Welcome back. Sign in to your workspace."
      footer={<>New to Vigil? <Link href="/signup" className="font-medium text-foreground hover:underline">Create an account</Link></>}>
      <LoginForm />
    </AuthShell>
  )
}
