import "server-only"

export function getOpenCodeWebUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  return env["OPENCODE_WEB_URL"] ?? "http://coding.localhost"
}

export function encodeOpenCodeDirectory(directory: string): string {
  return Buffer.from(directory, "utf8").toString("base64url")
}

export function buildOpenCodeWebUrl(
  directory: string,
  sessionID?: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const baseUrl = getOpenCodeWebUrl(env).replace(/\/+$/, "")
  const directoryPath = encodeOpenCodeDirectory(directory)
  const sessionPath = sessionID === undefined ? "session" : `session/${encodeURIComponent(sessionID)}`
  return `${baseUrl}/${directoryPath}/${sessionPath}`
}
