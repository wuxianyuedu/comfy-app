/**
 * /api/custom-nodes 路由：GET 返回设置（paths）、清单摘要与上次解析报告；POST
 * { action: "parse" } 跑只读 AST 解析器（saveSettings 已废弃，路径从 ComfyUI 安装根自动推导）。
 * 解析器绝不改动 custom_nodes 路径下的东西——只读源码文本，只写生成的 manifest 与报告。
 */
import { type NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { normalizeSlashes } from "~/lib/path-display";
import { createStreamChildGuard, safeSpawnArg, spawnCapture } from "./python-child";
import { MANIFEST, readManifestSummary, type ManifestPackageSummary } from "./manifest-summary";
import {
  deriveComfyuiSubdir,
  deriveComfyuiWorkflowsDir,
  getSettingsSync,
} from "~/lib/app-settings/app-settings.server";
import { readEnvVar } from "~/lib/envfile";
import { errorText } from "~/lib/error-message";
import {
  forEachOutputLine,
  isInterpreterMiss,
  missingInterpreterMessage,
  pythonAttempts,
} from "~/lib/process/python-run";
import { requireRequestUser } from "~/server/auth/request-user";
import { AppError } from "~/lib/core/errors";
import type {
  DiscoveredSubpkg,
  ParseReport,
  ParseStreamEvent,
  SettingsStreamEvent,
} from "~/lib/comfyui/custom-nodes-stream";
import { isParseReport, readDiscoveredPackages } from "./parse-guards";
import { isErrorResponse, readJsonRecord } from "~/server/lib/request-body";
import { apiErrorDetail } from "~/lib/api-error";
import { errorResponse, unauthorizedResponse } from "~/server/lib/error-response";
import { rejectCrossOriginWrite } from "~/server/lib/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPORT = path.join(process.cwd(), "src/generated/customNodes.report.json");

/* 解析自定义节点的扫描根目录。
 *  主路径：设置里配置的 ComfyUI 安装根下的 `custom_nodes` 目录（自动推导）。
 *  `.env` 的 CUSTOM_NODES_PATH 仍作为覆盖/补充项保留（向后兼容）。 */
function getPaths(): Array<string> {
  const derived = deriveComfyuiSubdir(getSettingsSync().comfyuiPath, "custom_nodes");
  const extra = (readEnvVar("CUSTOM_NODES_PATH") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return derived !== null && derived !== "" ? [derived, ...extra] : extra;
}

/* 本地工作流扫描器的「伴随根目录」—— 即工作流文件从哪些目录加载。
 * 主路径：ComfyUI 安装根下的 `workflows` 目录（自动推导）；
 * `.env` 的 LOCAL_WORKFLOWS_PATH 作为补充覆盖项保留。
 * 服务端**绝不**往这些目录写东西；它只是一个只读扫描器
 *（见 localWorkflows.ts）。 */
function getLocalWorkflowPaths(): Array<string> {
  const derived = deriveComfyuiWorkflowsDir(getSettingsSync().comfyuiPath);
  const extra = (readEnvVar("LOCAL_WORKFLOWS_PATH") ?? "")
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return derived !== null && derived !== "" ? [derived, ...extra] : extra;
}

/* 用绝对文件系统路径把 `summary.packages` 与 `discoveredByParent[*]` 关联起来的键。
 * 两侧都解析成绝对路径，再统一转小写并归一化分隔符，
 * 避免 Windows 的卷大小写（\?\… 这类前缀）造成对不上。 */
function pathKey(p: string): string {
  if (!p) {
    return "";
  }
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
  if (!summary) {
    return {};
  }
  const out: Record<string, ManifestPackageSummary> = {};
  for (const p of summary.packages) {
    out[pathKey(p.path)] = p;
  }
  return out;
}

/* 对一组父目录跑只读的 `discover` 模式并返回子包。
 * 做短暂缓存，因为界面上路径输入一变就会调它。 */
const discoverCache = new Map<string, { at: number; result: Array<DiscoveredSubpkg> }>();

/* 缓存容量上限。必须设：键由请求体里的父目录列表拼成（外部可控），而 TTL 只在
 * 读的时候判 —— 过期的条目本身会一直留在表里，不设界就是无上限增长。 */
const DISCOVER_CACHE_MAX = 32;

/** 写缓存并把容量压回上限：超出时淘汰最早插入的键（Map 的插入序）。 */
function rememberDiscover(key: string, result: Array<DiscoveredSubpkg>): void {
  discoverCache.delete(key);
  discoverCache.set(key, { at: Date.now(), result });
  while (discoverCache.size > DISCOVER_CACHE_MAX) {
    const oldest = discoverCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    discoverCache.delete(oldest);
  }
}

async function runDiscover(parentDirs: ReadonlyArray<string>): Promise<Array<unknown>> {
  const key = parentDirs.join("|");
  const cached = discoverCache.get(key);
  if (cached && Date.now() - cached.at < 5000) {
    return cached.result;
  }
  // spawn 的 args 需要 string[];调用点已把父目录收敛为 string[],这里直接透传。
  const args = [
    "-u",
    "scripts/parse_custom_nodes.py",
    ...parentDirs.flatMap((parentDir) => ["--discover-parent", parentDir]),
  ];
  /* 候选名与顺序**不在这里写**（台账 A14）：字面量表一旦落在调用点，`py` 就少一个 `-3`，
   * 而 Windows 上的第一候选也不是 `python3`。见 `~/lib/process/python-run`。 */
  for (const attempt of pythonAttempts(args)) {
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
    const stdout = await spawnCapture(attempt.command, attempt.args);
    if (stdout === null) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(stdout);
      const pkgs = readDiscoveredPackages(parsed);
      rememberDiscover(key, pkgs);
      return pkgs;
    } catch {
      // 输出不是 JSON —— 换下一个解释器再试
    }
  }
  return [];
}

/* `runDiscover` 的流式版本：只为一个父目录起解析器进程，PROGRESS:: 行转发成
 * `{type:"progress"}` 事件，最终 JSON 回来时以包列表 resolve；命中缓存直接短路。
 * 输出协议（ndjson）：progress（阶段 scan/hash，可带计数）+ 收尾 discover_done。 */

/** PROGRESS:: 行解析出的进度字段(msg + 可选计数,键由 kvRegex 决定)。 */
type DiscoverProgressFields = {
  discovered?: number;
  done?: number;
  msg: string;
  phase: "scan" | "hash";
  total?: number;
};

const DISCOVER_PHASES: ReadonlyArray<DiscoverProgressFields["phase"]> = ["scan", "hash"];

function runDiscoverStreaming(
  parent: string,
  send: (ev: SettingsStreamEvent) => void,
  signal?: AbortSignal,
): Promise<Array<unknown>> {
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
    /* 退避链整体取自判据（台账 A14）：顺序按平台给，`py` 那一档自动带 `-3`。 */
    const attempts = pythonAttempts([
      "-u",
      "scripts/parse_custom_nodes.py",
      "--discover-parent",
      parent,
    ]);
    let i = 0;
    let finalJson = "";
    let resolved = false;

    /* 看门狗 + 断开回收（#4004）：超时 / 客户端断开都杀整棵子进程树，本父目录按
     * 「0 个包」降级，后续父目录照常扫——此前进程卡住时整条流永久挂着。 */
    const guard = createStreamChildGuard({
      label: `自定义节点探测（${parent}）`,
      signal,
      onGiveUp: (reason) => {
        if (resolved) {
          return;
        }
        resolved = true;
        send({ type: "progress", parent, phase: "scan", msg: `⚠️ ${reason}` });
        resolve([]);
      },
    });

    const tryRun = () => {
      /* `.at()` 越界即 `undefined`：取候选与「有没有候选」判据合成一处。 */
      const attempt = attempts.at(i);
      if (!attempt) {
        if (!resolved) {
          resolved = true;
          guard.settle();
          send({
            type: "progress",
            parent,
            phase: "scan",
            msg: `⚠️ ${missingInterpreterMessage()}`,
          });
          resolve([]);
        }
        return;
      }
      /* 本档是否已把退避交给下一候选：真机上 `spawn` 失败会先报 `error`、随后再发一次
       * `close`，少了这个守卫，没起来的进程的 `close` 会把「空结果」定成最终答案，真跑成的
       * 那档被丢掉（Windows 第一候选缺位时「扫描到 0 个节点」，台账 A14）。 */
      let handedOff = false;
      const cp = spawn(/*turbopackIgnore: true*/ attempt.command, attempt.args, {
        cwd: process.cwd(),
        env: process.env,
      });
      /* 句柄登记进看门狗：退避链换档时覆盖为当前子进程。 */
      guard.track(cp);

      forEachOutputLine(cp.stdout, (line) => {
        if (line.startsWith("PROGRESS::")) {
          // 行格式是 PROGRESS::scan|msg=...|key=value|...，
          // 或 PROGRESS::hash|msg=...|done=K|total=M。
          // 其中 `msg=` 那段是在界面副标题里显示的人读文本；
          // 其它 key=value（discovered、done、total）用来驱动进度条填充，
          // 这样界面不必去解析中文文本。
          const m = /^PROGRESS::(?<phase>scan|hash)\|(?<rest>.*)$/.exec(line);
          if (!m) {
            return;
          }
          const phase = DISCOVER_PHASES.find((candidate) => candidate === m[1]);
          if (phase === undefined) {
            return;
          }
          const rest = m[2]!;
          // 取出 msg=...（若其中含 `|` 也没关系：我们把它之后
          // 直到下一个 `|key=` 或行尾的内容整体当作 msg）。
          // 向后兼容：没有 `|msg=` 的旧格式行，就把剩余部分整体当 msg。
          const fields: DiscoverProgressFields = { phase, msg: "" };
          const msgM = /\|?msg=(?<msg>[^|]*)/.exec(rest);
          if (msgM) {
            fields.msg = msgM.groups?.msg ?? "";
          } else {
            fields.msg = rest;
          }
          const kvRegex = /\|?(?<key>discovered|done|total)=(?<value>\d+)/g;
          let kv: RegExpExecArray | null;
          while ((kv = kvRegex.exec(rest)) !== null) {
            const n = Number.parseInt(kv.groups?.value ?? "", 10);
            const k = kv.groups?.key ?? "";
            if (k === "discovered") {
              fields.discovered = n;
            } else if (k === "done") {
              fields.done = n;
            } else if (k === "total") {
              fields.total = n;
            }
          }
          send({ type: "progress", parent, ...fields });
        } else if (line.startsWith("{")) {
          // 以最后一行为准（解析器只在末尾打印一次结果）
          finalJson = line;
        } else {
          // 其它日志行 —— 也当作扫描进度透出去
          send({ type: "progress", parent, phase: "scan", msg: line });
        }
      });
      /* stderr 也按行切，与解析口那条链同形：整块一次透出会把两行警告挤成
       * 事件里一句带换行的文案，界面上只显示第一行。 */
      forEachOutputLine(cp.stderr, (line) => {
        send({
          type: "progress",
          parent,
          phase: "scan",
          msg: `⚠️ ${line}`,
        });
      });

      cp.on("error", (e: NodeJS.ErrnoException) => {
        if (handedOff || resolved) {
          return;
        }
        /* 退避**不写数字边界**：链的长度就是边界，越界由 `attempts.at(i)` 兜住。
         * 写成 `length - 1` 会让最后一个候选永远轮不到，那句「未找到 Python 解释器」
         * 因此不可达 —— 真机没装 Python 的表现就退化成「0 个节点、一句原因都没有」。 */
        if (isInterpreterMiss({ errno: e.code })) {
          handedOff = true;
          i += 1;
          tryRun();
          return;
        }
        if (!resolved) {
          resolved = true;
          guard.settle();
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
        if (resolved || handedOff) {
          return;
        }
        /* 与上面 `error` 那一支**同因**（内核里就是同一条判据）：127 是「命令不存在」在
         * Windows 上的另一形状，它必须与 ENOENT 给出同一句原因，而不是悄悄回一个空列表。 */
        if (isInterpreterMiss({ exitCode: code })) {
          handedOff = true;
          i += 1;
          tryRun();
          return;
        }
        /* 走到这就是最终收尾（成功或失败二选一）：拆掉看门狗，别让定时器空挂到点。 */
        guard.settle();
        try {
          const parsed: unknown = finalJson ? JSON.parse(finalJson) : { packages: [] };
          const pkgs = readDiscoveredPackages(parsed);
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
            msg: `⚠️ 解析失败，退出码 ${code}`,
          });
          resolve([]);
        }
      });
    };

    tryRun();
  });
}

