type FieldProps = {
  id: string
  label: string
  type?: string
  autoComplete?: string
  error?: string
  hint?: string
  value: string
  onChange: (v: string) => void
}

export function Field({ id, label, type = 'text', autoComplete, error, hint, value, onChange }: FieldProps) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <input id={id} name={id} type={type} autoComplete={autoComplete} required value={value} onChange={e => onChange(e.target.value)}
        aria-invalid={error ? true : undefined} aria-describedby={describedBy}
        className="h-10 rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive" />
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-xs text-destructive">Error: {error}</p>}
    </div>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p>
}
