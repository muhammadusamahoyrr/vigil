import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { ChatClient } from '@/components/chat/chat-client'
import { findWorkspaceBySlug } from '@/db/auth'
import { CHAT_COOKIE, getCustomerConversation } from '@/services/webchat'

export const dynamic = 'force-dynamic'

export default async function PublicChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!(await findWorkspaceBySlug(slug))) notFound()
  const token = (await cookies()).get(CHAT_COOKIE)?.value ?? null
  const data = await getCustomerConversation(slug, token)
  const initials = data.business.split(' ').map(w => w[0]).slice(0, 2).join('')
  return (
    <main className="flex h-dvh items-stretch justify-center bg-sidebar sm:items-center sm:p-6">
      <div className="flex w-full max-w-lg flex-col overflow-hidden bg-background sm:h-[min(760px,100%)] sm:rounded-2xl sm:border sm:border-border sm:shadow-2xl">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-sm font-semibold text-background" aria-hidden>{initials}</span>
          <div className="min-w-0">
            <h1 className="truncate font-semibold tracking-tight">{data.business}</h1>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />Usually replies within minutes</p>
          </div>
        </header>
        <p className="border-b border-border px-4 py-1.5 text-center text-[11px] text-muted-foreground">Web Chat — alternative channel for unavailable messaging services.</p>
        <ChatClient slug={slug} initial={data.conversation} />
      </div>
    </main>
  )
}
