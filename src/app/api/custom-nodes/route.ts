/**
 * /api/custom-nodes 路由
 *
 * GET  → 返回设置（paths）、清单摘要与上次解析报告。
 * POST → { action: "saveSettings" } 已废弃：路径现在从 ComfyUI 安装根自动推导；
 *        { action: "parse" } 跑只读的 AST 解析器，返回按包分组的报告。
 *
 * 解析器**绝不**改动已配置的 custom_nodes 路径下的任何东西 ——
 * 它只读源码文本，只写生成出来的 manifest 与报告。
 */
import { type NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { normalizeSlashes } from "~/lib/path-display";
import {
  deriveComfyuiSubdir,
  deriveComfyuiWorkflowsDir,
  getSettingsSync,
} from "~/lib/app-settings/app-settings.server";
import { readEnvVar } from "~/lib/envfile";
import { errorText } from "~/lib/error-message";
import { requireRequestUser } from "~/server/auth/request-user";
import { AppError } from "~/lib/core/errors";
import { isRecord } from "~/lib/is-record";
import type {
  DiscoveredSubpkg,
  ParseReport,
  ParseStreamEvent,
  SettingsResp,
  SettingsStreamEvent,
} from "~/lib/comfyui/custom-nodes-stream";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { apiErrorDetail } from "~/lib/api-error";
import { withTimeoutResult } from "~/lib/with-timeout";
import {
  errorResponse,
  unauthorizedResponse,
} from "~/server/lib/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANIFEST = path.join(
  process.cwd(),
  "src/generated/customNodes.manifest.json",
);
const REPORT = path.join(
  process.cwd(),
  "src/generated/customNodes.report.json",
);

/* ── 外部 JSON 的窄化工具(替代原 any)───────────────────────────
 * manifest / report / python stdout 都是外部输入,统一 unknown 进、守卫窄化读;
 * 字段值仅在非 nullish 时原样透传,回退语义与原 `?.` + `??` 完全一致。 */
