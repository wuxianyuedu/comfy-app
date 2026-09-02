/**
 * /api/custom-nodes
 *
 * GET  → { settings: { paths }, summary, lastReport }
 * POST → { action: "saveSettings", paths: string[] }  writes CUSTOM_NODES_PATH to .env (read-only to source pkgs)
 *        { action: "parse" }                            runs the read-only AST parser, returns the per-package report
 *
 * The parser NEVER modifies anything under the configured custom_nodes paths —
 * it only reads source text and writes the generated manifest + report.
 */
import { type NextRequest, NextResponse } from "next/server";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readEnvVar, writeEnvVar } from "@/lib/envfile";
import { requireServerUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANIFEST = path.join(process.cwd(), "src/generated/customNodes.manifest.json");
const REPORT = path.join(process.cwd(), "src/generated/customNodes.report.json");

/* ── 外部 JSON 的窄化工具(替代原 any)───────────────────────────
 * manifest / report / python stdout 都是外部输入,统一 unknown 进、守卫窄化读;
 * 字段值仅在非 nullish 时原样透传,回退语义与原 `?.` + `??` 完全一致。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 等价原 `src?.[key] ?? fallback`:值非 null/undefined 时原样返回,类型由调用处声明。 */
function jsonField<T>(src: Record<string, unknown> | null | undefined, key: string, fallback: T): T {
  const v: unknown = src?.[key];
  return (v ?? fallback) as T;
}

/** manifest 里单个已解析包的摘要形状(与前端 SummaryPkg 消费契约一致)。 */
interface ManifestPackageSummary {
  name: string;
  path: string;
  nodeCount: number;
  nodeTypes: string[];
  status: string;
  errors: unknown[];
  contentHash: string;
  parsedAt: string | null;
  parsedFileCount: number;
  generatedAt: string | null;
}

/** 提取错误信息,等价原 `e?.message ?? fallback`。 */
function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    const msg: unknown = e.message;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

function getPaths(): string[] {
  const raw = readEnvVar("CUSTOM_NODES_PATH") ?? "";
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** 2026-08-10 R8: companion config for LOCAL_WORKFLOWS_PATH — the
 *  directory(ies) the user wants to load workflow files from. Each line
 *  (or comma-separated entry) is one absolute directory. The server NEVER
 *  writes to these; it's a pure read-only scanner (see localWorkflows.ts). */
function getLocalWorkflowPaths(): string[] {
  const raw = readEnvVar("LOCAL_WORKFLOWS_PATH") ?? "";
  return raw
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Summarize the on-disk manifest for display. Also emits discovered subpackages
 *  for every parent path that was configured but is NOT yet a leaf package, so the
 *  UI can show "here are N subpackages inside this dir, parse them individually".
 */
function readManifestSummary() {
  if (!fs.existsSync(MANIFEST)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
    // 标量 JSON 在原 `m.packages` 处会抛 TypeError → catch → null;守卫把该行为显式化。
    if (!isRecord(parsed)) return null;
    const m = parsed;
    const pkgs: ManifestPackageSummary[] = [];
    const pmap: Record<string, unknown> = isRecord(m.packages) ? m.packages : {};
    for (const [name, info] of Object.entries(pmap)) {
      const fields: Record<string, unknown> | undefined = isRecord(info) ? info : undefined;
      pkgs.push({
        name,
        path: jsonField(fields, "path", ""),
        nodeCount: jsonField(fields, "nodeCount", 0),
        nodeTypes: jsonField<string[]>(fields, "nodeTypes", []),
        status: jsonField(fields, "status", "ok"),
        errors: jsonField<unknown[]>(fields, "errors", []),
        contentHash: jsonField(fields, "contentHash", ""),
        parsedAt: jsonField<string | null>(fields, "parsedAt", null),
        parsedFileCount: jsonField(fields, "parsedFileCount", 0),
        generatedAt: jsonField<string | null>(m, "generatedAt", null),
      });
    }
    const sources: string[] = jsonField<string[]>(m, "sources", []);
    return {
      generatedAt: jsonField<string | null>(m, "generatedAt", null),
      totalNodes: Object.keys(jsonField<Record<string, unknown>>(m, "nodes", {})).length,
      packages: pkgs,
      missingPaths: [] as string[],
      parseErrors: jsonField<unknown[]>(m, "parseErrors", []),
      sources,
    };
  } catch {
    return null;
  }
}

/** Key for joining `summary.packages` and `discoveredByParent[*]` on the
 *  absolute filesystem path. Both sides resolve to absolute, then we lowercase
 *  and normalise path separators so Windows volume case (\?\…) doesn't
 *  mismatch. */
function pathKey(p: string): string {
  if (!p) return "";
  try {
    return path.resolve(p).toLowerCase().replace(/\\/g, "/");
  } catch {
    return String(p).toLowerCase().replace(/\\/g, "/");
  }
}

/** Build a `abs-path -> summary package` map the UI can use to detect
 *  which discovered subpackages have already been parsed and whether the
 *  on-disk content has changed since (status: loaded / outdated / error / missing). */
function buildPathMap(
  summary: ReturnType<typeof readManifestSummary>
): Record<string, ManifestPackageSummary> {
  if (!summary) return {};
  const out: Record<string, ManifestPackageSummary> = {};
  for (const p of summary.packages) {
    out[pathKey(p.path)] = p;
  }
  return out;
}

/** Run the read-only `discover` mode for a list of parent dirs and return subpackages.
 *  Cached briefly because the UI calls this when the path input changes. */
const discoverCache = new Map<string, { at: number; result: unknown[] }>();
function runDiscover(parentDirs: readonly unknown[]): unknown[] {
  const key = parentDirs.join("|");
  const cached = discoverCache.get(key);
  if (cached && Date.now() - cached.at < 5000) return cached.result;
  for (const py of ["python3", "python", "py"]) {
    try {
      // spawn 的 args 需要 string[];原 any 同样把原始值直接交给 Node(非字符串由 Node 校验报错),
      // 断言只为恢复静态类型,不改运行时取值。
      const args = ["-u", "scripts/parse_custom_nodes.py", ...parentDirs.flatMap((parentDir) => ["--discover-parent", parentDir as string])];
      const out = spawnSync(/*turbopackIgnore: true*/ py, args, { cwd: process.cwd(), env: process.env, encoding: "utf-8" });
      if (out.status === 0 && out.stdout) {
        const parsed: unknown = JSON.parse(out.stdout);
        const pkgs: unknown[] = isRecord(parsed) && Array.isArray(parsed.packages) ? parsed.packages : [];
        discoverCache.set(key, { at: Date.now(), result: pkgs });
        return pkgs;
      }
    } catch {
      // try next interpreter
    }
  }
  return [];
}

/** Stream variant of `runDiscover` — spawns the parser for ONE parent, forwards
 *  every PROGRESS:: line as a `{type:"progress"}` event, and resolves with the
 *  final pkgs list when the JSON line comes back. Cache hits short-circuit.
 *
 *  Output protocol (ndjson):
 *    {type:"progress", parent, phase:"scan"|"hash", msg?, discovered?, done?, total?}
 *    {type:"discover_done", parent, packages, cached:false}
 */

/** PROGRESS:: 行解析出的进度字段(msg + 可选计数,键由 kvRegex 决定)。 */
interface DiscoverProgressFields {
  phase: "scan" | "hash";
  msg: string;
  discovered?: number;
  done?: number;
  total?: number;
}

function runDiscoverStreaming(
  parent: string,
  send: (obj: unknown) => void
): Promise<unknown[]> {
  const cached = discoverCache.get(parent);
  if (cached && Date.now() - cached.at < 5000) {
    send({ type: "discover_done", parent, packages: cached.result, cached: true });
    return Promise.resolve(cached.result);
  }

  return new Promise((resolve) => {
    const pyCandidates = ["python3", "python", "py"];
    let i = 0;
    let finalJson = "";
    let resolved = false;

    const tryRun = () => {
      if (i >= pyCandidates.length) {
        if (!resolved) {
          resolved = true;
          send({ type: "progress", parent, phase: "scan", msg: "⚠️ 未找到 Python 解释器" });
          resolve([]);
        }
        return;
      }
      const py = pyCandidates[i]!;
      const cp = spawn(/*turbopackIgnore: true*/ py, ["-u", "scripts/parse_custom_nodes.py", "--discover-parent", parent], {
        cwd: process.cwd(),
        env: process.env,
      });

      let buf = "";
      cp.stdout.on("data", (d: Buffer) => {
        buf += d.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          if (line.startsWith("PROGRESS::")) {
            // Format: PROGRESS::scan|msg=...|key=value|...  or
            //         PROGRESS::hash|msg=...|done=K|total=M
            // The `msg=` segment is the human-readable text shown in the UI
            // sub-message. Other key=value pairs (discovered, done, total)
            // drive the progress bar fill so the UI doesn't have to parse
            // Chinese text.
            const m = /^PROGRESS::(scan|hash)\|(.*)$/.exec(line);
            if (!m) continue;
            const phase = m[1] as "scan" | "hash";
            const rest = m[2]!;
            // Extract msg=... (may contain | inside if any; we treat
            // everything up to the next |key= or end-of-line as the msg).
            // Backward compat: old lines without `|msg=` use the entire
            // rest as the msg.
            const fields: DiscoverProgressFields = { phase, msg: "" };
            const msgM = /\|?msg=([^|]*)/.exec(rest);
            if (msgM) {
              fields.msg = msgM[1]!;
            } else {
              fields.msg = rest;
            }
            const kvRegex = /\|?(discovered|done|total)=(\d+)/g;
            let kv: RegExpExecArray | null;
            while ((kv = kvRegex.exec(rest)) !== null) {
              const n = parseInt(kv[2]!, 10);
              const k = kv[1]!;
              if (k === "discovered") fields.discovered = n;
              else if (k === "done") fields.done = n;
              else if (k === "total") fields.total = n;
            }
            send({ type: "progress", parent, ...fields });
          } else if (line.startsWith("{")) {
            // Last JSON line wins (the parser prints the result once at the end)
            finalJson = line;
          } else {
            // Other log lines — surface as scan progress too
            send({ type: "progress", parent, phase: "scan", msg: line });
          }
        }
      });
      cp.stderr.on("data", (d: Buffer) => {
        send({ type: "progress", parent, phase: "scan", msg: "⚠️ " + d.toString().trim() });
      });

      cp.on("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT" && i < pyCandidates.length - 1) {
          i += 1;
          tryRun();
          return;
        }
        if (!resolved) {
          resolved = true;
          send({ type: "progress", parent, phase: "scan", msg: "⚠️ 启动解析进程失败：" + e.message });
          resolve([]);
        }
      });

      cp.on("close", (code) => {
        if (resolved) return;
        if (code === 127 && i < pyCandidates.length - 1) {
          i += 1;
          tryRun();
          return;
        }
        try {
          const parsed: unknown = finalJson ? JSON.parse(finalJson) : { packages: [] };
          const pkgs: unknown[] = isRecord(parsed) && Array.isArray(parsed.packages) ? parsed.packages : [];
          discoverCache.set(parent, { at: Date.now(), result: pkgs });
          resolved = true;
          send({ type: "discover_done", parent, packages: pkgs, cached: false });
          resolve(pkgs);
        } catch {
          resolved = true;
          send({ type: "progress", parent, phase: "scan", msg: "⚠️ 解析失败，退出码 " + code });
          resolve([]);
        }
      });
    };

    tryRun();
  });
}

