import { WorkspaceView } from "@/components/workspace-view"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <WorkspaceView id={id} />
}

export const dynamic = "force-dynamic"