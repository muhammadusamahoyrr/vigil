import Link from 'next/link'
import { ArrowRight, Check, Clock, LifeBuoy, MessagesSquare, ShieldCheck, Timer } from 'lucide-react'
import { Logo } from '@/components/app-shell/app-shell'
import { Constellation } from '@/components/marketing/constellation'

const FEATURES = [
  { icon: Timer, title: 'A countdown on every lead', text: 'One accountable owner, a visible acknowledgement window, automatic escalation when it is missed.' },
  { icon: LifeBuoy, title: 'Recovery queue', text: 'Overdue, idle or orphaned leads surface with the exact reason, ready for a manager to reassign.' },
  { icon: MessagesSquare, title: 'Built-in web chat', text: 'Customers chat from any browser; agents reply from the inbox and it lands instantly.' },
]

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <Constellation />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.08),transparent_65%)]" />
      <div className="relative mx-auto flex max-w-5xl flex-col px-4 sm:px-6">
        <header className="flex h-20 items-center justify-between">
          <Logo />
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/login" className="rounded-md px-3 py-2 text-muted-foreground hover:text-foreground">Sign in</Link>
            <Link href="/signup" className="rounded-md bg-primary px-3.5 py-2 font-medium text-primary-foreground hover:bg-primary/90">Sign up</Link>
          </nav>
        </header>

        <section className="flex flex-col items-center pb-20 pt-20 text-center sm:pt-28">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <span className="size-1.5 rounded-full bg-foreground" aria-hidden /> Lead response, handled automatically
          </span>
          <h1 className="mt-6 text-[44px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-7xl">
            Never lose a lead <span className="bg-gradient-to-b from-zinc-300 to-zinc-500 bg-clip-text text-transparent">again.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            One connected workspace for leads, conversations and your sales team, with automatic assignment and escalation,
            so every inbound customer has an owner within seconds and nothing slips through.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90">Start free <ArrowRight className="size-4" aria-hidden /></Link>
            <Link href="/login" className="inline-flex h-11 items-center rounded-lg border border-border bg-background/60 px-5 text-sm font-medium backdrop-blur hover:bg-accent">View the dashboard</Link>
          </div>
          <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <li className="flex items-center gap-1.5"><Check className="size-3.5" aria-hidden />No setup fees</li>
            <li className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" aria-hidden />Workspace-isolated & audited</li>
            <li className="flex items-center gap-1.5"><Clock className="size-3.5" aria-hidden />Survives server restarts</li>
          </ul>
        </section>

        <section className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
          {FEATURES.map(f => (
            <div key={f.title} className="bg-card/90 p-6 backdrop-blur">
              <f.icon className="size-5" aria-hidden />
              <h2 className="mt-4 font-semibold tracking-tight">{f.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </section>
        <footer className="py-10 text-center text-xs text-muted-foreground">Vigil · lead-loss prevention platform</footer>
      </div>
    </main>
  )
}
