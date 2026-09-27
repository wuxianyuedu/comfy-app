/**
 * `executor-cli-stream.ts` — comfy-cli stdout/stderr 流解析（ISSUE #570 第 5 项）
 * ===========================================================================
 *
 * 从 `executor-cli.ts` 的 `executeViaComfyCli`（473 行）里拆出来的**流处理**：
 *
 *   - {@link createCliEnvelopeParser}  stdout 的「按行聚合 JSON envelope」——
 *     buffer 累积、切行、JSON.parse、按事件类型分发（queued / envelope /
 *     error / progress / executing）。此前这段是 `child.stdout?.on("data", …)`
 *     里的 98 行内联回调，捕获 promptId / patched / finish，**只能起真进程验证**。
 *   - {@link findNodeErrorsCarrier}    在 comfy-cli 的 envelope 里深搜
 *     `node_errors`（结构化校验错误的唯一真身）。
 *   - {@link createCliStderrSink}      stderr 的「过滤噪声 + 截断 + 汇总」。
 *
 * 判据与 `lifecycle-wait.ts` 一致：**能不能在测试里直接调它**。所有宿主状态
 * （taskId、promptId 写回、finish 收口）经注入的 deps 显式传入，回调本身成了
 * 普通函数，无需真实子进程即可断言。
 */

import { trace } from "./trace";
import { INLINE_DUMP_MAX, clampText } from "~/lib/text-clamp";

/** 面板日志的注入点（同 TraceFn：默认用 runner-state 的 log，测试传收集器）。
 *  之所以经参数注入：`runner-state` 静态 import `core/repository` → DB，会让
 *  本模块无法脱离 `.env` / 数据库单测——而本项的判据正是「能不能在测试里直接
 *  调它」。 */
export type LogFn = (
  taskId: string,
  level: "info" | "warn" | "error" | "progress" | "success",
  msg: string,
) => void;
import { extractValidationErrors } from "./validation";
import type { ValidationError } from "./validation";
import type { JsonRecord } from "./raw-overrides";

/** 单次 trace 落盘的注入点（测试可换成数组收集）。 */
export type TraceFn = (
  kind: string,
  taskId: string,
  msg: string,
  data?: unknown,
) => void;

/** 非 JSON 行进入面板的上限（避免 verbose 输出刷屏）。 */
export const MAX_NON_JSON_LINES = 20;
/** 非 JSON 单行进入面板的截断上限。 */
export const NON_JSON_LINE_CHARS = 240;
/** stderr 单行进入面板的截断上限（traceback 路径很长）。 */
export const STDERR_LINE_CHARS = 400;
/** stderr 进入面板的行数上限。 */
export const STDERR_MAX_LINES = 60;
/** comfy-cli 返回的原始 JSON 行进入面板的上限（envelope 可能很大，且事件行
 *  数随节点数走；设上限防止一次失控的执行把日志面板刷成瀑布）。 */
export const MAX_RAW_JSON_LINES = 300;

/**
 * 在任意嵌套对象/数组里深搜 `node_errors`（dict 或非空 list）。
 *
 * comfy-cli 把上游 /prompt 的响应包在 `envelope` 里，而结构化校验错误
 * `node_errors` 会出现在好几个位置，取决于 comfy-cli 版本：
 *   • error.details.node_errors  → LIST（`_node_errors_to_list()` 的产物，实际到达的形态）
 *   • error.node_errors          → dict（防御）
 *   • node_errors                → dict（防御）
 *   • data/response/result.*     → 面向未来
 * 只认 `env.error.node_errors`（旧实现）永远拿不到——那个对象里根本没有这个
 * 字段（它是 {code, message, hint, details}），于是 6 条逐字段清单从未渲染。
 */
export function findNodeErrorsCarrier(root: unknown, depth = 5): unknown {
  if (!root || typeof root !== "object") return undefined;
  const seen = new WeakSet<object>();
  const stack: { node: JsonRecord; d: number }[] = [
    { node: root as JsonRecord, d: 0 },
  ];
  while (stack.length) {
    const { node, d } = stack.pop()!;
    if (d > depth || seen.has(node)) continue;
    seen.add(node);
    const ne = node.node_errors;
    if (
      ne != null &&
      (Array.isArray(ne)
        ? ne.length > 0
        : typeof ne === "object" && Object.keys(ne).length > 0)
    ) {
      return ne;
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === "object")
        stack.push({ node: v as JsonRecord, d: d + 1 });
    }
  }
  return undefined;
}

