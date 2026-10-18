import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' })

export const metadata: Metadata = {
  title: 'Vigil: never lose a lead again',
  description: 'Lead-loss prevention platform: every lead has one accountable owner.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${geist.variable}`}>
      <body className="bg-background font-sans text-foreground antialiased">{children}</body>
    </html>
  )
}
