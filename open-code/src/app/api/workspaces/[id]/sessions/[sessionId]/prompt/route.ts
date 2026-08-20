import { submitPrompt } from "@/lib/api/handlers"

interface RouteContext {
  params: Promise<{ id: string; sessionId: string }>
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const params = await context.params
  return submitPrompt(request, params)
}

export const dynamic = "force-dynamic"