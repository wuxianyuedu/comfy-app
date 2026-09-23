/**
 * `executor-cli.ts` — comfy-cli 执行路径（**两种格式统一**）
 * ===========================================================================
 *
 * 从 executor.ts 拆出的「comfy-cli 提交路径」模块（batch 4）：
 *   - {@link cliProcs}          正在运行的 comfy-cli 子进程表（供取消）
 *   - {@link executeViaComfyCli} 工作流提交 + stdout 事件收割
 *   - {@link applyRawOverrides}  把 canvas 的 workflowInputs 注入 raw json
 *
 * **两种格式都经 comfy-cli**（`comfy run --workflow` 两种都吃：API 格式是它的
 * 默认输入，UI-format 由它自动做权威的 UI→API 转换并展开子图）：
 *   - RAW 原件：注入画布覆盖 → 剔除无后端实现的纯 UI 控制节点 → 交 cli；
 *   - API 图  ：剔除 bypass / 静音 / 纯前端节点并穿透连线（见 execution-graph）
 *               → 交 cli **直接提交**。
 * 统一的好处是提交、校验错误、日志口径只有一套（此前 API 走 postPrompt，
 * 同一份工作流换个格式就有不同的报错文案）。
 *
 * 成功/失败统一走 executor-finalize 的收口。
 *
 * @module comfyui/executor-cli — comfy-cli 执行路径（**两种格式统一**）
 */
import { errorText } from "~/lib/error-message";
import { fireAndForget } from "~/lib/async-action";
import { logger } from "~/lib/core/logger";
import { tailWindow } from "~/lib/page-window";
import "server-only";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { taskRepository } from "../core/repository";
import { resolveComfyBase } from "./client";
import { primaryModelName } from "./executed-model";
import { state, log, appendRawCli } from "./runner-state";
import type { Job } from "./runner-state";
import { complete, fail } from "./executor-finalize";
import {
  createCliEnvelopeParser,
  createCliFinisher,
  createCliStderrSink,
} from "./executor-cli-stream";
import { prepareGraphForExecution } from "./execution-graph";
import {
  applyApiOverrides,
  applyRawOverrides,
  type JsonRecord,
} from "./raw-overrides";
import { trace } from "./trace";
import { COMFYUI_DEFAULT_PORT, LOOPBACK_HOST } from "../endpoints";

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

declare global {
  var __comfyCliProcs_v1: Map<string, ChildProcess> | undefined;
}

