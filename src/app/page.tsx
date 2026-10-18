import Link from 'next/link'
import { ArrowRight, LifeBuoy, MessagesSquare, Shield, Timer } from 'lucide-react'

const FEATURES = [
  { icon: Timer, title: 'Countdown on every lead', text: 'One owner, a visible acknowledgement window, automatic escalation.' },
  { icon: LifeBuoy, title: 'Recovery queue', text: 'Overdue, idle or orphaned leads surface with the reason, ready to reassign.' },
  { icon: MessagesSquare, title: 'Built-in web chat', text: 'Customers chat in the browser; replies arrive in realtime.' },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-16 px-4 py-10 sm:px-6">
        <header className="flex items-center justify-between">
          <span className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-lg bg-indigo-600"><Shield className="size-5" aria-hidden /></span>
            <span className="text-xl font-semibold tracking-tight">Vigil</span>
          </span>
          <Link href="/login" className="rounded-lg px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10">Log in</Link>
        </header>
        <section className="max-w-2xl">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">No lead left behind.</h1>
          <p className="mt-5 text-lg text-slate-300">
            Vigil is a lead-loss prevention platform: every lead has one accountable owner, missed responses escalate
            automatically, and the complete chain is traceable.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="inline-flex h-11 items-center gap-2 rounded-lg bg-indigo-600 px-5 font-medium hover:bg-indigo-500">Create workspace <ArrowRight className="size-4" aria-hidden /></Link>
            <Link href="/login" className="inline-flex h-11 items-center rounded-lg border border-white/20 px-5 font-medium hover:bg-white/10">Log in</Link>
          </div>
        </section>
        <section className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-xl border border-white/10 bg-white/5 p-5">
              <f.icon className="size-5 text-indigo-400" aria-hidden />
              <h2 className="mt-3 font-semibold">{f.title}</h2>
              <p className="mt-1 text-sm text-slate-400">{f.text}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  )
}