/** 等价原 `src?.[key] ?? fallback`:值非 null/undefined 时原样返回,类型由调用处声明。 */
function jsonField<T>(
  src: Record<string, unknown> | null | undefined,
  key: string,
  fallback: T,
): T {
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

/* 解析自定义节点的扫描根目录。
 *  主路径：设置里配置的 ComfyUI 安装根下的 `custom_nodes` 目录（自动推导）。
 *  `.env` 的 CUSTOM_NODES_PATH 仍作为覆盖/补充项保留（向后兼容）。 */
function getPaths(): string[] {
  const derived = deriveComfyuiSubdir(
    getSettingsSync().comfyuiPath,
    "custom_nodes",
  );
  const extra = (readEnvVar("CUSTOM_NODES_PATH") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return derived ? [derived, ...extra] : extra;
}

/* 本地工作流扫描器的「伴随根目录」—— 即工作流文件从哪些目录加载。
 * 主路径：ComfyUI 安装根下的 `workflows` 目录（自动推导）；
 * `.env` 的 LOCAL_WORKFLOWS_PATH 作为补充覆盖项保留。
 * 服务端**绝不**往这些目录写东西；它只是一个只读扫描器
 *（见 localWorkflows.ts）。 */
function getLocalWorkflowPaths(): string[] {
  const derived = deriveComfyuiWorkflowsDir(getSettingsSync().comfyuiPath);
  const extra = (readEnvVar("LOCAL_WORKFLOWS_PATH") ?? "")
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return derived ? [derived, ...extra] : extra;
}

/* 汇总磁盘上的 manifest 供界面展示。同时对每个「配了、但还不是叶子包」的父路径
 * 输出探测到的子包，好让界面提示「这个目录下有 N 个子包，可以逐个解析」。
 */
function readManifestSummary() {
  if (!fs.existsSync(MANIFEST)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
    // 标量 JSON 在原 `m.packages` 处会抛 TypeError → catch → null;守卫把该行为显式化。
    if (!isRecord(parsed)) return null;
    const m = parsed;
    const pkgs: ManifestPackageSummary[] = [];
    const pmap: Record<string, unknown> = isRecord(m.packages)
      ? m.packages
      : {};
    for (const [name, info] of Object.entries(pmap)) {
      const fields: Record<string, unknown> | undefined = isRecord(info)
        ? info
        : undefined;
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
      totalNodes: Object.keys(
        jsonField<Record<string, unknown>>(m, "nodes", {}),
      ).length,
      packages: pkgs,
      missingPaths: [] as string[],
      parseErrors: jsonField<unknown[]>(m, "parseErrors", []),
      sources,
    };
  } catch {
    return null;
  }
}

/* 用绝对文件系统路径把 `summary.packages` 与 `discoveredByParent[*]` 关联起来的键。
 * 两侧都解析成绝对路径，再统一转小写并归一化分隔符，
 * 避免 Windows 的卷大小写（\?\… 这类前缀）造成对不上。 */
function pathKey(p: string): string {
  if (!p) return "";
  try {
    return normalizeSlashes(path.resolve(p)).toLowerCase();
  } catch {
    return normalizeSlashes(String(p)).toLowerCase();
  }
}

/* 构建「绝对路径 → 摘要包」映射，让界面能判断探测到的子包中
 * 哪些已经解析过、以及磁盘内容此后有没有变
 *（状态取值：已载入 / 已过期 / 出错 / 缺失）。 */
function buildPathMap(
  summary: ReturnType<typeof readManifestSummary>,
): Record<string, ManifestPackageSummary> {
  if (!summary) return {};
  const out: Record<string, ManifestPackageSummary> = {};
  for (const p of summary.packages) {
    out[pathKey(p.path)] = p;
  }
  return out;
}

/* 对一组父目录跑只读的 `discover` 模式并返回子包。
 * 做短暂缓存，因为界面上路径输入一变就会调它。 */
const discoverCache = new Map<
  string,
  { at: number; result: DiscoveredSubpkg[] }
>();

/* 缓存容量上限。必须设：键由请求体里的父目录列表拼成（外部可控），而 TTL 只在
 * 读的时候判 —— 过期的条目本身会一直留在表里，不设界就是无上限增长。 */
const DISCOVER_CACHE_MAX = 32;

/** 写缓存并把容量压回上限：超出时淘汰最早插入的键（Map 的插入序）。 */
function rememberDiscover(key: string, result: DiscoveredSubpkg[]): void {
  discoverCache.delete(key);
  discoverCache.set(key, { at: Date.now(), result });
  while (discoverCache.size > DISCOVER_CACHE_MAX) {
    const oldest = discoverCache.keys().next().value;
    if (oldest === undefined) break;
    discoverCache.delete(oldest);
  }
}

/** 单个 `discover` 进程的最长等待。解析器要扫完父目录再算一遍 hash，
 *  目录大时能到分钟级 —— 但再久也不能让请求挂到客户端超时，超时即放弃
 *  （resolve 成 null，调用方换下一个解释器 / 返回空列表）。 */
const DISCOVER_TIMEOUT_MS = 60_000;

/** 异步跑一次解析器并收集 stdout。
 *
 *  **不用 `spawnSync`**：它是同步的，会把整个 Node 事件循环连同所有并发请求
 *  一起堵住 —— 而这一步正是本路由最慢的一段。启动失败 / 非零退出 / 超时一律
 *  resolve 成 `null`，由调用方决定换解释器还是放弃。 */
function spawnCapture(command: string, args: string[]): Promise<string | null> {
  let killChild: (() => void) | undefined;

  /* 起进程并收集 stdout：启动失败 / 非零退出 / 空输出都 resolve 成 null
   *（调用方据此换下一个解释器）。 */
  const collect = new Promise<string | null>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { cwd: process.cwd(), env: process.env });
    } catch {
      // 解释器根本不存在
      resolve(null);
      return;
    }

    /* 超时由 `withTimeoutResult` 判：它赢下赛跑后经 `onTimeout` 把进程杀掉 ——
     * 否则放弃等待之后进程还在后台占着 CPU 扫目录。 */
    killChild = () => child.kill();

    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) =>
      resolve(code === 0 && stdout.length > 0 ? stdout : null),
    );
  });

  return withTimeoutResult(collect, DISCOVER_TIMEOUT_MS, null, {
    onTimeout: () => killChild?.(),
  });
}