/* 构建流式响应：先透出实时日志再给报告；`onlyPkgs` 表示子集/合并解析。 */
function streamParse(
  paths: Array<string>,
  onlyPkgs?: Array<string>,
  signal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  /* 收尾标志放函数级：看门狗的 onGiveUp 与 cancel 都要判它（先声明后引用）。 */
  let closed = false;
  /* 看门狗在 start 里装配（要拿 controller）；cancel 走这个引用兜底。 */
  let guard: ReturnType<typeof createStreamChildGuard> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeClose = () => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          controller.close();
        } catch {
          /* 已关闭/已取消 */
        }
      };
      const send = (ev: ParseStreamEvent) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
        } catch {
          closed = true;
        }
      };
      guard = createStreamChildGuard({
        label: "自定义节点解析",
        signal,
        onGiveUp: (reason) => {
          if (closed) {
            return;
          }
          try {
            controller.enqueue(
              encoder.encode(
                `${JSON.stringify({ type: "log", level: "error", msg: reason } satisfies ParseStreamEvent)}\n`,
              ),
            );
            controller.enqueue(
              encoder.encode(
                `${JSON.stringify({ type: "done", ok: false, report: null, stderr: reason, exitCode: null } satisfies ParseStreamEvent)}\n`,
              ),
            );
            controller.close();
          } catch {
            /* 流已被取消 / 关闭：子进程回收本身已完成，帧发不出去就算了。 */
          } finally {
            closed = true;
          }
        },
      });

      const scriptArgs = [
        "-u",
        "scripts/parse_custom_nodes.py",
        "--out",
        MANIFEST,
        "--report-out",
        REPORT,
      ];
      if (onlyPkgs !== undefined && onlyPkgs.length > 0) {
        scriptArgs.push("--only-pkgs", onlyPkgs.join(","));
      } else {
        scriptArgs.push("--paths", paths.join(","));
      }
      /* 退避链整体取自判据（台账 A14）：本文件此前在这里第三度自写候选表，
       * 于是 Windows 上从 `python3` 起、且命中 `py` 那一档不带 `-3`。 */
      const attempts = pythonAttempts(scriptArgs);
      let i = 0;

      const tryRun = () => {
        /* 同 `runDiscoverStreaming`：`.at()` 越界即 `undefined`，
         * 取候选与「有没有候选」判据合成一处。 */
        const attempt = attempts.at(i);
        if (!attempt) {
          guard?.settle();
          send({
            type: "log",
            level: "error",
            msg: missingInterpreterMessage(),
          });
          send({
            type: "done",
            ok: false,
            report: null,
            stderr: "no python interpreter",
            exitCode: null,
          });
          safeClose();
          return;
        }
        /* 见 `runDiscoverStreaming` 里那段同名的守卫：真机上缺解释器是 `error` 之后
         * **还会再来一次 `close`**，那一趟不许把「没有报告」定成最终答案。 */
        let handedOff = false;
        const cp = spawn(/*turbopackIgnore: true*/ attempt.command, attempt.args, {
          cwd: process.cwd(),
          env: process.env,
        });
        /* 句柄登记进看门狗：退避链换档时覆盖为当前子进程。 */
        guard?.track(cp);

        cp.on("error", (e: NodeJS.ErrnoException) => {
          if (handedOff || closed) {
            return;
          }
          if (isInterpreterMiss({ errno: e.code })) {
            handedOff = true;
            i += 1;
            tryRun();
            return;
          }
          if (closed) {
            return;
          }
          guard?.settle();
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
          safeClose();
        });

        /* 按行切分交给内核（与探测口同一份行切分语义）。 */
        const pipeLogs = (s: NodeJS.ReadableStream, defaultLevel: "info" | "error" = "info") => {
          forEachOutputLine(s, (line) => {
            send({ type: "log", level: defaultLevel, msg: line });
          });
        };
        // stdout 为进度(info)，stderr 为错误(error)，便于界面区分渲染。
        pipeLogs(cp.stdout, "info");
        pipeLogs(cp.stderr, "error");

        cp.on("close", (code) => {
          if (closed || handedOff) {
            return;
          }
          /* 这一处有两个顺序要紧：
           *   · 退避**不写数字边界**（与上面 `error` 那一支同一条判据、同一个理由）；
           *   · 收尾标志只能在「本次真要收尾」这一支里置 —— 压在退避判断之前，
           *     换档之后下一档进程的 `close` 就会在第一行守卫处返回，
           *     报告与 `done` 一个都发不出来，流一直挂着（没有超时那一档兜它）。 */
          if (isInterpreterMiss({ exitCode: code })) {
            handedOff = true;
            i += 1;
            tryRun();
            return;
          }
          guard?.settle();
          let report: ParseReport | null = null;
          try {
            if (fs.existsSync(REPORT)) {
              const parsed: unknown = JSON.parse(fs.readFileSync(REPORT, "utf8"));
              report = isParseReport(parsed) ? parsed : null;
            }
          } catch {
            report = null;
          }
          send({
            type: "done",
            ok: report !== null,
            report,
            stderr: "",
            exitCode: code,
          });
          safeClose();
        });
      };

      tryRun();
    },
    cancel() {
      /* 消费方中途弃流：把还挂着的解析子进程一并回收（#4004；客户端断开在 Next 里
       * 主要走 req.signal abort，这里兜住其余取消路径）。 */
      guard?.killNow("解析流被取消，回收解析子进程");
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

export async function GET(req: NextRequest) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }

  /* 整个只读探测包进 try/catch：此前任何一处抛错（如目录状态读取失败）会让
   * Next 返回不带 settings 的错误体，前端直接崩在
   * 前端会崩在「读取 undefined 的 paths 属性」这类报错上，
   * 真实原因反而看不到。现在错误以 { error } JSON 返回，前端可读展示。 */
  try {
    return buildGetResponse(req.signal);
  } catch (error) {
    return errorResponse(
      new AppError(apiErrorDetail(error, "读取配置失败"), "custom_nodes.read_failed", 500),
    );
  }
}

