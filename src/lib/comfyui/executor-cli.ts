/**
 * `executor-cli.ts` — comfy-cli 执行路径（raw UI-format 工作流）
 * ===========================================================================
 *
 * 从 executor.ts 拆出的「comfy-cli 提交路径」模块（batch 4）：
 *   - {@link cliProcs}          正在运行的 comfy-cli 子进程表（供取消）
 *   - {@link executeViaComfyCli} raw UI-format 工作流提交 + stdout 事件收割
 *   - {@link applyRawOverrides}  把 canvas 的 workflowInputs 注入 raw json
 *
 * Raw UI-format workflows（liblib subgraph wrapper 的 `rawJson` 带 UUID
 * `class_type`）无法直接 POST 给 ComfyUI，交给 comfy-cli 做客户端侧
 * UI→API 转换 + 子图展开；成功/失败统一走 executor-finalize 的收口。
 *
 * @module comfyui/executor-cli
 */
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { taskRepository } from "../core/repository";
import { resolveComfyBase } from "./client";
import { extractValidationErrors } from "./validation";
import type { ValidationError } from "./validation";
import { state, log } from "./runner-state";
import type { Job, RawWorkflowOverride } from "./runner-state";
import { complete, fail } from "./executor-finalize";

export const cliProcs = new Map<string, ChildProcess>();
const CLI_TIMEOUT_MS = 25 * 60 * 1000;

/** 任意 JSON 对象的宽松视图（外部输入的中间层窄化用）。 */
type JsonRecord = Record<string, unknown>;

/**
 * Raw UI-format（LiteGraph）节点输入槽的最小结构视图 —— 字段随节点类型
 * 漂移，只取本模块读写（`name` / `widget`）的部分，其余原样保留。
 */
export type RawUiNodeInput = {
  name?: unknown;
  widget?: unknown;
};

/**
 * Raw UI-format（LiteGraph）节点的最小结构视图 —— 只取注入
 * `widgets_values` 所需的字段（`id` / `inputs` / `widgets_values`）。
 */
export type RawUiNode = {
  id?: unknown;
  inputs?: RawUiNodeInput[];
  widgets_values?: unknown[];
};

/** Map an API-format node id (e.g. "76:67") or top-level id to the raw UI node. */
function resolveRawNode(raw: JsonRecord, nodeId: string): RawUiNode | null {
  const defs = raw.definitions;
  const subs =
    defs != null && typeof defs === "object" ? (defs as JsonRecord).subgraphs : undefined;
  const subList: unknown[] = Array.isArray(subs)
    ? subs
    : subs != null && typeof subs === "object"
      ? Object.values(subs)
      : [];
  const findInNodes = (nodes: unknown, id: string): RawUiNode | null => {
    if (!Array.isArray(nodes)) return null;
    for (const x of nodes) {
      if (x != null && typeof x === "object" && String((x as JsonRecord).id) === id) {
        return x as RawUiNode;
      }
    }
    return null;
  };
  if (nodeId.includes(":")) {
    const internalId = nodeId.split(":").pop()!;
    for (const sg of subList) {
      const nodes =
        sg != null && typeof sg === "object" ? (sg as JsonRecord).nodes : undefined;
      const n = findInNodes(nodes, internalId);
      if (n) return n;
    }
    return null;
  }
  const top = findInNodes(raw.nodes, nodeId);
  if (top) return top;
  for (const sg of subList) {
    const nodes =
      sg != null && typeof sg === "object" ? (sg as JsonRecord).nodes : undefined;
    const n = findInNodes(nodes, nodeId);
    if (n) return n;
  }
  return null;
}

/** Index of a named widget input within a UI node's `widgets_values` array. */
function widgetSlot(node: RawUiNode, name: string): number {
  const inputs = node?.inputs ?? [];
  let slot = 0;
  for (const inp of inputs) {
    if (inp?.widget) {
      if (inp.name === name) return slot;
      slot++;
    }
  }
  return -1;
}

