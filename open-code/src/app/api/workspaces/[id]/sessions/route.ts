import { listSessions, createSession } from "@/lib/api/handlers"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const params = await context.params
  return listSessions(request, params)
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const params = await context.params
  return createSession(request, params)
}

export const dynamic = "force-dynamic"