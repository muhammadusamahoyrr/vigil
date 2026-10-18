import { MessagesSquare, ShieldCheck, Timer } from 'lucide-react'
import { Logo } from '@/components/app-shell/app-shell'
import { Constellation } from '@/components/marketing/constellation'

const POINTS = [
  { icon: Timer, title: 'Every lead gets an owner', text: 'Automatic assignment and escalation, in seconds.' },
  { icon: MessagesSquare, title: 'One inbox', text: 'Built-in web chat with realtime replies.' },
  { icon: ShieldCheck, title: 'Secure & isolated', text: 'Each workspace is fully separated and audited.' },
]

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-sidebar p-10 lg:flex">
        <Constellation density={0.6} />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.07),transparent_70%)]" />
        <div className="relative"><Logo size="lg" /></div>
        <div className="relative max-w-sm">
          <h2 className="text-[34px] font-semibold leading-[1.1] tracking-tight">Welcome back.<br />Your leads are waiting.</h2>
          <ul className="mt-8 flex flex-col gap-5">
            {POINTS.map(p => (
              <li key={p.title} className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-card"><p.icon className="size-4" aria-hidden /></span>
                <span><span className="block text-sm font-medium">{p.title}</span><span className="block text-sm text-muted-foreground">{p.text}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-muted-foreground">Vigil · lead-loss prevention</p>
      </section>
      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <p className="mb-6 text-right text-sm text-muted-foreground">{footer}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-7">{children}</div>
          <p className="mt-6 text-center text-xs text-muted-foreground">Your data stays private and workspace-isolated.</p>
        </div>
      </section>
    </main>
  )
}
