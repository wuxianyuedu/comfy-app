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
import "server-only";
import fs from "node:fs";
import path from "node:path";

function envPath(name: string): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), name);
}

/** Read a single var from .env.local / .env on disk (not process.env). */
export function readEnvVar(key: string): string | null {
  for (const file of [".env.local", ".env"]) {

    const fullPath = envPath(file);

    if (!fs.existsSync(fullPath)) continue;

    const text = fs.readFileSync(fullPath, "utf-8");

    for (const line of text.split("\n")) {


      const match = /^\s*([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);


      if (match?.[1] === key) {



        let value = match[2]!;



        if (



          (value.startsWith('"') && value.endsWith('"')) ||



          (value.startsWith("'") && value.endsWith("'"))



        ) {



          value = value.slice(1, -1);



        }



        return value;



      }



    }


  }

  return null;
}

/** Write (or update) a single var in `.env`, preserving the rest of the file. */
export function writeEnvVar(key: string, value: string): void {

  const fullPath = envPath(".env");

  let lines: string[] = [];

  if (fs.existsSync(fullPath)) lines = fs.readFileSync(fullPath, "utf-8").split("\n");



  const idx = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).exec(line));

  const newLine = `${key}=${value}`;

  if (idx >= 0) {

    lines[idx] = newLine;

  } else {

    if (lines.length && lines[lines.length - 1]!.trim() !== "") lines.push("");

    lines.push(newLine);

  }

  // Join with \n and ensure a single trailing newline.

  const out = lines.join("\n").replace(/\n+$/, "") + "\n";

  fs.writeFileSync(fullPath, out, "utf-8");

}

