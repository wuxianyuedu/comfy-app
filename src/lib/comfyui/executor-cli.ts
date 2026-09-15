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
import { state, log } from "./runner-state";
import type { Job } from "./runner-state";
import { complete, fail } from "./executor-finalize";
import {
  createCliEnvelopeParser,
  createCliFinisher,
  createCliStderrSink,
} from "./executor-cli-stream";
import { applyRawOverrides, type JsonRecord } from "./raw-overrides";
import { trace } from "./trace";
import { COMFYUI_DEFAULT_PORT } from "../app-settings";

// 保持 executor.ts barrel 的 `applyRawOverrides` 导出不变
//（纯逻辑已抽到 ./raw-overrides，这里仅透传）。
export { applyRawOverrides };

/* HMR 安全：comfy-cli 子进程表必须挂在 globalThis 上。
 *
 * 它是 QUEUED reaper 判定「任务是否仍被本进程认领」的三个信号之一
 * （见 reaper.ts 的 isTaskClaimedInProcess）。模块级 `new Map()` 在
 * Next.js/Turbopack 重新求值该模块时会得到一个**空 Map**，而另一个
 * 模块实例里正在跑的 comfy-cli 子进程句柄仍留在旧 Map 上——reaper 于是
 * 看不到在飞任务，把健康任务误判为孤儿并标 FAILED（原始路径的 DB 行在
 * comfy-cli 回传 prompt_id 前一直是 QUEUED/promptId=null）。
 * 同族单例（runner-state / reaper 定时器 / lifecycle 启动锁）都已挂在
 * globalThis 上，这里补齐最后一个漏网项。 */
const CLI_PROCS_GLOBAL = "__comfyCliProcs_v1";
const globalRef = globalThis as unknown as Record<
  string,
  Map<string, ChildProcess> | undefined
>;
export const cliProcs: Map<string, ChildProcess> =
  globalRef[CLI_PROCS_GLOBAL] ?? new Map<string, ChildProcess>();
globalRef[CLI_PROCS_GLOBAL] = cliProcs;

