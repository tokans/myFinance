import { isTauri } from "@/lib/environment";
import { stringify } from "yaml";

const DEBUG_LOG_DIR = "debug-logs";

/**
 * Writes a diagnostic YAML dump of a document-import parse (raw extracted
 * rows, the classified result, the parse log) to `<AppData>/debug-logs/` —
 * local-only, never transmitted, same as every other on-device file this app
 * writes. Lets a real-world parse failure be inspected after the fact from
 * the raw geometry (cell text + x-position) rather than guesswork, without
 * copy/pasting sensitive data through chat. Best-effort: swallows all errors
 * and never blocks the actual import flow.
 */
export async function writeDebugDump(kind: string, payload: unknown): Promise<void> {
  if (!isTauri()) return;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    await fs.mkdir(DEBUG_LOG_DIR, { baseDir: fs.BaseDirectory.AppData, recursive: true }).catch(() => undefined);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const text = stringify(payload, { indent: 2 });
    await fs.writeFile(`${DEBUG_LOG_DIR}/${stamp}-${kind}.yaml`, new TextEncoder().encode(text), {
      baseDir: fs.BaseDirectory.AppData,
    });
  } catch {
    // Best-effort diagnostics only — never let a dump failure block a real import.
  }
}