/** Build a streaming response that pipes the parser's live logs, then the report.
 *  Pass `onlyPkgs` (specific subpackage paths) to do a subset/merge parse; otherwise
 *  `paths` is the full list of roots. */
function streamParse(paths: string[], onlyPkgs?: readonly unknown[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      const pyCandidates = ["python3", "python", "py"];
      const args = ["-u", "scripts/parse_custom_nodes.py", "--out", MANIFEST, "--report-out", REPORT];
      if (onlyPkgs?.length) {
        args.push("--only-pkgs", onlyPkgs.join(","));
      } else {
        args.push("--paths", paths.join(","));
      }
      let i = 0;
      let closed = false;

      const tryRun = () => {
        if (i >= pyCandidates.length) {
          send({ type: "log", level: "error", msg: "未找到 Python 解释器（已尝试 python3 / python / py）" });
          send({ type: "done", ok: false, report: null, stderr: "no python interpreter", exitCode: null });
          controller.close();
          return;
        }
        const py = pyCandidates[i]!;
        const cp = spawn(/*turbopackIgnore: true*/ py, args, { cwd: process.cwd(), env: process.env });

        cp.on("error", (e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") {
            i += 1;
            tryRun();
            return;
          }
          if (closed) return;
          closed = true;
          send({ type: "log", level: "error", msg: "启动解析进程失败：" + e.message });
          send({ type: "done", ok: false, report: null, stderr: e.message, exitCode: null });
          controller.close();
        });

        const pipeLogs = (s: NodeJS.ReadableStream, defaultLevel: "info" | "error" = "info") => {
          let chunk = "";
          s.on("data", (d: Buffer) => {
            chunk += d.toString();
            let nl: number;
            while ((nl = chunk.indexOf("\n")) >= 0) {
              const line = chunk.slice(0, nl);
              chunk = chunk.slice(nl + 1);
              if (line.trim()) send({ type: "log", level: defaultLevel, msg: line });
            }
          });
          s.on("end", () => {
            if (chunk.trim()) send({ type: "log", level: defaultLevel, msg: chunk.trim() });
          });
        };
        // stdout from the parser = normal progress (green info).
        // stderr from the parser = errors (red); the parser writes SyntaxError /
        // generic Exception messages to stderr via log_stderr() so the live
        // console in the dialog renders them in red instead of being lost
        // among 300+ successful file lines.
        pipeLogs(cp.stdout, "info");
        pipeLogs(cp.stderr, "error");

        cp.on("close", (code) => {
          if (closed) return;
          closed = true;
          if (code === 127 && i < pyCandidates.length - 1) {
            i += 1;
            tryRun();
            return;
          }
          let report: unknown = null;
          try {
            if (fs.existsSync(REPORT)) report = JSON.parse(fs.readFileSync(REPORT, "utf-8"));
          } catch {
            report = null;
          }
          send({ type: "done", ok: !!report, report, stderr: "", exitCode: code });
          controller.close();
        });
      };

      tryRun();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function GET() {
  const user = await requireServerUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "auth.required", message: "未登录或会话已失效" } },
      { status: 401 }
    );
  }

  const paths = getPaths();
  const localWorkflowPaths = getLocalWorkflowPaths();
  const summary = readManifestSummary();
  let lastReport: unknown = null;
  if (fs.existsSync(REPORT)) {
    try {
      lastReport = JSON.parse(fs.readFileSync(REPORT, "utf-8"));
    } catch {
      lastReport = null;
    }
  }
  const byPath = buildPathMap(summary);

  // Cache hit on every parent → return JSON immediately (no progress needed).
  // Otherwise we stream ndjson so the UI can render a live progress bar.
  const allCached = paths.length > 0 && paths.every((path) =>
{
    const c = discoverCache.get(path);
    return c && Date.now() - c.at < 5000;
  });
  // 2026-08-10 R8: include localWorkflowPaths in both branches so the
  // settings dialog can hydrate its companion field even when there's no
  // CUSTOM_NODES_PATH configured (the cold path).
  const settings = { paths, localWorkflowPaths };
  if (allCached) {
    const discoveredByParent: Record<string, unknown[]> = {};
    for (const p of paths) discoveredByParent[p] = discoverCache.get(p)!.result;
    return NextResponse.json({
      settings,
      summary,
      lastReport,
      discoveredByParent,
      byPath,
    });
  }

  // Cold path (or no paths at all → nothing to discover): stream ndjson events.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        send({ type: "discover_start", parents: paths, total: paths.length });
        const discoveredByParent: Record<string, unknown[]> = {};
        for (let idx = 0; idx < paths.length; idx++) {
          const parent = paths[idx];
          send({ type: "progress", parent, phase: "queue", msg: `📂 [${idx + 1}/${paths.length}] ${parent}` });
          const pkgs = await runDiscoverStreaming(parent!, send);
          discoveredByParent[parent!] = pkgs;
        }
        // R8: ship the companion LOCAL_WORKFLOWS_PATH list down the same
        // stream so the dialog can render the local-workflow scan results
        // at the same hydration point.
        send({
          type: "summary",
          summary,
          lastReport,
          byPath,
          settings: { paths, localWorkflowPaths },
        });
        send({ type: "done" });
      } catch (e) {
        send({ type: "error", message: errorMessage(e, String(e)) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function POST(req: NextRequest) {
  const user = await requireServerUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "auth.required", message: "未登录或会话已失效" } },
      { status: 401 }
    );
  }

  const body: unknown = await req.json().catch(() => ({}));
  const rec: Record<string, unknown> = isRecord(body) ? body : {};
  const action: unknown = rec.action;

  if (action === "saveSettings") {
    /* 2026-08-10 R8: support updating both knobs in one shot. Either
     *  field may be absent (no-op). Empty array clears the corresponding
     *  var so the user can "unset" without hand-editing .env. */
    let wroteAny = false;
    let customNodesWritten: string[] = [];
    const rawCustomNodesPaths: unknown = rec.customNodesPaths;
    if (Array.isArray(rawCustomNodesPaths) || typeof rawCustomNodesPaths === "string") {
      // Accept both shapes:
      //   • array  — [{ "a\nb" }] needs per-element split (preserves any
      //              "," inside a single path that the client already
      //              pre-split on newline), so we flatMap.
      //   • string — multi-line / comma-joined paste, single split is enough.
      const clean = Array.isArray(rawCustomNodesPaths)
        ? rawCustomNodesPaths.flatMap((path: unknown) => String(path).split(/[\n,]/))
        : String(rawCustomNodesPaths).split(/[\n,]/);
      const trimmed = clean.map((clean) => clean.trim()).filter(Boolean);
      writeEnvVar("CUSTOM_NODES_PATH", trimmed.join(","));
      customNodesWritten = trimmed;
      wroteAny = true;
    }
    let localWritten: string[] = [];
    const rawLocalWorkflowPaths: unknown = rec.localWorkflowPaths;
    if (Array.isArray(rawLocalWorkflowPaths) || typeof rawLocalWorkflowPaths === "string") {
      const clean = Array.isArray(rawLocalWorkflowPaths)
        ? rawLocalWorkflowPaths.flatMap((path: unknown) => String(path).split(/[\n,]/))
        : String(rawLocalWorkflowPaths).split(/[\n,]/);
      const trimmed = clean.map((clean) => clean.trim()).filter(Boolean);
      writeEnvVar("LOCAL_WORKFLOWS_PATH", trimmed.join(","));
      localWritten = trimmed;
      wroteAny = true;
    }
    if (!wroteAny) {
      return NextResponse.json(
        { ok: false, error: "saveSettings 需要 customNodesPaths / localWorkflowPaths 至少一项" },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      paths: customNodesWritten,
      localWorkflowPaths: localWritten,
    });
  }

  if (action === "parse") {
    const paths = getPaths();
    // 仅做 join(",") 透传给子进程,元素类型无需收窄(与原 any 行为逐字一致)。
    const onlyPkgs: readonly unknown[] | undefined = Array.isArray(rec.packages) ? rec.packages : undefined;
    if (onlyPkgs?.length) {
      // subset parse — no need for CUSTOM_NODES_PATH to be set
      return streamParse(paths, onlyPkgs);
    }
    if (paths.length === 0) {
      return NextResponse.json(
        { ok: false, error: "CUSTOM_NODES_PATH 未配置（请先填写自定义节点目录）" },
        { status: 400 }
      );
    }
    // Stream live progress logs, then the final report, as NDJSON.
    return streamParse(paths);
  }

  if (action === "discover") {
    const parents: unknown[] = Array.isArray(rec.parents) ? rec.parents : [];
    const result = runDiscover(parents);
    return NextResponse.json({ ok: true, packages: result });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
