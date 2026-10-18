import Link from 'next/link'

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-6 px-4 py-12 sm:px-6">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">Vigil</h1>
        <p className="mt-3 text-lg text-foreground">
          Vigil is a lead-loss prevention platform: every lead has one accountable owner, missed
          responses escalate automatically, and the complete chain is traceable.
        </p>
      </header>

      <section aria-labelledby="status-heading" className="rounded-lg border border-border p-4">
        <h2 id="status-heading" className="text-base font-semibold text-foreground">
          Status
        </h2>
        <ul className="mt-2 space-y-2 text-foreground">
          <li>
            <span className="font-medium">Ready:</span> application scaffold.
          </li>
          <li>
            <span className="font-medium">Ready:</span> database, lead engine and accounts (sign up,
            log in). Lead screens arrive next.
          </li>
        </ul>
      </section>

      <nav aria-label="Get started" className="flex flex-wrap gap-3">
        <Link href="/signup" className="inline-flex h-10 items-center rounded-lg bg-primary px-4 font-medium text-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/50 outline-none">
          Create workspace
        </Link>
        <Link href="/login" className="inline-flex h-10 items-center rounded-lg border border-border px-4 font-medium text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 outline-none">
          Log in
        </Link>
      </nav>
    </main>
  )
}
