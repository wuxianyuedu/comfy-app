/**
 * envfile.ts — minimal, dependency-free reader/writer for the project `.env`.
 *
 * Used by the custom-nodes settings API so the user can configure
 * CUSTOM_NODES_PATH from the UI instead of hand-editing `.env`.
 *
 * - Reads `.env.local` first, then `.env` (mirrors Next.js precedence), so a
 *   value set in `.env` is returned even if `.env.local` is absent.
 * - Writing only touches the line `KEY=...` (or appends it), preserving every
 *   other line, comments, and ordering. Never rewrites the whole file.
 */
import fs from "node:fs";
import path from "node:path";

function envPath(name: string): string {
  return path.join(process.cwd(), name);
}

/** Read a single var from .env.local / .env on disk (not process.env). */
export function readEnvVar(key: string): string | null {
  for (const file of [".env.local", ".env"]) {
    const p = envPath(file);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf-8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
      if (m && m[1] === key) {
        let v = m[2];
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        return v;
      }
    }
  }
  return null;
}

/** Write (or update) a single var in `.env`, preserving the rest of the file. */
export function writeEnvVar(key: string, value: string): void {
  const p = envPath(".env");
  let lines: string[] = [];
  if (fs.existsSync(p)) lines = fs.readFileSync(p, "utf-8").split("\n");

  const idx = lines.findIndex((l) => l.match(new RegExp(`^\\s*${key}\\s*=`)));
  const newLine = `${key}=${value}`;
  if (idx >= 0) {
    lines[idx] = newLine;
  } else {
    if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
    lines.push(newLine);
  }
  // Join with \n and ensure a single trailing newline.
  const out = lines.join("\n").replace(/\n+$/, "") + "\n";
  fs.writeFileSync(p, out, "utf-8");
}
