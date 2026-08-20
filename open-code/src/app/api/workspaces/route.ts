import { listWorkspaces, createWorkspace } from "@/lib/api/handlers"

export async function GET(request: Request): Promise<Response> {
  return listWorkspaces(request)
}

export async function POST(request: Request): Promise<Response> {
  return createWorkspace(request)
}

export const dynamic = "force-dynamic"