/** 从 envelope 里提取结构化校验错误（找不到载体则 undefined）。 */
export function extractEnvelopeValidationErrors(
  env: unknown,
  patched?: Record<string, unknown>,
): ValidationError[] | undefined {
  const carrier = findNodeErrorsCarrier(env);
  if (!carrier) return undefined;
  return extractValidationErrors(carrier, patched);
}

/** envelope 里错误消息的取值：message → hint → 兜底文案。 */
export function envelopeErrorMessage(env: unknown): string {
  const err =
    env != null && typeof env === "object"
      ? (env as JsonRecord).error
      : undefined;
  const str = (o: unknown, key: string): string | undefined => {
    if (o == null || typeof o !== "object") return undefined;
    const v = (o as JsonRecord)[key];
    return typeof v === "string" ? v : undefined;
  };
  return str(err, "message") ?? str(err, "hint") ?? "comfy-cli 执行失败";
}

/** comfy-cli 1.20.0 在 UI→API 转换后对照 server `object_info` 校验产生的
 *  `workflow_unknown_nodes` 错误（本仓库不产生，见 `extractEnvelopeValidationErrors`
 *  只认 `node_errors`）。错误形状是 `error.details.errors[]`，每条带
 *  `node_id` / `field` / `code` / `message` / `hint`。这里特判它，把英文原始
 *  envelope 翻成中文可操作提示，而不是把裸错误丢给用户（用户实测：节点
 *  `459:452` 的 autogrow 输入 `images` 零连线 → `autogrow_no_slots`）。
 *
 *  返回 `null` 表示不是这种错误（交给下方兜底逻辑按原样落盘）。 */
export function translateWorkflowUnknownNodesError(
  env: unknown,
): string | null {
  if (env == null || typeof env !== "object") return null;
  const err = (env as JsonRecord).error;
  if (err == null || typeof err !== "object") return null;
  if ((err as JsonRecord).code !== "workflow_unknown_nodes") return null;
  const details = (err as JsonRecord).details;
  const list =
    details != null && typeof details === "object"
      ? (details as JsonRecord).errors
      : undefined;
  if (Array.isArray(list) && list.length > 0) {
    const lines = list.slice(0, 12).map((raw) => {
      const e = raw as JsonRecord;
      const node =
        typeof e.node_id === "string" ? `节点 ${e.node_id}` : "某节点";
      const field = typeof e.field === "string" ? ` 的「${e.field}」输入` : "";
      const hint =
        typeof e.hint === "string"
          ? e.hint
          : typeof e.message === "string"
            ? e.message
            : "";
      const codeStr = typeof e.code === "string" ? e.code : "";
      const tail =
        /autogrow/i.test(codeStr) || /autogrow/i.test(hint)
          ? "（autogrow 类型需逐根连线：images.image_1、images.image_2……）"
          : "";
      return `  · ${node}${field}：${hint}${tail}`;
    });
    const more = list.length > 12 ? `\n  …还有 ${list.length - 12} 处` : "";
    return (
      "工作流校验未通过（comfy-cli 对照服务端校验），请修正后重新执行：\n" +
      lines.join("\n") +
      more
    );
  }
  const message =
    typeof (err as JsonRecord).message === "string"
      ? ((err as JsonRecord).message as string)
      : "未知校验错误";
  return `工作流校验未通过（comfy-cli 对照服务端校验）：${message}`;
}

export interface EnvelopeParserDeps {
  taskId: string;
  /** 面板日志。 */
  log: LogFn;
  /** 已应用 overrides / 剔除 UI 节点的最终工作流（校验错误定位用）。 */
  patched?: Record<string, unknown>;
  /** 收到 envelope 事件时收口（ok = envelope.ok；env = 原文）。 */
  finish: (ok: boolean, env: unknown) => void;
  /** 记下 prompt_id（写库 + 建立 prompt→task 索引由调用方做）。 */
  onPromptId: (promptId: string) => void;
  /** 进度百分比（已从 completed/total 换算）；`node` 是事件自带的当前节点
   *  步数信息（raw graph 的 class_type 在 cli 路径拿不到，label 缺省）。 */
  onProgress: (
    percent: number,
    node?: { id: string; value: number; max: number },
  ) => void;
  /** 可注入的 trace（默认全局 trace）。 */
  trace?: TraceFn;
  /** 完整原始行（不截断）收集：供前端「查看完整输出」入口。默认不收集
   *  （测试不传），生产由 executor-cli 注入 runner-state 的 appendRawCli。 */
  rawCli?: (taskId: string, line: string) => void;
}