/** Best-effort injection of canvas `workflowInputs` into the raw UI json. */
export function applyRawOverrides(
  rawJson: unknown,
  overrides?: RawWorkflowOverride[]
): JsonRecord {
  if (!overrides?.length) return rawJson as JsonRecord;
  const raw = JSON.parse(JSON.stringify(rawJson)) as JsonRecord;
  for (const ov of overrides) {
    if (!ov?.nodeId || ov.value === undefined) continue;
    const node = resolveRawNode(raw, ov.nodeId);
    if (!node) continue;

    // Seed "control after generate" is NOT a named widget in raw UI format — it
    // is serialized as the widgets_values slot immediately after the seed widget.
    // Resolve the seed widget slot and target slot+1. (API-format graphs instead
    // carry a real `control_after_generate` input, handled by the name branch.)
    if (ov.name === "control_after_generate") {
      const seedSlot = seedWidgetSlot(node);
      if (seedSlot < 0) continue;
      if (!Array.isArray(node.widgets_values)) node.widgets_values = [];
      node.widgets_values[seedSlot + 1] = ov.value;
      continue;
    }

    const slot = widgetSlot(node, ov.name);
    if (slot < 0) continue;
    if (!Array.isArray(node.widgets_values)) node.widgets_values = [];
    node.widgets_values[slot] = ov.value;
  }
  return raw;
}

/** Index of the seed-type widget within a UI node's `widgets_values` array.
 *  Returns -1 when the node has no seed-like widget. */
function seedWidgetSlot(node: RawUiNode): number {
  const inputs = node?.inputs ?? [];
  let slot = 0;
  for (const inp of inputs) {
    if (!inp?.widget) continue;
    const w = inp.widget;
    const wname =
      typeof w === "string"
        ? w
        : w != null && typeof w === "object"
          ? (w as JsonRecord).name ?? inp.name
          : inp.name;
    if (typeof wname === "string" && /seed|noise_seed/i.test(wname)) return slot;
    slot++;
  }
  return -1;
}

