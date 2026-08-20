import { getWorkspace } from "@/lib/api/handlers"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const params = await context.params
  return getWorkspace(request, params)
}

export const dynamic = "force-dynamic"