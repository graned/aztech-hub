import { redirect } from "next/navigation"

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>
}) {
  const { id, sessionId } = await params
  redirect(`/api/workspaces/${id}/open?sessionId=${encodeURIComponent(sessionId)}`)
}

export const dynamic = "force-dynamic"