async function runDiscover(parentDirs: readonly unknown[]): Promise<unknown[]> {
  const key = parentDirs.join("|");
  const cached = discoverCache.get(key);
  if (cached && Date.now() - cached.at < 5000) return cached.result;
  // spawn 的 args 需要 string[];原 any 同样把原始值直接交给 Node(非字符串由 Node 校验报错),
  // 断言只为恢复静态类型,不改运行时取值。
  const args = [
    "-u",
    "scripts/parse_custom_nodes.py",
    ...parentDirs.flatMap((parentDir) => [
      "--discover-parent",
      parentDir as string,
    ]),
  ];
  for (const py of ["python3", "python", "py"]) {
    const stdout = await spawnCapture(py, args);
    if (stdout === null) continue;
    try {
      const parsed: unknown = JSON.parse(stdout);
      const pkgs = (
        isRecord(parsed) && Array.isArray(parsed.packages)
          ? parsed.packages
          : []
      ) as DiscoveredSubpkg[];
      rememberDiscover(key, pkgs);
      return pkgs;
    } catch {
      // 输出不是 JSON —— 换下一个解释器再试
    }
  }
  return [];
}

/* `runDiscover` 的流式版本 —— 只为**一个**父目录起解析器进程，
 * 把每条 PROGRESS:: 行转发成 `{type:"progress"}` 事件，
 * 等到那行 JSON 回来时以最终的包列表 resolve。命中缓存则直接短路。
 *
 * 输出协议（ndjson）：
 *    {type:"progress", ...} 是进度事件（阶段 scan 或 hash，可带计数）
 *    {type:"discover_done", parent, packages, cached:false} 是收尾事件
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
  send: (ev: SettingsStreamEvent) => void,
): Promise<unknown[]> {
  const cached = discoverCache.get(parent);
  if (cached && Date.now() - cached.at < 5000) {
    send({
      type: "discover_done",
      parent,
      packages: cached.result,
      cached: true,
    });
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
          send({
            type: "progress",
            parent,
            phase: "scan",
            msg: "⚠️ 未找到 Python 解释器",
          });
          resolve([]);
        }
        return;
      }
      const py = pyCandidates[i]!;
      const cp = spawn(
        /*turbopackIgnore: true*/ py,
        ["-u", "scripts/parse_custom_nodes.py", "--discover-parent", parent],
        {
          cwd: process.cwd(),
          env: process.env,
        },
      );

      let buf = "";
      cp.stdout.on("data", (d: Buffer) => {
        buf += d.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          if (line.startsWith("PROGRESS::")) {
            // 行格式是 PROGRESS::scan|msg=...|key=value|...，
            // 或 PROGRESS::hash|msg=...|done=K|total=M。
            // 其中 `msg=` 那段是在界面副标题里显示的人读文本；
            // 其它 key=value（discovered、done、total）用来驱动进度条填充，
            // 这样界面不必去解析中文文本。
            const m = /^PROGRESS::(scan|hash)\|(.*)$/.exec(line);
            if (!m) continue;
            const phase = m[1] as "scan" | "hash";
            const rest = m[2]!;
            // 取出 msg=...（若其中含 `|` 也没关系：我们把它之后
            // 直到下一个 `|key=` 或行尾的内容整体当作 msg）。
            // 向后兼容：没有 `|msg=` 的旧格式行，就把剩余部分整体当 msg。
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
            // 以最后一行为准（解析器只在末尾打印一次结果）
            finalJson = line;
          } else {
            // 其它日志行 —— 也当作扫描进度透出去
            send({ type: "progress", parent, phase: "scan", msg: line });
          }
        }
      });
      cp.stderr.on("data", (d: Buffer) => {
        send({
          type: "progress",
          parent,
          phase: "scan",
          msg: "⚠️ " + d.toString().trim(),
        });
      });

      cp.on("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT" && i < pyCandidates.length - 1) {
          i += 1;
          tryRun();
          return;
        }
        if (!resolved) {
          resolved = true;
          send({
            type: "progress",
            parent,
            phase: "scan",
            msg: errorText(e, "⚠️ 启动解析进程失败"),
          });
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
          const parsed: unknown = finalJson
            ? JSON.parse(finalJson)
            : { packages: [] };
          const pkgs = (
            isRecord(parsed) && Array.isArray(parsed.packages)
              ? parsed.packages
              : []
          ) as DiscoveredSubpkg[];
          rememberDiscover(parent, pkgs);
          resolved = true;
          send({
            type: "discover_done",
            parent,
            packages: pkgs,
            cached: false,
          });
          resolve(pkgs);
        } catch {
          resolved = true;
          send({
            type: "progress",
            parent,
            phase: "scan",
            msg: "⚠️ 解析失败，退出码 " + code,
          });
          resolve([]);
        }
      });
    };

    tryRun();
  });
}

