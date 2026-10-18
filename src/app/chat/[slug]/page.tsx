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
  return (
    <main className="mx-auto flex h-dvh w-full max-w-lg flex-col px-4 py-4">
      <header className="border-b border-border pb-3">
        <h1 className="text-xl font-semibold text-foreground">{data.business}</h1>
        <p className="text-sm text-muted-foreground">Chat with our team. We reply here, in this window.</p>
        <p className="mt-1 text-xs text-muted-foreground">Web Chat — alternative channel for unavailable messaging services.</p>
      </header>
      <ChatClient slug={slug} initial={data.conversation} />
    </main>
  )
}