/** stdout 解析器：喂 chunk 的回调 + 未消费尾部（进程退出时落 trace 用）。 */
export interface CliEnvelopeParser {
  sink: (chunk: Buffer | string) => void;
  /** 尚未成行的 stdout 残留（close 时落 trace，不丢现场）。 */
  leftover: () => string;
}

/**
 * 构造 stdout 的 `data` 回调：按行聚合 JSON envelope 并按类型分发。
 *
 * 返回的对象可直接喂 chunk 断言，不必起真进程 —— 这正是本项要解决的
 * 「98 行不可测闭包」。
 */
export function createCliEnvelopeParser(
  deps: EnvelopeParserDeps,
): CliEnvelopeParser {
  const doTrace = deps.trace ?? trace;
  const { taskId, log } = deps;
  let buf = "";
  let nonJsonLines = 0;
  let rawJsonLines = 0;

  const handleLine = (line: string): void => {
    if (!line) return;
    let ev: unknown = null;
    try {
      ev = JSON.parse(line);
    } catch {
      // 非 JSON 行也要露面：comfy-cli 打印 Python traceback / import error
      // 时用户才能看见。带上限，避免合法 verbose 输出刷屏。
      deps.rawCli?.(taskId, `[comfy-cli stdout] ${line}`);
      nonJsonLines++;
      doTrace("cli", taskId, "stdout 非 JSON 行", { line });
      if (nonJsonLines <= MAX_NON_JSON_LINES) {
        const trimmed =
          line.length > NON_JSON_LINE_CHARS
            ? line.slice(0, NON_JSON_LINE_CHARS) + "…"
            : line;
        log(taskId, "info", `[comfy-cli stdout] ${trimmed}`);
      } else if (nonJsonLines === MAX_NON_JSON_LINES + 1) {
        log(
          taskId,
          "info",
          `[comfy-cli stdout] …后续非 JSON 行已省略（查看后端日志）`,
        );
      }
      return;
    }
    if (!ev || typeof ev !== "object") {
      doTrace("cli", taskId, "stdout JSON 非对象", { line });
      return;
    }
    /* comfy-cli 返回的原始内容也进面板：事件行会被折叠成面向用户的摘要
     * （envelope / progress / execution_success 甚至整行不露面），排障时
     * 「ComfyUI 到底回了什么」此前只能翻 trace 文件。带行数与单行截断
     * 上限，原文仍完整落 trace。 */
    rawJsonLines++;
    /* 原始行**完整**进面板（不按单行截断）：面板把它折成一行，展开后经
     * JsonViewer 显示完整 JSON —— 排障要看被截掉的那一段（envelope 尾部的
     * 大对象、hint 里的逐节点明细）。同一份原文另存进 rawCli 缓冲，交给
     * 「查看完整输出」弹窗按需整体拉取。 */
    deps.rawCli?.(taskId, `[comfy-cli 原始] ${line}`);
    if (rawJsonLines <= MAX_RAW_JSON_LINES) {
      log(taskId, "info", `[comfy-cli 原始] ${line}`);
    } else if (rawJsonLines === MAX_RAW_JSON_LINES + 1) {
      log(
        taskId,
        "info",
        `[comfy-cli 原始] …后续原始行已省略（完整内容见后端 trace）`,
      );
    }
    /* 已解析事件也原样落 trace：面板会按事件类型折叠成一行，这里保留原文。 */
    doTrace("cli", taskId, "stdout 事件", { event: ev });
    dispatchEvent(ev as JsonRecord);
  };

  const dispatchEvent = (evt: JsonRecord): void => {
    if (
      evt.type === "queued" &&
      typeof evt.prompt_id === "string" &&
      evt.prompt_id
    ) {
      deps.onPromptId(evt.prompt_id);
      // 与 API 路径的「✓ 已接收…等待 executing」措辞对齐，两条提交路径
      // 在日志面板里是同一套词汇。
      log(
        taskId,
        "info",
        `✓ comfy-cli 已提交（prompt_id: ${evt.prompt_id}），等待节点执行…`,
      );
      return;
    }
    if (evt.type === "envelope") {
      deps.finish(Boolean(evt.ok), evt);
      return;
    }
    if (evt.type === "error") {
      /* 显式 error 事件（非 envelope）：完整落盘，否则只剩「未收到
       * envelope」这类结论，看不到 CLI 自己的原因。 */
      doTrace("cli", taskId, "error 事件", { event: evt, promptId: null });
      log(
        taskId,
        "warn",
        `[comfy-cli] error 事件${typeof evt.message === "string" ? `：${evt.message}` : ""}`,
      );
      return;
    }
    if (
      evt.type === "progress" &&
      typeof evt.completed === "number" &&
      typeof evt.total === "number" &&
      evt.total > 0
    ) {
      // 3-C D1：SSE 单源化后进度必须落库，node 一并透出给调用方写 progressNode
      const nodeId = typeof evt.node === "string" ? evt.node : undefined;
      deps.onProgress(
        Math.round((evt.completed / evt.total) * 100),
        nodeId
          ? { id: nodeId, value: evt.completed, max: evt.total }
          : undefined,
      );
      return;
    }
    if (evt.type === "executing" || evt.type === "execution_success") {
      // 原样转发 CLI 事件，给到「按节点」的可见性（拿不到原始 raw graph 的
      // class_type UUID，但节点 id + 事件类型足以显示「有东西在跑」）。
      const node = (evt.node ??
        (evt.data as JsonRecord | null | undefined)?.node ??
        "?") as string;
      log(
        taskId,
        "info",
        evt.type === "execution_success"
          ? `✓ comfy-cli 节点 [${node}] 执行完成`
          : `▶ comfy-cli 节点 [${node}] 开始执行`,
      );
    }
  };

  return {
    sink: (chunk: Buffer | string) => {
      /* 原始 chunk 直送 trace（不截断不聚合）——面板只显示解析后的事件，
       * 出现「没找到生成结果」时唯一能回答「ComfyUI 到底回了什么」的就是这里。 */
      doTrace("cli", taskId, "stdout 原始输出", { chunk: String(chunk) });
      buf += String(chunk);
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        handleLine(line);
      }
    },
    leftover: () => buf,
  };
}