const CLI_TIMEOUT_MS = 25 * 60 * 1000;

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
        typeof rawId === "string" || typeof rawId === "number"
          ? String(rawId)
          : undefined;
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
  let port = COMFYUI_DEFAULT_PORT;
  try {
    const u = new URL(base);
    host = u.hostname === "localhost" ? "127.0.0.1" : u.hostname;
    port = parseInt(u.port) || COMFYUI_DEFAULT_PORT;
  } catch {
    /* keep defaults */
  }
  log(taskId, "info", `ComfyUI 目标：${host}:${port}（${base}）`);

  let patched = applyRawOverrides(rawJson, overrides);
  const nodeCountBefore = Array.isArray(patched.nodes)
    ? patched.nodes.length
    : 0;
  patched = stripUiOnlyNodes(patched);
  const nodeCountAfter = Array.isArray(patched.nodes)
    ? patched.nodes.length
    : 0;
  if (nodeCountAfter !== nodeCountBefore) {
    log(
      taskId,
      "info",
      `已剔除 ${nodeCountBefore - nodeCountAfter} 个纯 UI 控制节点（无后端实现），避免 comfy-cli 校验失败`,
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
    `工作流文件就绪（${Object.keys(patched?.nodes ?? {}).length || Object.keys(patched).length} 节点）`,
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
    pyName,
  );
  const py = process.env.COMFY_CLI_PYTHON ?? defaultPy;
  const args = [
    "-m",
    "comfy_cli",
    "run",
    "--workflow",
    tmpFile,
    "--json",
    "--wait",
    "--where",
    "local",
    "--host",
    host,
    "--port",
    String(port),
    "--no-notify",
    "--timeout",
    "600",
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
  log(taskId, "info", `comfy-cli 执行 raw 工作流（${host}:${port}）`);
  log(taskId, "info", `  ${pyName} ${args.join(" ")}`);
  /* ISSUE #216：把完整命令行写进 trace，便于在支持现场原样复现。 */
  trace("cli", taskId, "启动 comfy-cli", {
    bin: py,
    args,
    host,
    port,
    workflowFile: tmpFile,
  });
  // explicit pre-spawn line so the user
  // sees a "→ 启动" marker before the (potentially slow) Python
  // boot.  Without this, the first log on a raw submission was
  // "comfy-cli 执行 raw 工作流" + a long silence, which looks
  // indistinguishable from a hang.
  log(taskId, "info", `→ 启动 comfy-cli 进程（raw UI-format → API 转换）`);
  s.emitter.emit(taskId, {
    type: "log",
    entry: {
      t: Date.now(),
      level: "info",
      msg: "已使用 comfy-cli 提交 raw 工作流",
    },
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
    `comfy-cli 进程已启动（pid=${child.pid ?? "?"}，等待 stdout…）`,
  );
  trace("cli", taskId, `进程已启动 pid=${child.pid ?? "?"}`);

  const guard = setTimeout(() => {
    if (settled) return;
    settled = true;
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    cliProcs.delete(taskId);
    void fail(taskId, promptId ?? "", "comfy-cli 执行超时（看门狗）");
  }, CLI_TIMEOUT_MS);

  /* stdout / stderr 的流解析与 envelope 收口都收在 executor-cli-stream.ts：
   * 这些回调此前是内联闭包（合计约 240 行），捕获 promptId / patched /
   * settled，只能起真进程验证（ISSUE #570 第 5 项）。 */
  const finish = createCliFinisher({
    taskId,
    log,
    patched,
    complete: (id, pid) => void complete(id, pid),
    fail: (id, pid, detail, ves) => void fail(id, pid, detail, ves),
    settle: () => {
      if (settled) return false;
      settled = true;
      clearTimeout(guard);
      cliProcs.delete(taskId);
      return true;
    },
    promptId: () => promptId,
  });

  child.stdout?.setEncoding("utf-8");
  const stdoutParser = createCliEnvelopeParser({
    taskId,
    log,
    patched,
    finish,
    onPromptId: (id: string) => {
      promptId = id;
      s.promptToTask.set(id, taskId);
      void taskRepository.markRunning(taskId, id).catch(() => undefined);
    },
    onProgress: (progress: number) => {
      s.emitter.emit(taskId, { type: "progress", progress });
    },
  });
  child.stdout?.on("data", stdoutParser.sink);

  // stream stderr live so Python tracebacks
  // appear in the panel as they happen, instead of only at close().
  // 行数上限 60（真实 traceback 一般 < 40 行）；click/Python 的
  // DeprecationWarning 噪声不占额度、计数后由 close 汇总，避免把真正的
  // 错误堆栈挤出面板。单行截断放宽到 400 字符（traceback 的路径很长）。
  // stderrSink.raw() 始终完整累积，close 时的 tail 汇总不受行数上限影响。
  const stderrSink = createCliStderrSink({ taskId, log });
  child.stderr?.setEncoding("utf-8");
  child.stderr?.on("data", stderrSink.sink);

  child.on("close", (code) => {
    clearTimeout(guard);
    cliProcs.delete(taskId);
    if (settled) return;
    settled = true;
    const noisy = stderrSink.noisyWarningLines();
    if (noisy > 0) {
      log(
        taskId,
        "warn",
        `[comfy-cli stderr] 另有 ${noisy} 行 Python Deprecation/Syntax 警告（第三方库噪声，与执行结果无关）已省略`,
      );
    }
    const tail = stderrSink.raw().trim().split("\n").slice(-12).join("\n");
    /* 未收到 envelope 的退出是「结果丢失」的头号嫌疑路径：完整 stderr +
     * 未消费的 stdout 尾部一次性落 trace（面板仍是精简的 12 行）。 */
    trace("cli", taskId, `进程退出 code=${code}（未收到 envelope）`, {
      stderr: stderrSink.raw(),
      stdoutLeftover: stdoutParser.leftover(),
      promptId,
    });
    log(
      taskId,
      "error",
      `comfy-cli 进程已退出（code=${code}），未收到 envelope 事件`,
    );
    void fail(
      taskId,
      promptId ?? "",
      `comfy-cli 异常退出（code=${code}）\n${tail || "(无 stderr)"}`,
    );
  });

  child.on("error", (err) => {
    if (settled) return;
    settled = true;
    clearTimeout(guard);
    cliProcs.delete(taskId);
    trace("cli", taskId, "进程启动失败", { error: err });
    log(taskId, "error", `comfy-cli 启动失败：${err.message}`);
    void fail(taskId, promptId ?? "", `comfy-cli 启动失败：${err.message}`);
  });
}
