import { searchRepositories } from "@/lib/api/handlers"

export async function GET(request: Request): Promise<Response> {
  return searchRepositories(request)
}

export const dynamic = "force-dynamic"