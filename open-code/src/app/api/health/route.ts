import "server-only"
import { getDiagnostics } from "@/lib/api/diagnostics"

export async function GET() {
  const diagnostics = await getDiagnostics()
  return Response.json(diagnostics)
}

export const dynamic = "force-dynamic"