export const cliProcs: Map<string, ChildProcess> =
  (globalThis.__comfyCliProcs_v1 ??= new Map<string, ChildProcess>());

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
  // [linkId, originNodeId, originSlot, targetNodeId, targetSlot, type] 六元组）
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
  const { taskId, rawJson, prompt, overrides } = job;
  /* RAW 原件走 UI→API 转换；没有 rawJson 就是 API 图，直接提交。 */
  const isRaw = rawJson != null;
  /* RAW 路径的入口行：让用户在日志面板上直接看出「任务正由哪条路径处理」。
   * 加这行之前，提交后要等第一条 stdout JSON 事件（常在 5–30s 之后，
   * Python venv 启动完）才会安静结束 —— 面板上看不出是在跑还是卡住。 */
  log(
    taskId,
    "info",
    isRaw
      ? `→ executeViaComfyCli 入口（RAW UI-format，由 comfy-cli 做 UI→API 转换）`
      : `→ executeViaComfyCli 入口（API 图，由 comfy-cli 直接提交）`,
  );
  /* 工作流名入日志：执行日志要能自包含地回答「这次跑的是哪个工作流」——
   * 面板标题是客户端从运行登记表拼的，落库的日志行才是可回放/可导出的
   * 现场。入队方（generate 路由 / 工坊运行编排）都带得上；旧任务缺省时
   * 如实显示「未知」。 */
  log(taskId, "info", `工作流：${job.workflowName ?? "（未知）"}`);
  const base = await resolveComfyBase();
  let host = LOOPBACK_HOST;
  let port = COMFYUI_DEFAULT_PORT;
  try {
    const u = new URL(base);
    host = u.hostname === "localhost" ? LOOPBACK_HOST : u.hostname;
    port = parseInt(u.port) || COMFYUI_DEFAULT_PORT;
  } catch {
    /* keep defaults */
  }
  log(taskId, "info", `ComfyUI 目标：${host}:${port}（${base}）`);

  let patched: JsonRecord;
  if (isRaw) {
    patched = applyRawOverrides(rawJson, overrides);
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
  } else {
    /* API 图：comfy-cli 对 API 格式是原样提交，**既不会应用画布覆盖，也不会做
     * 前端语义**（剔除 bypass / 静音节点、穿透断掉的连线）——两者都在这里做。
     *
     * 顺序不能反：先注入覆盖、再收拾图。被旁路/静音的节点会被收拾掉，写给它们的
     * 覆盖项本就该随之丢弃（它们不会执行）。 */
    const withOverrides = applyApiOverrides(prompt, overrides);
    const prep = prepareGraphForExecution(withOverrides);
    if (!Object.keys(prep.graph).length) {
      log(taskId, "error", "工作流没有可执行的节点（可能全部被禁用）");
      fireAndForget(
        fail(taskId, "", "工作流没有可执行的节点（可能全部被禁用）"),
        (e) =>
          logger.warn(
            `[comfyui] ${errorText(e, `fail(${taskId}) 空图收口异常`)}`,
          ),
      );
      return;
    }
    if (prep.removed.length) {
      log(
        taskId,
        "info",
        `执行前跳过 ${prep.removed.length} 个禁用/纯前端节点` +
          (prep.droppedInputs ? `，丢弃 ${prep.droppedInputs} 个悬空输入` : ""),
      );
    }
    patched = prep.graph;
  }
  /* 临时工作流文件统一放到项目根目录 temp/comfy-cli/，便于清理和跨平台管理。 */
  const tmpDir = path.join(process.cwd(), "temp", "comfy-cli");
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `wf-${taskId}.json`);
  log(taskId, "info", `写入临时工作流文件：${tmpFile}`);
  await fs.writeFile(tmpFile, JSON.stringify(patched), "utf-8");
  // 记下本次实际提交出去的工作流：RAW 是（覆盖 + 剔除后的）未展开原件，
  // API 是（剔除/穿透后的）图。任务完成落盘为 workflow.json 供完整复现。
  s.executedWorkflow.set(taskId, patched);
  log(
    taskId,
    "info",
    `工作流文件就绪（${Object.keys(patched?.nodes ?? {}).length || Object.keys(patched).length} 节点）`,
  );
  /* 主模型名入日志（复用 `executed-model.ts` 的双格式识别，与状态栏同一份
   * 口径）：模型名是执行日志里最常被追问的上下文，出问题时「当时用的哪个
   * 模型」必须能直接从面板读到，不必去翻 trace 或工作流文件。识别不出
   * （图里没有主模型加载节点）就不打这一行，别用占位文案添噪。 */
  const modelName = primaryModelName(patched);
  if (modelName) {
    log(taskId, "info", `使用模型：${modelName}`);
  }

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
    fireAndForget(
      fail(taskId, "", `未找到 comfy-cli Python 解释器：${py}`),
      (e) =>
        logger.warn(
          `[comfyui] ${errorText(e, `fail(${taskId}) 缺解释器收口异常`)}`,
        ),
    );
    return;
  }

  /* 把真实的 comfy-cli 命令打进日志：用户（以及支持现场）能直接从日志面板
   * 复现这次调用，不必去翻 devtools。 */
  log(
    taskId,
    "info",
    `comfy-cli 执行${isRaw ? " raw 工作流（UI→API 转换）" : " API 工作流"}（${host}:${port}）`,
  );
  log(taskId, "info", `  ${pyName} ${args.join(" ")}`);
  /* ISSUE #216：把完整命令行写进 trace，便于在支持现场原样复现。 */
  trace("cli", taskId, "启动 comfy-cli", {
    bin: py,
    args,
    host,
    port,
    workflowFile: tmpFile,
  });
  /* 起进程前显式打一行：让用户在（可能很慢的）Python 启动之前先看到
   * "→ 启动" 标记。没有这行时，raw 提交后的首条日志是
   * "comfy-cli 执行 raw 工作流" 加一段长静默，看起来和卡死没有区别。 */
  log(
    taskId,
    "info",
    isRaw
      ? `→ 启动 comfy-cli 进程（raw UI-format → API 转换）`
      : `→ 启动 comfy-cli 进程（API 图直接提交）`,
  );
  s.emitter.emit(taskId, {
    type: "log",
    entry: {
      t: Date.now(),
      level: "info",
      msg: isRaw
        ? "已使用 comfy-cli 提交 raw 工作流"
        : "已使用 comfy-cli 提交 API 工作流",
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
    fireAndForget(
      fail(taskId, promptId ?? "", "comfy-cli 执行超时（看门狗）"),
      (e) =>
        logger.warn(
          `[comfyui] ${errorText(e, `fail(${taskId}) 看门狗收口异常`)}`,
        ),
    );
  }, CLI_TIMEOUT_MS);

  /* stdout / stderr 的流解析与 envelope 收口都收在 executor-cli-stream.ts：
   * 这些回调此前是内联闭包（合计约 240 行），捕获 promptId / patched /
   * settled，只能起真进程验证（ISSUE #570 第 5 项）。 */
  const finish = createCliFinisher({
    taskId,
    log,
    patched,
    complete: (id, pid) =>
      fireAndForget(complete(id, pid), (e) =>
        logger.warn(`[comfyui] ${errorText(e, `complete(${id}) 收口异常`)}`),
      ),
    fail: (id, pid, detail, ves) =>
      fireAndForget(fail(id, pid, detail, ves), (e) =>
        logger.warn(`[comfyui] ${errorText(e, `fail(${id}) 收口异常`)}`),
      ),
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
    rawCli: appendRawCli,
    patched,
    finish,
    onPromptId: (id: string) => {
      promptId = id;
      s.promptToTask.set(id, taskId);
      /* 记 promptId 同样是「只在非终态行生效」的 compare-and-set：comfy-cli
       *  回传 prompt_id 之前，reaper 完全可能已按「QUEUED 超时 + 无 promptId」
       *  判过终态。此时若把行标回 RUNNING，终态就被改写、SSE 已关的流不会
       *  重开，用户看到的是永远「生成中…」。更新失败即说明本任务不再归我们，
       *  后续流程照旧由 reaper 的对账负责。 */
      void taskRepository
        .markRunning(taskId, id)
        .then((updated) => {
          if (!updated)
            log(
              taskId,
              "warn",
              "任务已由其它路径收口，忽略本次 prompt_id 回传（不再改写终态）",
            );
        })
        .catch(() => undefined);
    },
    onProgress: (progress: number) => {
      s.emitter.emit(taskId, { type: "progress", progress });
    },
  });
  child.stdout?.on("data", stdoutParser.sink);

  // 实时透传 stderr：Python 的 traceback 一出现就进面板，而不是只在 close() 时汇总。
  // 行数上限 60（真实 traceback 一般 < 40 行）；click/Python 的
  // DeprecationWarning 噪声不占额度、计数后由 close 汇总，避免把真正的
  // 错误堆栈挤出面板。单行截断放宽到 400 字符（traceback 的路径很长）。
  // stderrSink.raw() 始终完整累积，close 时的 tail 汇总不受行数上限影响。
  const stderrSink = createCliStderrSink({ taskId, log, rawCli: appendRawCli });
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
    const tail = tailWindow(stderrSink.raw().trim().split("\n"), 12).join("\n");
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
    fireAndForget(
      fail(
        taskId,
        promptId ?? "",
        `comfy-cli 异常退出（code=${code}）\n${tail || "(无 stderr)"}`,
      ),
      (e) =>
        logger.warn(
          `[comfyui] ${errorText(e, `fail(${taskId}) 进程退出收口异常`)}`,
        ),
    );
  });

  child.on("error", (err) => {
    if (settled) return;
    settled = true;
    clearTimeout(guard);
    cliProcs.delete(taskId);
    trace("cli", taskId, "进程启动失败", { error: err });
    log(taskId, "error", errorText(err, "comfy-cli 启动失败"));
    fireAndForget(
      fail(taskId, promptId ?? "", errorText(err, "comfy-cli 启动失败")),
      (e) =>
        logger.warn(
          `[comfyui] ${errorText(e, `fail(${taskId}) 启动失败收口异常`)}`,
        ),
    );
  });
}