export interface StderrSinkDeps {
  taskId: string;
  /** 面板日志。 */
  log: LogFn;
  trace?: TraceFn;
  /** 完整原始行（不截断）收集：供前端「查看完整输出」入口。 */
  rawCli?: (taskId: string, line: string) => void;
}

/** stderr 汇总态：调用方在 close 时读 `summary()` 落 tail。 */
export interface StderrSink {
  sink: (chunk: Buffer | string) => void;
  /** 完整 stderr 原文（不截断，close 时 tail 用）。 */
  raw: () => string;
  /** 噪声行数（Python Deprecation/Syntax 警告）。 */
  noisyWarningLines: () => number;
}

const NOISY_WARNING_RE =
  /DeprecationWarning|SyntaxWarning: invalid escape sequence/i;

/**
 * 构造 stderr 的 `data` 回调：实时把 traceback 显示到面板（而不是只在
 * close 时），同时过滤第三方噪声、限行数、单行截断。
 */
export function createCliStderrSink(deps: StderrSinkDeps): StderrSink {
  const doTrace = deps.trace ?? trace;
  const { taskId, log } = deps;
  let errBuf = "";
  let errLines = 0;
  let noisy = 0;
  const sink = (chunk: Buffer | string): void => {
    const d = String(chunk);
    /* 原始 chunk 直送 trace——面板只显示前 60 行且过滤噪声，真正的
     * traceback 尾部（异常类 + 行号）必须完整可查。 */
    doTrace("cli", taskId, "stderr 原始输出", { chunk: d });
    errBuf += d;
    for (const line of d.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (NOISY_WARNING_RE.test(trimmed)) {
        noisy++;
        continue;
      }
      errLines++;
      deps.rawCli?.(taskId, `[comfy-cli stderr] ${trimmed}`);
      if (errLines <= STDERR_MAX_LINES) {
        const t =
          trimmed.length > STDERR_LINE_CHARS
            ? trimmed.slice(0, STDERR_LINE_CHARS) + "…"
            : trimmed;
        log(taskId, "warn", `[comfy-cli stderr] ${t}`);
      } else if (errLines === STDERR_MAX_LINES + 1) {
        log(
          taskId,
          "warn",
          `[comfy-cli stderr] …后续行已省略（完整内容在进程退出汇总）`,
        );
      }
    }
  };
  return { sink, raw: () => errBuf, noisyWarningLines: () => noisy };
}

