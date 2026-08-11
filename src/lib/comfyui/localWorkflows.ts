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
 * `fs.readdirSync` / `fs.statSync` are allowed. No `fs.writeFile`,
 * `fs.rename`, `fs.rm`, `unlink`, `appendFile`, etc. — violations
 * must be caught at code review.
 */
import fs from "node:fs";
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