/* 构建流式响应：先把解析器的实时日志透出去，再给报告。
 * 传 `onlyPkgs`（具体子包路径）表示做子集 / 合并解析；
 * 否则 `paths` 就是完整的根目录列表。 */
function streamParse(paths: string[], onlyPkgs?: readonly unknown[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (ev: ParseStreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));

      const pyCandidates = ["python3", "python", "py"];
      const args = [
        "-u",
        "scripts/parse_custom_nodes.py",
        "--out",
        MANIFEST,
        "--report-out",
        REPORT,
      ];
      if (onlyPkgs?.length) {
        args.push("--only-pkgs", onlyPkgs.join(","));
      } else {
        args.push("--paths", paths.join(","));
      }
      let i = 0;
      let closed = false;

      const tryRun = () => {
        if (i >= pyCandidates.length) {
          send({
            type: "log",
            level: "error",
            msg: "未找到 Python 解释器（已尝试 python3 / python / py）",
          });
          send({
            type: "done",
            ok: false,
            report: null,
            stderr: "no python interpreter",
            exitCode: null,
          });
          controller.close();
          return;
        }
        const py = pyCandidates[i]!;
        const cp = spawn(/*turbopackIgnore: true*/ py, args, {
          cwd: process.cwd(),
          env: process.env,
        });

        cp.on("error", (e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") {
            i += 1;
            tryRun();
            return;
          }
          if (closed) return;
          closed = true;
          send({
            type: "log",
            level: "error",
            msg: errorText(e, "启动解析进程失败"),
          });
          send({
            type: "done",
            ok: false,
            report: null,
            stderr: e.message,
            exitCode: null,
          });
          controller.close();
        });

        const pipeLogs = (
          s: NodeJS.ReadableStream,
          defaultLevel: "info" | "error" = "info",
        ) => {
          let chunk = "";
          s.on("data", (d: Buffer) => {
            chunk += d.toString();
            let nl: number;
            while ((nl = chunk.indexOf("\n")) >= 0) {
              const line = chunk.slice(0, nl);
              chunk = chunk.slice(nl + 1);
              if (line.trim())
                send({ type: "log", level: defaultLevel, msg: line });
            }
          });
          s.on("end", () => {
            if (chunk.trim())
              send({ type: "log", level: defaultLevel, msg: chunk.trim() });
          });
        };
        // 解析器的 stdout 是正常进度（绿色 info）。
        // stderr 是错误（红色）—— 解析器把语法错误与一般异常经 log_stderr()
        // 写到 stderr，让对话框里的实时控制台把它们渲染成红色，
        // 而不是淹没在 300 多行成功记录里。
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
            if (fs.existsSync(REPORT))
              report = JSON.parse(fs.readFileSync(REPORT, "utf-8"));
          } catch {
            report = null;
          }
          send({
            type: "done",
            ok: !!report,
            report: report as ParseReport | null,
            stderr: "",
            exitCode: code,
          });
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
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  /* 整个只读探测包进 try/catch：此前任何一处抛错（如目录状态读取失败）会让
   * Next 返回不带 settings 的错误体，前端直接崩在
   * 前端会崩在「读取 undefined 的 paths 属性」这类报错上，
   * 真实原因反而看不到。现在错误以 { error } JSON 返回，前端可读展示。 */
  try {
    return await buildGetResponse();
  } catch (e) {
    return errorResponse(
      new AppError(
        apiErrorDetail(e, "读取配置失败"),
        "custom_nodes.read_failed",
        500,
      ),
    );
  }
}

