import Link from 'next/link'
import { redirect } from 'next/navigation'
import { SignupForm } from '@/components/auth/signup-form'
import { getCtxOrNull } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function SignupPage() {
  if (await getCtxOrNull()) redirect('/dashboard')
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-3xl font-semibold text-foreground">Create your workspace</h1>
        <p className="mt-2 text-foreground">You become the Owner. You can invite your team later.</p>
      </div>
      <SignupForm />
      <p className="text-sm text-foreground">
        Already have an account? <Link href="/login" className="font-medium underline underline-offset-4">Log in</Link>
      </p>
    </main>
  )
}
