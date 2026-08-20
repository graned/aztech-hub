import { listMessages } from "@/lib/api/handlers"

interface RouteContext {
  params: Promise<{ id: string; sessionId: string }>
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const params = await context.params
  return listMessages(request, params)
}

export const dynamic = "force-dynamic"