function buildGetResponse(signal?: AbortSignal): Response {
  const paths = getPaths();
  const localWorkflowPaths = getLocalWorkflowPaths();
  const summary = readManifestSummary();
  let lastReport: ParseReport | null = null;
  if (fs.existsSync(REPORT)) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(REPORT, "utf8"));
      lastReport = isParseReport(parsed) ? parsed : null;
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
      return c !== undefined && Date.now() - c.at < 5000;
    });
  // 两条分支都带上 localWorkflowPaths，
  // 好让设置对话框在没配 CUSTOM_NODES_PATH 时（冷路径）
  // 也能填充那个伴随字段。
  const settings = { paths, localWorkflowPaths };
  if (allCached) {
    const discoveredByParent: Record<string, Array<unknown>> = {};
    /* `allCached` 已逐个查过缓存，这里的 `?? []` 只是让类型与判据同一处
     * 落地（真出现空说明 `allCached` 那次判定与本次读取之间缓存被清了）。 */
    for (const p of paths) {
      discoveredByParent[p] = discoverCache.get(p)?.result ?? [];
    }
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
      let closed = false;
      const send = (ev: SettingsStreamEvent) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
        } catch {
          closed = true;
        }
      };
      try {
        send({ type: "discover_start", parents: paths, total: paths.length });
        const discoveredByParent: Record<string, Array<unknown>> = {};
        /* 遍历本身就是「取元素 + 收窄类型」：写 `paths[idx]` 就得多一次
         * `!` 把 `noUncheckedIndexedAccess` 加上的 `undefined` 抹掉。 */
        let idx = 0;
        for (const parent of paths) {
          idx += 1;
          send({
            type: "progress",
            parent,
            phase: "queue",
            msg: `📂 [${idx}/${paths.length}] ${parent}`,
          });
          // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
          discoveredByParent[parent] = await runDiscoverStreaming(parent, send, signal);
        }
        // 把伴随的 LOCAL_WORKFLOWS_PATH 列表沿同一条流送下去，
        // 让对话框在同一次注水时就能渲染本地工作流的扫描结果。
        send({
          type: "summary",
          summary,
          lastReport,
          byPath,
          settings: { paths, localWorkflowPaths },
        });
        send({ type: "done" });
      } catch (error) {
        send({ type: "error", message: apiErrorDetail(error, String(error)) });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* 已关闭/已取消 */
          }
        }
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
  /* 同源闸（#4723）：写端点统一入口，判据见 ~/server/lib/same-origin。 */
  const crossOrigin = rejectCrossOriginWrite(req);
  if (crossOrigin !== null) {
    return crossOrigin;
  }

  /* 入参收窄走唯一出口（规范 16 §16.2.4.44）：此前这里是
   * `await req.json().catch(() => ({}))` —— **畸形 JSON 被静默当成空对象**，
   * 于是同一个坏请求在这里走到「action 不认识」分支、在别的路由回一句
   * 「请求格式错误」，用户看到的原因完全不同。 */
  const rec = await readJsonRecord(req);
  if (isErrorResponse(rec)) {
    return rec;
  }
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
    const rawPkgs = Array.isArray(rec.packages) ? rec.packages : undefined;
    let onlyPkgs: Array<string> | undefined;
    if (rawPkgs !== undefined && rawPkgs.length > 0) {
      const sanitized: Array<string> = [];
      for (const p of rawPkgs) {
        const s = safeSpawnArg(p);
        if (s === null) {
          return NextResponse.json({ ok: false, error: "invalid package entry" }, { status: 400 });
        }
        sanitized.push(s);
      }
      onlyPkgs = sanitized;
    }
    if (onlyPkgs !== undefined && onlyPkgs.length > 0) {
      // 子集解析 —— 不必先设置 CUSTOM_NODES_PATH
      return streamParse(paths, onlyPkgs, req.signal);
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
    return streamParse(paths, undefined, req.signal);
  }

  if (action === "discover") {
    const parentsRaw = Array.isArray(rec.parents) ? rec.parents : [];
    const parents: Array<string> = [];
    for (const p of parentsRaw) {
      const s = safeSpawnArg(p);
      if (s === null) {
        return NextResponse.json({ ok: false, error: "invalid parent path" }, { status: 400 });
      }
      parents.push(s);
    }
    /* 空批不去起解释器：避免空目录/畸形入参白跑三轮 Python 退避。 */
    if (parents.length === 0) {
      return NextResponse.json({ ok: true, packages: [] });
    }
    const result = await runDiscover(parents);
    return NextResponse.json({ ok: true, packages: result });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
