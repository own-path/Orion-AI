import fs from "node:fs/promises";
import path from "node:path";

function parseEnvLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const idx = trimmed.indexOf("=");
  if (idx <= 0) {
    return null;
  }
  const key = trimmed.slice(0, idx).trim();
  const value = trimmed.slice(idx + 1).trim();
  if (!key) {
    return null;
  }
  return { key, value };
}

export async function readEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const entries = {};
    for (const line of raw.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (parsed) {
        entries[parsed.key] = parsed.value;
      }
    }
    return entries;
  } catch {
    return {};
  }
}

export async function writeEnvFile(filePath, entries) {
  const rows = Object.entries(entries)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${String(value)}`);
  await fs.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {});
  await fs.writeFile(filePath, `${rows.join("\n")}\n`, "utf8");
}

export function mergeEnvEntries(existing, patch) {
  return {
    ...existing,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined)
    )
  };
}
