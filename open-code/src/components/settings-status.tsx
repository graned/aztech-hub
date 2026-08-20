import type { Diagnostics, ServiceReachability } from "@/lib/api/diagnostics"

const stateLabel: Record<ServiceReachability, string> = {
  ok: "Healthy",
  unreachable: "Unreachable",
  "not-configured": "Not configured",
}

const stateClass: Record<ServiceReachability, string> = {
  ok: "text-success",
  unreachable: "text-error",
  "not-configured": "text-warning",
}

function StateBadge({ state }: { state: ServiceReachability }) {
  return (
    <span className={`rounded-full bg-panel px-3 py-1 text-xs font-medium ${stateClass[state]}`}>
      {stateLabel[state]}
    </span>
  )
}

interface ServiceRowProps {
  name: string
  state: ServiceReachability
  detail: string | null
}

function ServiceRow({ name, state, detail }: ServiceRowProps) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border bg-panel p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{name}</p>
        {detail !== null ? <p className="mt-1 truncate font-mono text-xs text-tertiary">{detail}</p> : null}
      </div>
      <StateBadge state={state} />
    </li>
  )
}

export function SettingsStatus({ diagnostics }: { diagnostics: Diagnostics }) {
  return (
    <ul className="mt-6 space-y-3">
      <ServiceRow
        name="MongoDB"
        state={diagnostics.mongodb.state}
        detail={null}
      />
      <ServiceRow
        name="OpenCode"
        state={diagnostics.opencode.state}
        detail={diagnostics.opencode.version ?? null}
      />
      <ServiceRow
        name="GitHub"
        state={diagnostics.github.state}
        detail={null}
      />
      <ServiceRow
        name="Git workspace root"
        state={diagnostics.git.state}
        detail={diagnostics.git.root ?? null}
      />
    </ul>
  )
}