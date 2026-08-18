/**
 * localWorkflows.ts — read-only scanner for user-configured workflow directories
 * (LOCAL_WORKFLOWS_PATH).
 *
 * The configured roots are read by `scanLocalWorkflowRoots` (per-path scan, no
 * recursion outside the root itself by default — recursive=false is the safest
 * behavior; pass {recursive:true} when the user explicitly asks to walk
 * subdirectories). Every entry returned is a *file* (`.json` / `.workflow`),
 * with absolute path + size + mtime so the UI can detect "loaded but out-of-
 * date" patterns consistent with the custom-nodes manifest flow.
 *
 * Iron rule (2026-08-10 R8): these roots are NEVER written to. Only
 * `fs.readdirSync` / `fs.statSync` / `fs.createReadStream` are allowed. No
 * `fs.writeFile`, `fs.rename`, `fs.rm`, `unlink`, `appendFile`, etc. —
 * violations must be caught at code review.
 *
 * R-ardot105 (2026-08-17): `scanLocalWorkflowChecksums` returns a
 * `{absPath, checksum}` list sized for the route-layer's "rename-relink"
 * flow.  The checksum is the same SHA-1(first-16-hex-of-utf8-file) that
 * `importSource.checksum()` writes into `WorkflowTemplate.sourceChecksum`,
 * so a renamed file can be matched by content even when the original
 * `sourcePath` no longer exists.
 */
import fs from "node:fs";
import {
  createHash,
} from "node:crypto";
import path from "node:path";

export interface LocalWorkflowFile {
  /** Absolute, normalised filesystem path (lowercased + forward slashes for
   *  Windows-volume comparison). */
  absPath: string;
  /** Filename only (used as a friendly default in the pending card). */
  name: string;
  /** Raw path string the scanner saw (preserved so the UI can show the user
   *  exactly what they typed, not a re-resolved version). */
  rawPath: string;
  size: number;
  mtimeMs: number;
  /** 2026-08-10 R11: which configured LOCAL_WORKFLOWS_PATH root this file
   *  came from. Used by the API layer to stamp a `sourceRoot` on every row
   *  so the library card can label "📂 来自哪个目录" without re-doing the
   *  prefix match on the client. Equal to the root's `rawPath` (verbatim,
   *  the way the user typed it in the dialog). */
  rootRawPath: string;
  /** Resolved absolute root path (matches `rawPath` for absolute inputs,
   *  resolved relative inputs against CWD). Used by the API layer for the
   *  case-insensitive prefix check against each workflow's `sourcePath`. */
  rootAbsPath: string;
}

export interface ScannedRoot {
  /** Configured root (verbatim), used for display. */
  rawPath: string;
  /** Normalised absolute path; equal to `rawPath` when the user already typed
   *  an absolute path. Used for case-insensitive Windows comparisons. */
  absPath: string;
  exists: boolean;
  /** Per-file scan result. Empty when the root doesn't exist or contains no
   *  `.json` / `.workflow` files. NEVER an error throw — scan failures are
   *  reported via `error` (string, optional). */
  files: LocalWorkflowFile[];
  error?: string;
}

/** Normalise an absolute path the same way the rest of the server does:
 *  backslashes → forward slashes, lowercased. Mirrors `pathKey` in
 *  customNodes.ts so windows-volume case doesn't mismatch. */
function pathKey(p: string): string {
  if (!p) return "";
  try {
    return path.resolve(p).toLowerCase().replace(/\\/g, "/");
  } catch {
    return p.toLowerCase().replace(/\\/g, "/");
  }
}

/** Resolve to absolute path while preserving the original spelling for the UI
 *  to render (case-sensitive display, e.g. "C:\\Users\\…"). */
function resolve(p: string): string {
  try {
    return path.resolve(p);
  } catch {
    return p;
  }
}

/** Read one directory, filter `.json` / `.workflow` (case-insensitive),
 *  sort by name. Never throws — a missing/unreadable directory yields
 *  `{exists:false, files:[]}` (or `error` message on permission errors).
 *  `recursive` defaults to false (single-depth scan): ComfyUI's own
 *  `workflows/` directory uses subfolders like `default/`, `image/`, … which
 *  we *want* to follow — the user typically says "load everything in my
 *  workflows/ folder" by giving one root. Switch on recursion via the second
 *  arg when needed. */
function scanRoot(rawDir: string, recursive: boolean): ScannedRoot {
  const abs = resolve(rawDir);
  // Closure-set "this file came from root X" — stamped on every entry pushed
  // by `visit` so callers can show "📂 <root 短名>" without re-computing
  // the prefix match on their end. (See R11 in the daily log.)
  const stampRoot = () => ({ rootRawPath: rawDir, rootAbsPath: abs });
  if (!fs.existsSync(abs)) {
    return { rawPath: rawDir, absPath: abs, exists: false, files: [] };
  }
  try {
    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) {
      return {
        rawPath: rawDir,
        absPath: abs,
        exists: true,
        files: [],
        error: "配置的路径不是目录（指向的是一个文件）",
      };
    }
  } catch (e: any) {
    return {
      rawPath: rawDir,
      absPath: abs,
      exists: false,
      files: [],
      error: `无法访问：${e?.message ?? String(e)}`,
    };
  }

  const out: LocalWorkflowFile[] = [];
  const visit = (dir: string) => {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch (e: any) {
      out.push({
        absPath: "",
        name: `(无法读取 ${dir})`,
        rawPath: dir,
        size: 0,
        mtimeMs: 0,
        ...stampRoot(),
      });
      // Fallthrough: skip this dir on read error, continue with siblings
      // (non-recursive: nothing to do; recursive: caller decides).
      return;
    }
    for (const ent of entries) {
      const p = path.join(dir, ent);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (recursive) visit(p);
        continue;
      }
      if (!st.isFile()) continue;
      if (!/\.(json|workflow)$/i.test(ent)) continue;
      out.push({
        absPath: path.resolve(p),
        name: ent,
        rawPath: p,
        size: st.size,
        mtimeMs: st.mtimeMs,
        ...stampRoot(),
      });
    }
  };
  try {
    visit(abs);
  } catch (e: any) {
    return {
      rawPath: rawDir,
      absPath: abs,
      exists: true,
      files: out,
      error: `扫描失败：${e?.message ?? String(e)}`,
    };
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return { rawPath: rawDir, absPath: abs, exists: true, files: out };
}

