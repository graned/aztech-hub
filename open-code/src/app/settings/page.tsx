import Link from "next/link"
import { getDiagnostics } from "@/lib/api/diagnostics"
import { SettingsStatus } from "@/components/settings-status"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const diagnostics = await getDiagnostics()

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8 sm:py-12">
      <nav className="text-sm" aria-label="Breadcrumb">
        <Link href="/" className="text-accent hover:text-accent-hover">
          Workspaces
        </Link>
        <span className="mx-2 text-tertiary">/</span>
        <span className="text-muted">Settings</span>
      </nav>

      <header className="mt-6 border-b pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Service status as reported by the server. Configuration lives in environment variables.
        </p>
      </header>

      <section aria-labelledby="diagnostics-heading">
        <h2 id="diagnostics-heading" className="mt-8 text-lg font-semibold">
          Diagnostics
        </h2>
        <SettingsStatus diagnostics={diagnostics} />
      </section>
    </main>
  )
}