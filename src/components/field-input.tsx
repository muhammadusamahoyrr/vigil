type Props = {
  id: string; label: string; type?: string; value: string; onChange: (v: string) => void
  error?: string; required?: boolean; placeholder?: string; autoComplete?: string; hint?: string
}

export function FieldInput({ id, label, type = 'text', value, onChange, error, required, placeholder, autoComplete, hint }: Props) {
  const described = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-foreground">{label}{required ? '' : ' (optional)'}</label>
      <input id={id} type={type} value={value} required={required} placeholder={placeholder} autoComplete={autoComplete}
        onChange={e => onChange(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={described}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-base text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive" />
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-err`} className="text-sm text-destructive">Error: {error}</p>}
    </div>
  )
}

export function Alert({ error, success }: { error?: string | null; success?: string | null }) {
  if (error) return <p role="alert" className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive">{error}</p>
  if (success) return <p role="status" className="rounded-md border border-green-700 px-3 py-2 text-sm text-green-800 dark:text-green-400">{success}</p>
  return null
}