/** Scan all configured roots and produce:
 *  • per-root breakdown (so the UI can show stats / missing dirs / errors);
 *  • a flat list of `LocalWorkflowFile` across every root, deduplicated by
 *    absolute path (so the user can list overlapping roots without duplicates). */
export function scanLocalWorkflowRoots(
  rawPaths: string[],
  opts: { recursive?: boolean } = {}
): { roots: ScannedRoot[]; allFiles: LocalWorkflowFile[] } {
  const recursive = !!opts.recursive;
  const seen = new Set<string>();
  const allFiles: LocalWorkflowFile[] = [];
  const roots: ScannedRoot[] = [];
  for (const p of rawPaths) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const r = scanRoot(trimmed, recursive);
    roots.push(r);
    for (const f of r.files) {
      if (!f.absPath) continue;
      const key = pathKey(f.absPath);
      if (seen.has(key)) continue;
      seen.add(key);
      allFiles.push(f);
    }
  }
  return { roots, allFiles };
}

/* ─────────────────────────────────────────────────────────────────────────
 * R-ardot105 (2026-08-17): rename-resilient re-link support.
 *
 * Goal: when a user renames a local workflow JSON on disk, the DB still
 * holds the OLD absolute path in `WorkflowTemplate.sourcePath`.  A routine
 * GET on /api/workflows would mark the row as `diskMissing=true` and the
 * library would refuse to operate the row.
 *
 * The fix is content-addressed: `importSource.checksum(text)` writes the
 * SHA-1 first-16-hex of the file's UTF-8 content into
 * `WorkflowTemplate.sourceChecksum`.  After a rename the *content* is
 * identical, so the checksum is still the same.  We scan all configured
 * LOCAL_WORKFLOWS_PATH roots, compute the same checksum for each file,
 * and let the route layer match a missing workflow back to its new home.
 *
 * Implementation choice: streaming SHA-1 (`createReadStream` + pipeline
 * into a `Hash`) so multi-MB flows don't blow the heap.  Files we can't
 * read (permission errors, vanished mid-scan) are silently skipped — the
 * rename flow is best-effort.
 * ───────────────────────────────────────────────────────────────────────── */

export interface LocalChecksumEntry {
  /** Absolute path of the on-disk file. */
  absPath: string;
  /** sha1(text).slice(0,16) — matches `WorkflowTemplate.sourceChecksum`. */
  checksum: string;
  /** File mtime in ms (epoch).  Used by callers that need to break ties
   *  between multiple files with the same checksum (rare but possible). */
  mtimeMs: number;
}

/** Same algorithm as `importSource.checksum(text)`: SHA-1 of the UTF-8
 *  text, first 16 hex characters.  Kept in sync by hand — if you change
 *  one, change the other. */
function checksumOfText(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/** Compute the checksum of a single file by streaming its contents.
 *  Resolves to `null` on any read error (permission, vanished, etc.) so
 *  the caller can skip it without aborting the whole scan. */
function checksumOfFile(absPath: string): Promise<{ checksum: string; mtimeMs: number } | null> {
  return new Promise((resolve) => {
    try {
      const stat = fs.statSync(absPath);
      if (!stat.isFile()) return resolve(null);
      const hash = createHash("sha1");
      const stream = fs.createReadStream(absPath, { encoding: "utf8" });
      stream.on("data", (chunk) => hash.update(chunk as string));
      stream.on("error", () => resolve(null));
      stream.on("end", () => resolve({ checksum: hash.digest("hex").slice(0, 16), mtimeMs: stat.mtimeMs }));
    } catch {
      resolve(null);
    }
  });
}

/** Scan every configured root and return `{absPath, checksum, mtimeMs}`
 *  for every readable `.json` / `.workflow` file.  Resolves to an empty
 *  array when no roots are configured (or every scan fails).  Errors
 *  accessing individual files are swallowed (best-effort). */
export async function scanLocalWorkflowChecksums(
  rawPaths: string[]
): Promise<LocalChecksumEntry[]> {
  const { allFiles } = scanLocalWorkflowRoots(rawPaths);
  const out: LocalChecksumEntry[] = [];
  // Concurrency cap so a 200-file scan doesn't spawn 200 streams at once.
  const MAX_PARALLEL = 8;
  let cursor = 0;
  async function worker() {
    while (cursor < allFiles.length) {
      const i = cursor++;
      const f = allFiles[i];
      if (!f.absPath) continue;
      const r = await checksumOfFile(f.absPath);
      if (r) {
        out.push({ absPath: f.absPath, checksum: r.checksum, mtimeMs: r.mtimeMs });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, allFiles.length) }, () => worker()));
  return out;
}
