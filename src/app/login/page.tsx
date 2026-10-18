import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LoginForm } from '@/components/auth/login-form'
import { getCtxOrNull } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (await getCtxOrNull()) redirect('/dashboard')
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-3xl font-semibold text-foreground">Log in to Vigil</h1>
      <LoginForm />
      <p className="text-sm text-foreground">
        New company? <Link href="/signup" className="font-medium underline underline-offset-4">Create a workspace</Link>
      </p>
    </main>
  )
}
