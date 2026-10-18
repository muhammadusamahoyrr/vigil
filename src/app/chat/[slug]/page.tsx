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
    <main className="flex h-dvh items-stretch justify-center bg-slate-100 sm:items-center sm:p-6">
      <div className="flex w-full max-w-lg flex-col overflow-hidden bg-white sm:h-[min(760px,100%)] sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-xl">
        <header className="flex items-center gap-3 bg-indigo-600 px-4 py-3 text-white">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/20 font-semibold" aria-hidden>{initials}</span>
          <div className="min-w-0">
            <h1 className="truncate font-semibold">{data.business}</h1>
            <p className="text-xs text-indigo-100">Usually replies within minutes</p>
          </div>
        </header>
        <p className="border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-center text-[11px] text-slate-500">Web Chat — alternative channel for unavailable messaging services.</p>
        <ChatClient slug={slug} initial={data.conversation} />
      </div>
    </main>
  )
}
