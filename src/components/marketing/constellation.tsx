"use client"

import { useEffect, useRef } from 'react'

/** Decorative drifting points joined by faint lines. Static when the user prefers reduced motion. */
export function Constellation({ density = 1 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0, h = 0, raf = 0
    let pts: { x: number; y: number; vx: number; vy: number }[] = []
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth; h = canvas.clientHeight
      canvas.width = w * dpr; canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const n = Math.round(Math.min(110, (w * h) / 14000) * density)
      pts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18 }))
    }
    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      for (const p of pts) {
        if (!reduce) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1 }
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = Math.hypot(dx, dy)
          if (d < 130) { ctx.strokeStyle = `rgba(255,255,255,${0.12 * (1 - d / 130)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke() }
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2); ctx.fill() }
      if (!reduce) raf = requestAnimationFrame(draw)
    }
    resize(); draw()
    window.addEventListener('resize', resize)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [density])
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 size-full" />
}
