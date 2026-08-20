import { listBranches } from "@/lib/api/handlers"

interface RouteContext {
  params: Promise<{ owner: string; repo: string }>
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const params = await context.params
  return listBranches(request, params)
}

export const dynamic = "force-dynamic"