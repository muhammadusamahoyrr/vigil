import { CircleCheck, Shield } from 'lucide-react'

const POINTS = [
  'Every lead gets exactly one accountable owner',
  'Ignored leads escalate automatically, even after a server restart',
  'Complete, tamper-proof ownership history',
]

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-slate-950 p-10 text-white lg:flex">
        <div aria-hidden className="absolute -right-24 -top-24 size-96 rounded-full bg-indigo-600/30 blur-3xl" />
        <div aria-hidden className="absolute -bottom-32 -left-16 size-96 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-indigo-600"><Shield className="size-5" aria-hidden /></span>
          <span className="text-xl font-semibold tracking-tight">Vigil</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">No lead left behind.</h2>
          <p className="mt-3 text-slate-300">Vigil is a lead-loss prevention platform for sales teams.</p>
          <ul className="mt-8 flex flex-col gap-3">
            {POINTS.map(p => <li key={p} className="flex items-start gap-3 text-sm text-slate-200"><CircleCheck className="mt-0.5 size-4 shrink-0 text-indigo-400" aria-hidden />{p}</li>)}
          </ul>
        </div>
        <p className="relative text-xs text-slate-500">Built for the Unified Business Management hackathon.</p>
      </section>
      <section className="flex items-center justify-center bg-slate-50 px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-8 place-items-center rounded-lg bg-indigo-600 text-white"><Shield className="size-4" aria-hidden /></span>
            <span className="text-lg font-semibold">Vigil</span>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          <p className="mt-6 text-center text-sm text-slate-600">{footer}</p>
        </div>
      </section>
    </main>
  )
}