/* ── envelope 收口（finish）────────────────────────────────────────────
 * 这是 `executeViaComfyCli` 里另一段内联逻辑：收到 envelope（或进程退出）
 * 时决定「完成 / 失败」，并在失败时把结构化校验错误逐条落日志。
 * `settle` 由调用方注入（幂等守卫 + 清 guard + 摘 cliProcs 表）。
 */

export interface CliFinisherDeps {
  taskId: string;
  /** 面板日志。 */
  log: LogFn;
  /** 已应用 overrides / 剔除 UI 节点的最终工作流（定位错误节点用）。 */
  patched?: Record<string, unknown>;
  /** 幂等收口守卫：第一次返回 true（并做好清理），重复调用返回 false。 */
  settle: () => boolean;
  /** 当前 promptId（可能在收口前才拿到，故为取值函数）。 */
  promptId: () => string | null;
  /** 成功收口。**注入**而不是直接 import `executor-finalize`：那个模块经
   *  `core/repository` 拖进 DB / `.env`，会让本模块无法脱离环境单测。 */
  complete: (taskId: string, promptId: string) => void;
  /** 失败收口（第 4 参为结构化校验错误）。 */
  fail: (
    taskId: string,
    promptId: string,
    detail: string,
    validationErrors?: ValidationError[],
  ) => void;
}

export type CliFinisher = (ok: boolean, env: unknown) => void;

/** 构造 envelope 收口函数（完成 / 失败 + 校验错误落日志）。 */
export function createCliFinisher(deps: CliFinisherDeps): CliFinisher {
  const { taskId, log } = deps;
  return (ok: boolean, env: unknown) => {
    if (!deps.settle()) return;
    if (ok) {
      deps.complete(taskId, deps.promptId() ?? "");
      return;
    }
    const msg = envelopeErrorMessage(env);
    const validationErrors = extractEnvelopeValidationErrors(env, deps.patched);
    let translated: string | null = null;
    if (validationErrors?.length) {
      // 与 API 路径一致：把结构化清单汇总成一行，再交给 fail() 让 UI 渲染
      // 成逐字段红框。
      log(
        taskId,
        "error",
        `✗ comfy-cli 报 ${validationErrors.length} 条校验错误（见上方红框）`,
      );
      validationErrors.slice(0, 12).forEach((ve) => {
        log(
          taskId,
          "error",
          `  · 节点 ${ve.nodeId}${ve.classType ? ` (${ve.classType})` : ""}` +
            (ve.field ? ` · 字段 ${ve.field}` : "") +
            `：${ve.message}`,
        );
      });
      if (validationErrors.length > 12) {
        log(
          taskId,
          "error",
          `  …还有 ${validationErrors.length - 12} 条（请查看红框/重新执行工作流查看完整清单）`,
        );
      }
    } else {
      // comfy-cli 1.20.0 的 `workflow_unknown_nodes` 校验错误（对照 server
      // object_info）走的是 error.details.errors，本仓库的 node_errors 深搜
      // 拿不到，故特判并翻成中文可操作提示，而不是把裸英文 envelope 丢给用户。
      translated = translateWorkflowUnknownNodesError(env);
      if (translated) {
        log(taskId, "error", translated);
      } else {
        // 兜底：消息说「validation error」但深搜没找到结构化 node_errors。
        // 把原始 envelope（截断）落盘，支持现场能看到真实形状，而不是只剩
        // 一句「Workflow has N validation error(s)」。
        const rawMsg = msg;
        const err =
          env != null && typeof env === "object"
            ? (env as JsonRecord).error
            : undefined;
        const errCode =
          err != null && typeof err === "object"
            ? (err as JsonRecord).code
            : undefined;
        if (/validation error/i.test(rawMsg) || errCode === "prompt_rejected") {
          try {
            const dump = clampText(JSON.stringify(env), {
              maxLength: INLINE_DUMP_MAX,
              marker: "",
            });
            log(
              taskId,
              "warn",
              `⚠ 未从 comfy-cli envelope 解析出结构化校验错误，原始 envelope（截断）：${dump}`,
            );
          } catch {
            /* stringify 可能因循环引用抛错 —— 忽略 */
          }
        }
      }
    }
    deps.fail(
      taskId,
      deps.promptId() ?? "",
      translated ?? msg,
      validationErrors,
    );
  };
}
