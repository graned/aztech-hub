import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const dataDir = process.env.OD_DATA_DIR ?? "/app/.od";
const configPath = path.join(dataDir, "app-config.json");

let config = {};
try {
  config = JSON.parse(await readFile(configPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

const next = { ...config };
let changed = false;

if (typeof next.agentId !== "string" || next.agentId.trim() === "") {
  next.agentId = "opencode";
  changed = true;
}

if (next.onboardingCompleted !== true) {
  next.onboardingCompleted = true;
  changed = true;
}

if (changed) {
  await mkdir(dataDir, { recursive: true });
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, configPath);
  console.log(`Initialized Open Design with agent: ${next.agentId}`);
} else {
  console.log(`Open Design already configured with agent: ${next.agentId}`);
}
