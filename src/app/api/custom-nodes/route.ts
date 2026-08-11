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
import { NextRequest, NextResponse } from "next/server";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readEnvVar, writeEnvVar } from "@/lib/envfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANIFEST = path.join(process.cwd(), "src/generated/customNodes.manifest.json");
const REPORT = path.join(process.cwd(), "src/generated/customNodes.report.json");

function getPaths(): string[] {
  const raw = readEnvVar("CUSTOM_NODES_PATH") || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 2026-08-10 R8: companion config for LOCAL_WORKFLOWS_PATH — the
 *  directory(ies) the user wants to load workflow files from. Each line
 *  (or comma-separated entry) is one absolute directory. The server NEVER
 *  writes to these; it's a pure read-only scanner (see localWorkflows.ts). */
function getLocalWorkflowPaths(): string[] {
  const raw = readEnvVar("LOCAL_WORKFLOWS_PATH") || "";
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Summarize the on-disk manifest for display. Also emits discovered subpackages
 *  for every parent path that was configured but is NOT yet a leaf package, so the
 *  UI can show "here are N subpackages inside this dir, parse them individually".
 */
function readManifestSummary() {
  if (!fs.existsSync(MANIFEST)) return null;
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
    const pkgs: any[] = [];
    const pmap = m.packages || {};
    for (const [name, info] of Object.entries<any>(pmap)) {
      pkgs.push({
        name,
        path: info?.path || "",
        nodeCount: info?.nodeCount ?? 0,
        nodeTypes: info?.nodeTypes ?? [],
        status: info?.status || "ok",
        errors: info?.errors || [],
        contentHash: info?.contentHash || "",
        parsedAt: info?.parsedAt || null,
        parsedFileCount: info?.parsedFileCount ?? 0,
        generatedAt: m.generatedAt || null,
      });
    }
    const sources: string[] = m.sources || [];
    return {
      generatedAt: m.generatedAt || null,
      totalNodes: Object.keys(m.nodes || {}).length,
      packages: pkgs,
      missingPaths: [],
      parseErrors: m.parseErrors || [],
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
function buildPathMap(summary: ReturnType<typeof readManifestSummary>): Record<string, any> {
  if (!summary) return {};
  const out: Record<string, any> = {};
  for (const p of summary.packages) {
    out[pathKey(p.path)] = p;
  }
  return out;
}

/** Run the read-only `discover` mode for a list of parent dirs and return subpackages.
 *  Cached briefly because the UI calls this when the path input changes. */
const discoverCache = new Map<string, { at: number; result: any[] }>();
function runDiscover(parentDirs: string[]): any[] {
  const key = parentDirs.join("|");
  const cached = discoverCache.get(key);
  if (cached && Date.now() - cached.at < 5000) return cached.result;
  for (const py of ["python3", "python", "py"]) {
    try {
      const args = ["-u", "scripts/parse_custom_nodes.py", ...parentDirs.flatMap((d) => ["--discover-parent", d])];
      const out = spawnSync(py, args, { cwd: process.cwd(), env: process.env, encoding: "utf-8" });
      if (out.status === 0 && out.stdout) {
        const j = JSON.parse(out.stdout);
        const pkgs = j.packages || [];
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
 *    {type:"progress", parent, phase:"scan"|"hash"|"queue", msg?, discovered?, done?, total?}
 *    {type:"discover_done", parent, packages, cached:false}
 */
function runDiscoverStreaming(
  parent: string,
  send: (obj: any) => void
): Promise<any[]> {
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
      const py = pyCandidates[i];
      const cp = spawn(py, ["-u", "scripts/parse_custom_nodes.py", "--discover-parent", parent], {
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
            const rest = m[2];
            // Extract msg=... (may contain | inside if any; we treat
            // everything up to the next |key= or end-of-line as the msg).
            // Backward compat: old lines without `|msg=` use the entire
            // rest as the msg.
            const fields: Record<string, any> = { phase };
            const msgM = /\|?msg=([^|]*)/.exec(rest);
            if (msgM) {
              fields.msg = msgM[1];
            } else {
              fields.msg = rest;
            }
            const kvRegex = /\|?(discovered|done|total)=(\d+)/g;
            let kv: RegExpExecArray | null;
            while ((kv = kvRegex.exec(rest)) !== null) {
              fields[kv[1]] = parseInt(kv[2], 10);
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
          const j = finalJson ? JSON.parse(finalJson) : { packages: [] };
          const pkgs = j.packages || [];
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
function streamParse(paths: string[], onlyPkgs?: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      const pyCandidates = ["python3", "python", "py"];
      const args = ["-u", "scripts/parse_custom_nodes.py", "--out", MANIFEST, "--report-out", REPORT];
      if (onlyPkgs && onlyPkgs.length) {
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
        const py = pyCandidates[i];
        const cp = spawn(py, args, { cwd: process.cwd(), env: process.env });

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
          let report: any = null;
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
  const paths = getPaths();
  const localWorkflowPaths = getLocalWorkflowPaths();
  const summary = readManifestSummary();
  let lastReport: any = null;
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
  const allCached = paths.length > 0 && paths.every((p) => {
    const c = discoverCache.get(p);
    return c && Date.now() - c.at < 5000;
  });
  // 2026-08-10 R8: include localWorkflowPaths in both branches so the
  // settings dialog can hydrate its companion field even when there's no
  // CUSTOM_NODES_PATH configured (the cold path).
  const settings = { paths, localWorkflowPaths };
  if (allCached) {
    const discoveredByParent: Record<string, any[]> = {};
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
        const discoveredByParent: Record<string, any[]> = {};
        for (let idx = 0; idx < paths.length; idx++) {
          const parent = paths[idx];
          send({ type: "progress", parent, phase: "queue", msg: `📂 [${idx + 1}/${paths.length}] ${parent}` });
          const pkgs = await runDiscoverStreaming(parent, send);
          discoveredByParent[parent] = pkgs;
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
      } catch (e: any) {
        send({ type: "error", message: e?.message || String(e) });
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
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === "saveSettings") {
    /* 2026-08-10 R8: support updating both knobs in one shot. Either
     *  field may be absent (no-op). Empty array clears the corresponding
     *  var so the user can "unset" without hand-editing .env. */
    let wroteAny = false;
    let customNodesWritten: string[] = [];
    if (Array.isArray(body.customNodesPaths) || typeof body.customNodesPaths === "string") {
      // Accept both shapes:
      //   • array  — [{ "a\nb" }] needs per-element split (preserves any
      //              "," inside a single path that the client already
      //              pre-split on newline), so we flatMap.
      //   • string — multi-line / comma-joined paste, single split is enough.
      // body.customNodesPaths is loosely typed (req.json() → any); cast the
      // array branch to string[] so flatMap's callback type is inferred.
      const clean = Array.isArray(body.customNodesPaths)
        ? (body.customNodesPaths as string[]).flatMap((s) => String(s).split(/[\n,]/))
        : String(body.customNodesPaths).split(/[\n,]/);
      const trimmed = clean.map((s) => s.trim()).filter(Boolean);
      writeEnvVar("CUSTOM_NODES_PATH", trimmed.join(","));
      customNodesWritten = trimmed;
      wroteAny = true;
    }
    let localWritten: string[] = [];
    if (Array.isArray(body.localWorkflowPaths) || typeof body.localWorkflowPaths === "string") {
      const clean = Array.isArray(body.localWorkflowPaths)
        ? (body.localWorkflowPaths as string[]).flatMap((s) => String(s).split(/[\n,]/))
        : String(body.localWorkflowPaths).split(/[\n,]/);
      const trimmed = clean.map((s) => s.trim()).filter(Boolean);
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
    const onlyPkgs: string[] | undefined = Array.isArray(body.packages) ? body.packages : undefined;
    if (onlyPkgs && onlyPkgs.length) {
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
    const parents: string[] = Array.isArray(body.parents) ? body.parents : [];
    const result = runDiscover(parents);
    return NextResponse.json({ ok: true, packages: result });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
