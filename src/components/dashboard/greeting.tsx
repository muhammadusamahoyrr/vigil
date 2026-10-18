"use client"

import { useEffect, useState } from 'react'

/** Greeting in the viewer's own local time. */
export function Greeting({ name }: { name: string }) {
  const [part, setPart] = useState('Welcome back')
  useEffect(() => {
    const h = new Date().getHours()
    setPart(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening')
  }, [])
  return <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{part}, <span className="text-muted-foreground">{name}</span></h1>
}
