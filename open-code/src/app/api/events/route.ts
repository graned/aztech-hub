import { streamSessionEvents } from "@/lib/api/handlers"

export async function GET(request: Request): Promise<Response> {
  return streamSessionEvents(request)
}

export const dynamic = "force-dynamic"