async function buildGetResponse(): Promise<Response> {
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

  // 每个父目录都命中缓存 → 直接返回 JSON（无需进度）。
  // 否则改为流式推 ndjson，让界面渲染实时进度条。
  const allCached =
    paths.length > 0 &&
    paths.every((path) => {
      const c = discoverCache.get(path);
      return c && Date.now() - c.at < 5000;
    });
  // 两条分支都带上 localWorkflowPaths，
  // 好让设置对话框在没配 CUSTOM_NODES_PATH 时（冷路径）
  // 也能填充那个伴随字段。
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

  // 冷路径（或一个路径都没有 → 没东西可探测）：流式推 ndjson 事件。
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: SettingsStreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
      try {
        send({ type: "discover_start", parents: paths, total: paths.length });
        const discoveredByParent: Record<string, unknown[]> = {};
        for (let idx = 0; idx < paths.length; idx++) {
          const parent = paths[idx];
          send({
            type: "progress",
            parent,
            phase: "queue",
            msg: `📂 [${idx + 1}/${paths.length}] ${parent}`,
          });
          const pkgs = await runDiscoverStreaming(parent!, send);
          discoveredByParent[parent!] = pkgs;
        }
        // 把伴随的 LOCAL_WORKFLOWS_PATH 列表沿同一条流送下去，
        // 让对话框在同一次注水时就能渲染本地工作流的扫描结果。
        send({
          type: "summary",
          summary: summary as SettingsResp["summary"],
          lastReport: lastReport as ParseReport | null,
          byPath,
          settings: { paths, localWorkflowPaths },
        });
        send({ type: "done" });
      } catch (e) {
        send({ type: "error", message: apiErrorDetail(e, String(e)) });
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
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  /* 入参收窄走唯一出口（规范 16 §16.2.4.44）：此前这里是
   * `await req.json().catch(() => ({}))` —— **畸形 JSON 被静默当成空对象**，
   * 于是同一个坏请求在这里走到「action 不认识」分支、在别的路由回一句
   * 「请求格式错误」，用户看到的原因完全不同。 */
  const rec = await readJsonRecord(req);
  if (isErrorResponse(rec)) return rec;
  const action: unknown = rec.action;

  if (action === "saveSettings") {
    /* ⚠ 已废弃：自定义节点 / 本地工作流目录改由设置的 ComfyUI 路径自动推导
     *  （<comfyuiPath>/custom_nodes 与 <comfyuiPath>/workflows，见 getPaths /
     *  getLocalWorkflowPaths）。旧客户端仍可能 PUT 这两个字段 —— 这里显式
     *  拒绝写入 .env，防止残留配置重新挂上已从 UI 移除的输入框。 */
    return NextResponse.json({
      ok: true,
      paths: getPaths(),
      localWorkflowPaths: getLocalWorkflowPaths(),
    });
  }

  if (action === "parse") {
    const paths = getPaths();
    // 仅做 join(",") 透传给子进程,元素类型无需收窄(与原 any 行为逐字一致)。
    const onlyPkgs: readonly unknown[] | undefined = Array.isArray(rec.packages)
      ? rec.packages
      : undefined;
    if (onlyPkgs?.length) {
      // 子集解析 —— 不必先设置 CUSTOM_NODES_PATH
      return streamParse(paths, onlyPkgs);
    }
    if (paths.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "CUSTOM_NODES_PATH 未配置（请先填写自定义节点目录）",
        },
        { status: 400 },
      );
    }
    // 先流式推实时进度日志，再推最终报告，整体用 NDJSON。
    return streamParse(paths);
  }

  if (action === "discover") {
    const parents: unknown[] = Array.isArray(rec.parents) ? rec.parents : [];
    const result = await runDiscover(parents);
    return NextResponse.json({ ok: true, packages: result });
  }

  return NextResponse.json(
    { ok: false, error: "unknown action" },
    { status: 400 },
  );
}