/** Read a string field off an unknown payload（非 string → undefined）。 */
function strField(o: unknown, key: string): string | undefined {
  if (o == null || typeof o !== "object") return undefined;
  const v = (o as JsonRecord)[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * 部分第三方节点（如 rgthree 的 Fast Groups Bypasser / Muter）是纯 UI 控制节点，
 * 没有后端实现，不会出现在 ComfyUI 的 object_info 中。comfy-cli 做 UI→API 转换后
 * 向 /prompt 校验时会因 unknown_class_type 整单失败。提交前把它们从 raw UI-format
 * 工作流里剔除即可：它们不携带数据流，只影响画布分组显隐。
 */
const UI_ONLY_NODE_TYPES = new Set([
  "Fast Groups Bypasser (rgthree)",
  "Fast Groups Muter (rgthree)",
  "Fast Groups Bookmarker (rgthree)",
]);

function stripUiOnlyNodes(raw: JsonRecord): JsonRecord {
  if (!Array.isArray(raw.nodes)) return raw;
  const removedIds = new Set<string>();
  const filtered: unknown[] = [];
  for (const n of raw.nodes) {
    if (n == null || typeof n !== "object") {
      filtered.push(n);
      continue;
    }
    const node = n as JsonRecord;
    const type = strField(node, "type") ?? strField(node, "class_type");
    if (type && UI_ONLY_NODE_TYPES.has(type)) {
      const rawId = node.id;
      const id =
        typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : undefined;
      if (id) removedIds.add(id);
      continue;
    }
    filtered.push(n);
  }
  if (removedIds.size === 0) return raw;
  raw.nodes = filtered;
  // 同时清理 LiteGraph links 中与被删节点相关的连接（格式：
  // [linkId, originNodeId, originSlot, targetNodeId, targetSlot, type]）
  if (Array.isArray(raw.links)) {
    raw.links = raw.links.filter((link) => {
      if (!Array.isArray(link)) return true;
      const origin = String(link[1] ?? "");
      const target = String(link[3] ?? "");
      return !removedIds.has(origin) && !removedIds.has(target);
    });
  }
  return raw;
}

export async function executeViaComfyCli(job: Job) {
  const s = state();
  const { taskId, rawJson, overrides } = job;
  // the entry line of the raw path so the
  // user can see in the log panel exactly which method is handling
  // their task.  Before this it was silent until the first stdout
  // JSON event arrived (often 5-30s in, the Python venv boot).
  log(taskId, "info", `→ executeViaComfyCli 入口（raw UI-format）`);
  const base = await resolveComfyBase();
  let host = "127.0.0.1";
  let port = 8188;
  try {
    const u = new URL(base);
    host = u.hostname === "localhost" ? "127.0.0.1" : u.hostname;
    port = parseInt(u.port) || 8188;
  } catch { /* keep defaults */ }
  log(taskId, "info", `ComfyUI 目标：${host}:${port}（${base}）`);

  let patched = applyRawOverrides(rawJson, overrides);
  const nodeCountBefore = Array.isArray(patched.nodes) ? patched.nodes.length : 0;
  patched = stripUiOnlyNodes(patched);
  const nodeCountAfter = Array.isArray(patched.nodes) ? patched.nodes.length : 0;
  if (nodeCountAfter !== nodeCountBefore) {
    log(
      taskId,
      "info",
      `已剔除 ${nodeCountBefore - nodeCountAfter} 个纯 UI 控制节点（无后端实现），避免 comfy-cli 校验失败`
    );
  }
  /* 临时工作流文件统一放到项目根目录 temp/comfy-cli/，便于清理和跨平台管理。 */
  const tmpDir = path.join(process.cwd(), "temp", "comfy-cli");
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `wf-${taskId}.json`);
  log(taskId, "info", `写入临时工作流文件：${tmpFile}`);
  await fs.writeFile(tmpFile, JSON.stringify(patched), "utf-8");
  // 记下本次实际提交给 ComfyUI 的 workflow（liblib
  // subgraph 未展开格式），任务完成落盘为 workflow.json 供完整复现。
  s.executedWorkflow.set(taskId, patched);
  log(
    taskId,
    "info",
    `工作流文件就绪（${Object.keys(patched?.nodes ?? {}).length || Object.keys(patched).length} 节点）`
  );

  const binDir = process.platform === "win32" ? "Scripts" : "bin";
  const pyName = process.platform === "win32" ? "python.exe" : "python";
  /* Python 虚拟环境放在项目根目录 python-venv/comfy-cli，便于安装、升级和统一配置。
   * 可通过 COMFY_CLI_PYTHON 环境变量覆盖，指向已有的 Python 解释器。 */
  const defaultPy = path.join(
    process.cwd(),
    "python-venv",
    "comfy-cli",
    binDir,
    pyName
  );
  const py = process.env.COMFY_CLI_PYTHON ?? defaultPy;
  const args = [
    "-m", "comfy_cli", "run",
    "--workflow", tmpFile,
    "--json", "--wait",
    "--where", "local",
    "--host", host,
    "--port", String(port),
    "--no-notify",
    "--timeout", "600",
  ];

  // 提前检查 Python 解释器是否存在，避免把原始 ENOENT 抛给用户
  try {
    await fs.access(py, fs.constants.F_OK);
  } catch {
    const winHint =
      "请在项目根目录执行：\n" +
      "  python -m venv python-venv\\comfy-cli\n" +
      "  python-venv\\comfy-cli\\Scripts\\python.exe -m pip install --upgrade pip\n" +
      "  python-venv\\comfy-cli\\Scripts\\python.exe -m pip install comfy-cli\n" +
      "或设置环境变量 COMFY_CLI_PYTHON 指向已有的 Python 解释器。";
    const nixHint =
      "请在项目根目录执行：\n" +
      "  python3 -m venv python-venv/comfy-cli\n" +
      "  python-venv/comfy-cli/bin/pip install --upgrade pip\n" +
      "  python-venv/comfy-cli/bin/pip install comfy-cli\n" +
      "或设置环境变量 COMFY_CLI_PYTHON 指向已有的 Python 解释器。";
    const hint = process.platform === "win32" ? winHint : nixHint;
    log(taskId, "error", `未找到 comfy-cli Python 解释器：${py}\n${hint}`);
    void fail(taskId, "", `未找到 comfy-cli Python 解释器：${py}`);
    return;
  }

  // surface the literal comfy-cli command so
  // the user (and we, on support) can reproduce the exact invocation
  // from the log panel without digging through devtools.
  log(
    taskId,
    "info",
    `comfy-cli 执行 raw 工作流（${host}:${port}）`
  );
  log(taskId, "info", `  ${pyName} ${args.join(" ")}`);
  // explicit pre-spawn line so the user
  // sees a "→ 启动" marker before the (potentially slow) Python
  // boot.  Without this, the first log on a raw submission was
  // "comfy-cli 执行 raw 工作流" + a long silence, which looks
  // indistinguishable from a hang.
  log(taskId, "info", `→ 启动 comfy-cli 进程（raw UI-format → API 转换）`);
  s.emitter.emit(taskId, {
    type: "log",
    entry: { t: Date.now(), level: "info", msg: "已使用 comfy-cli 提交 raw 工作流" },
  });

  let promptId: string | null = null;
  let settled = false;

  const child = spawn(/*turbopackIgnore: true*/ py, args, {
    cwd: process.cwd(),
    env: { ...process.env, DO_NOT_TRACK: "1", COMFY_CLI_NO_TELEMETRY: "1" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  cliProcs.set(taskId, child);
  log(
    taskId,
    "info",
    `comfy-cli 进程已启动（pid=${child.pid ?? "?"}，等待 stdout…）`
  );

  const guard = setTimeout(() => {
    if (settled) return;
    settled = true;
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    cliProcs.delete(taskId);
    void fail(taskId, promptId ?? "", "comfy-cli 执行超时（看门狗）");
  }, CLI_TIMEOUT_MS);

  // flatten /prompt errors returned via
  // comfy-cli's envelope into a structured `validationErrors[]` and
  // pass them to `fail()` as the 4th arg, mirroring the API-format
  // branch at line ~1226.  comfy-cli ships the upstream /prompt
  // response under `env.error`; we look for `node_errors` first, then
  // fall back to the message string.  Without this, the user only
  // ever saw "Workflow has N validation error(s) against server"
  // with no per-field breakdown, and the "↻ 重新执行" hint for
  // re-running to populate structure was a no-op (re-running the
  // SAME workflow would produce the SAME envelope with the SAME
  // unflattened payload).
  // comfy-cli wraps the upstream /prompt
  // payload in an `envelope`. The structured `node_errors` lands at
  // several possible positions depending on the comfy-cli version:
  //   • error.details.node_errors  → LIST of records (this is what
  //     `_node_errors_to_list()` produces and what actually reaches us)
  //   • error.node_errors          → dict (defensive)
  //   • node_errors                → dict (defensive)
  //   • data/response/result.*     → future-proofing
  // A single `env.error.node_errors` check (the old code) only ever saw
  // {code, message, hint, details} — which has NO `node_errors` — so the
  // 6-item per-field list never rendered.  Deep-search the envelope for
  // `node_errors` (dict or list) and hand it to extractValidationErrors,
  // which now accepts both shapes.
  const findNodeErrorsCarrier = (root: unknown, depth = 5): unknown => {
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
        if (v && typeof v === "object") stack.push({ node: v as JsonRecord, d: d + 1 });
      }
    }
    return undefined;
  };

  const extractEnvelopeValidationErrors = (env: unknown): ValidationError[] | undefined => {
    const carrier = findNodeErrorsCarrier(env);
    if (!carrier) return undefined;
    return extractValidationErrors(carrier, patched);
  };

  const finish = (ok: boolean, env: unknown) => {
    if (settled) return;
    settled = true;
    clearTimeout(guard);
    cliProcs.delete(taskId);
    if (ok) {
      void complete(taskId, promptId ?? "");
    } else {
      const err = env != null && typeof env === "object" ? (env as JsonRecord).error : undefined;
      const msg =
        (strField(err, "message") ?? strField(err, "hint")) ?? "comfy-cli 执行失败";
      const validationErrors = extractEnvelopeValidationErrors(env);
      if (validationErrors?.length) {
        // Mirror the API-format branch's behaviour: surface the
        // structured list in a single log line for the user, then
        // pass it to fail() so the UI can render a per-field block.
        log(
          taskId,
          "error",
          `✗ comfy-cli 报 ${validationErrors.length} 条校验错误（见上方红框）`
        );
        validationErrors.slice(0, 12).forEach((ve) => {
          log(
            taskId,
            "error",
            `  · 节点 ${ve.nodeId}${ve.classType ? ` (${ve.classType})` : ""}` +
              (ve.field ? ` · 字段 ${ve.field}` : "") +
              `：${ve.message}`
          );
        });
        if (validationErrors.length > 12) {
          log(
            taskId,
            "error",
            `  …还有 ${validationErrors.length - 12} 条（请查看红框/重新执行工作流查看完整清单）`
          );
        }
      } else {
        // Comprehensive-detection safety net: the message
        // says "validation error" but the deep search found no
        // structured `node_errors`.  Dump the raw envelope (truncated)
        // so a support re-run can see the real shape instead of a
        // silent "Workflow has N validation error(s)" line.
        const rawMsg = typeof msg === "string" ? msg : "";
        if (/validation error/i.test(rawMsg) || strField(err, "code") === "prompt_rejected") {
          try {
            const dump = JSON.stringify(env).slice(0, 900);
            log(
              taskId,
              "warn",
              `⚠ 未从 comfy-cli envelope 解析出结构化校验错误，原始 envelope（截断）：${dump}`
            );
          } catch {
            /* stringify can throw on circular refs — ignore */
          }
        }
      }
      void fail(taskId, promptId ?? "", msg, validationErrors);
    }
  };

  let buf = "";
  let nonJsonLines = 0;
  child.stdout?.setEncoding("utf-8");
  child.stdout?.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let ev: unknown = null;
      try { ev = JSON.parse(line); } catch {
        // surface non-JSON lines too so the
        // user can see when comfy-cli prints a Python traceback or
        // import error.  Cap to avoid flooding the panel during
        // legitimate verbose output.
        nonJsonLines++;
        if (nonJsonLines <= 20) {
          const trimmed = line.length > 240 ? line.slice(0, 240) + "…" : line;
          log(taskId, "info", `[comfy-cli stdout] ${trimmed}`);
        } else if (nonJsonLines === 21) {
          log(taskId, "info", `[comfy-cli stdout] …后续非 JSON 行已省略（查看后端日志）`);
        }
        continue;
      }
      if (!ev || typeof ev !== "object") continue;
      const evt = ev as JsonRecord;
      if (evt.type === "queued" && typeof evt.prompt_id === "string" && evt.prompt_id) {
        promptId = evt.prompt_id;
        s.promptToTask.set(evt.prompt_id, taskId);
        void taskRepository
          .markRunning(taskId, evt.prompt_id)
          .catch(() => undefined);
        // mirror the API-format branch's
        // "✓ 已接收…等待 executing" wording so the log panel shows a
        // consistent vocabulary across both submission paths.
        log(taskId, "info", `✓ comfy-cli 已提交（prompt_id: ${promptId}），等待节点执行…`);
      } else if (evt.type === "envelope") {
        finish(Boolean(evt.ok), ev);
      } else if (
        evt.type === "progress" &&
        typeof evt.completed === "number" &&
        typeof evt.total === "number" &&
        evt.total > 0
      ) {
        s.emitter.emit(taskId, {
          type: "progress",
          progress: Math.round((evt.completed / evt.total) * 100),
        });
      } else if (evt.type === "executing" || evt.type === "execution_success") {
        // forward the raw CLI events for
        // per-node visibility (we can't map them back to the raw
        // graph class_type here without the original UUIDs, but the
        // node id + event type alone is enough to show "something is
        // running").
        // 断言仅为类型收口（运行时擦除）：模板插值与原 any 行为逐值一致。
        const node = (evt.node ?? (evt.data as JsonRecord | null | undefined)?.node ?? "?") as string;
        log(
          taskId,
          "info",
          evt.type === "execution_success"
            ? `✓ comfy-cli 节点 [${node}] 执行完成`
            : `▶ comfy-cli 节点 [${node}] 开始执行`
        );
      }
    }
  });

  // stream stderr live so Python tracebacks
  // appear in the panel as they happen, instead of only at close().
  let errBuf = "";
  let errLines = 0;
  child.stderr?.setEncoding("utf-8");
  child.stderr?.on("data", (d: string) => {
    errBuf += d;
    const lines = d.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      errLines++;
      if (errLines <= 30) {
        const t = trimmed.length > 240 ? trimmed.slice(0, 240) + "…" : trimmed;
        log(taskId, "warn", `[comfy-cli stderr] ${t}`);
      } else if (errLines === 31) {
        log(taskId, "warn", `[comfy-cli stderr] …后续错误行已省略（查看后端日志）`);
      }
    }
  });

  child.on("close", (code) => {
    clearTimeout(guard);
    cliProcs.delete(taskId);
    if (settled) return;
    settled = true;
    const tail = errBuf.trim().split("\n").slice(-12).join("\n");
    log(
      taskId,
      "error",
      `comfy-cli 进程已退出（code=${code}），未收到 envelope 事件`
    );
    void fail(taskId, promptId ?? "", `comfy-cli 异常退出（code=${code}）\n${tail || "(无 stderr)"}`);
  });

  child.on("error", (err) => {
    if (settled) return;
    settled = true;
    clearTimeout(guard);
    cliProcs.delete(taskId);
    log(taskId, "error", `comfy-cli 启动失败：${err.message}`);
    void fail(taskId, promptId ?? "", `comfy-cli 启动失败：${err.message}`);
  });
}
