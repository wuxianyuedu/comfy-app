/**
 * `executor-finalize.ts` — 任务终态收口（成功下载 / 失败落库）
 * ===========================================================================
 *
 * 从 executor.ts 拆出的「终态收口」模块（batch 4）：
 *   - {@link complete}         完成入口：抢终态 → completeInner → 兜底失败
 *   - {@link completeInner}    拉 history、收集产物、下载落盘、双写 DB、
 *                              写 manifest / workflow.json 快照
 *   - {@link fail}             对外失败入口（先抢终态再收口）
 *   - {@link finalizeFailure}  真正失败收口（不做 settled 判断）
 *
 * 依赖的通道层（claimSettle / fetchHistoryEntry）在 {@link ./executor-ws}，
 * 队列调度（processQueue）在 {@link ./executor-scheduler}。
 *
 * @module comfyui/executor-finalize — 任务终态收口（成功下载 / 失败落库）
 */
import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { taskRepository } from "../core/repository";
import { getView } from "./client";
import { collectOutputs, extractRuntimeParams } from "./executor-outputs";
import { friendlyError } from "./executor-errors";
import {
  fetchHistoryEntry,
  traceComfyQueue,
  type ComfyHistoryEntry,
} from "./executor-history";
import { historyTraceSummary, historyOutputKeys, trace } from "./trace";
import { kickQueue } from "./executor-continuation";
import {
  state,
  log,
  persistLogs,
  claimFinalize,
  claimSettle,
} from "./runner-state";
import { createAppRuntimeLogger } from "~/lib/log/app-runtime-log";

const taskRuntimeLog = createAppRuntimeLogger("task");
import type { ValidationError } from "./validation";

/** ComfyUI `status.messages` 条目是 `[type, payload?]` 元组，payload 形状随
 *  版本漂移 —— 只按本层读取的两个位置（`[0]` 类型名 / `[1].exception_message`）
 *  做窄化，其余原样保留。 */
function statusMessageTypeOf(msg: unknown): unknown {
  return Array.isArray(msg) ? msg[0] : undefined;
}

function executionErrorMessageOf(msg: unknown): unknown {
  if (!Array.isArray(msg)) return undefined;
  // Array.isArray 把 unknown 收窄为 any[]，索引取值后立即断言收口。
  const payload = msg[1] as Record<string, unknown> | null | undefined;
  return payload != null && typeof payload === "object"
    ? payload.exception_message
    : undefined;
}

/** runner-state 的 `executedWorkflow` 是 `Map<string, unknown>`（不在本次 8 文件
 *  改动范围内）—— 经这里统一收口为 `unknown` 读取；`undefined` 归一为 `null`
 *  与拆分前一致（completeInner 内两者等价）。 */
function executedWorkflowOf(taskId: string): unknown {
  const map = state().executedWorkflow as ReadonlyMap<string, unknown>;
  return map.get(taskId) ?? null;
}

/** 完成入口：抢终态 → completeInner → 兜底失败。 */
export async function complete(taskId: string, promptId: string) {
  if (!claimSettle(taskId)) return;
  const executedWorkflow = executedWorkflowOf(taskId);
  try {
    await completeInner(taskId, promptId, executedWorkflow);
  } catch (e) {
    // 下载 / 落盘 / 写库任何一步炸了，都必须把任务收口，否则队列同样会卡死。
    await finalizeFailure(
      taskId,
      promptId,
      (e as { message?: unknown } | null | undefined)?.message ??
        "结果处理失败",
    );
  }
}

async function completeInner(
  taskId: string,
  promptId: string,
  executedWorkflow: unknown = null,
) {
  const s = state();

  // 项目级产出：读取任务归属的项目与请求参数，决定磁盘落点 +
  // 复现元数据。projectId 为 localStorage 的 CanvasProject.id（client 侧字符串）。
  const taskRow = await taskRepository.findExecutionMeta(taskId);
  const projectId: string | null = taskRow?.projectId ?? null;
  const taskParams = (taskRow?.params as Record<string, unknown> | null) ?? {};
  const reqSeed =
    typeof taskParams.seed === "number" || typeof taskParams.seed === "string"
      ? String(taskParams.seed)
      : undefined;
  let reqW: number | undefined, reqH: number | undefined;
  const sizeStr = typeof taskParams.size === "string" ? taskParams.size : "";
  const sizeMatch = /(\d+)\s*[x×]\s*(\d+)/i.exec(sizeStr);
  if (sizeMatch) {
    reqW = Number(sizeMatch[1]);
    reqH = Number(sizeMatch[2]);
  }
  const publicBase = projectId
    ? `/api/generated/projects/${projectId}/${taskId}`
    : `/api/generated/${taskId}`;
  /* 显式打一行「拉取 history」：让「最后一个节点跑完」到「history 就绪」之间的
   * 空档可见 —— ComfyUI 在这段是异步的（成功信号先到，产物后落盘），所以在
   * 这个窗口里卡住，否则看起来就像「执行器冻住了」。 */
  log(taskId, "info", "🔍 拉取 ComfyUI history（最长 ~3s）…");
  const entry: ComfyHistoryEntry | null = await fetchHistoryEntry(promptId);
  if (!entry) {
    /* ISSUE #216：这句结论此前是用户能拿到的全部信息（「未找到生成结果」），
     *  既没有 promptId 也没有 ComfyUI 的原始回执。现在把能确定的事实全部摊开：
     *  promptId 有没有回传、/history 最后一次返回了什么、ComfyUI 队列里还有没有
     *  本任务；结构化原文同时落 comfyui/trace.log（见 trace.ts）。 */
    const detail = promptId
      ? `promptId=${promptId}，但 ComfyUI /history 中无该条目的有效结果`
      : "ComfyUI 全程未回传 prompt_id（工作流可能未被接受或在 comfy-cli 转换阶段失败）";
    log(
      taskId,
      "error",
      `✗ 未找到生成结果：${detail}\n` +
        `  · ComfyUI 原始回执已完整写入 log/comfyui/comfyui-trace.log（含 comfy-cli 全部 stdout/stderr 与 /history、/queue 原文）`,
    );
    await traceComfyQueue(taskId);
    trace("session", taskId, "收口：未找到生成结果", { promptId, detail });
    await finalizeFailure(taskId, promptId, `未找到生成结果：${detail}`);
    return;
  }
  const outputsCount = Object.keys(entry.outputs ?? {}).length;
  log(taskId, "info", `✓ history 就绪（${outputsCount} 节点输出）`);
  /* 把 history 的结论摘要打进任务日志：即使后面 outputs 判定为「无输出内容」，
   *  用户也能立刻看到 ComfyUI 自己报的 status（success/error/completed）与
   *  每个节点的输出键，而不是只看到一句收口结论。原文在 trace 文件里。 */
  const verdict = historyTraceSummary(promptId, { [promptId]: entry });
  log(
    taskId,
    "info",
    `ComfyUI history 摘要：status=${verdict.statusStr ?? "(无)"} completed=${
      verdict.completed ?? "(无)"
    } 输出节点=${verdict.outputNodeCount}${
      verdict.executionError ? ` 执行错误=${verdict.executionError}` : ""
    }`,
  );
  const outputKeys = historyOutputKeys({ [promptId]: entry }, promptId);
  if (outputKeys.length) {
    log(
      taskId,
      "info",
      "输出节点明细：\n" +
        outputKeys
          .map((o) => `  · 节点 ${o.nodeId} → ${o.keys.join(", ") || "(空)"}`)
          .join("\n"),
    );
  }

  const msgs: unknown[] = entry.status?.messages ?? [];
  const errored = msgs.some(
    (msg) => statusMessageTypeOf(msg) === "execution_error",
  );
  if (errored || entry.status?.status_str === "error") {
    const ex = msgs.find(
      (msg) => statusMessageTypeOf(msg) === "execution_error",
    );
    /* ISSUE #216：执行错误此前只留一句 exception_message，status.messages 的
     *  完整结构（含节点 id / traceback）全部丢弃。原文进 trace，面板给摘要。 */
    trace("history", taskId, "ComfyUI 报执行错误", {
      promptId,
      status: entry.status,
    });
    log(
      taskId,
      "error",
      `ComfyUI 报执行错误（status=${entry.status?.status_str ?? "error"}），完整 status.messages 见 log/comfyui/comfyui-trace.log`,
    );
    await finalizeFailure(
      taskId,
      promptId,
      executionErrorMessageOf(ex) ?? "执行错误",
    );
    return;
  }

  const { images, videos, audios, others, texts } = collectOutputs(
    entry.outputs ?? {},
  );
  const hasOutput =
    images.length ||
    videos.length ||
    audios.length ||
    texts.length ||
    others.length;
  if (!hasOutput) {
    /* ISSUE #216：outputs 非空但收集不到任何产物（未知输出键 / 输出被节点丢弃）
     *  时，把 outputs 原文落 trace，并提示去哪里核对，而不是只报「无输出内容」。 */
    trace("history", taskId, "history 有 outputs 但未收集到任何产物", {
      promptId,
      outputs: entry.outputs ?? {},
    });
    log(
      taskId,
      "error",
      `ComfyUI history 有 ${outputsCount} 个节点输出，但没识别出任何可下载产物（未知输出结构）；原文见 log/comfyui/comfyui-trace.log`,
    );
    await finalizeFailure(taskId, promptId, "无输出内容");
    return;
  }

  // KSampler 的真实 seed 不在 outputs 里，藏在
  // entry.prompt[2] 里（ComfyUI 0.33.1 history 格式）。`control_after_generate=
  // randomize` 时默认值是 UI 占位，server 实际抽的 seed 在 history graph
  // `inputs.seed/noise_seed` 字段。这里抽出后优先覆盖 `reqSeed`（用户填的）
  // 与 workflowHints（workflow 元数据），存到 `TaskImage.seed` + `Task.params.runtime`
  // 里让前端历史详情「生成参数卡」能展示真 seed。
  const runtime = extractRuntimeParams(entry);
  const actualSeed: number | undefined = runtime.seed;
  if (actualSeed !== undefined) {
    log(
      taskId,
      "info",
      `真实执行 seed = ${actualSeed}（${runtime.samplerClassType ?? "KSampler"}@${runtime.samplerNodeId ?? "?"}）`,
    );
  }

  const parts: string[] = [];
  if (images.length) parts.push(`${images.length} 张图像`);
  if (videos.length) parts.push(`${videos.length} 个视频`);
  if (audios.length) parts.push(`${audios.length} 个音频`);
  if (others.length) parts.push(`${others.length} 个文件`);
  if (texts.length) parts.push(`${texts.length} 段文本`);
  log(taskId, "success", `✓ 生成完成，开始下载 ${parts.join("、") || "结果"}`);

  const baseDir = path.join(process.cwd(), "public", "generated");
  const dir = projectId
    ? path.join(baseDir, "projects", projectId, taskId)
    : path.join(baseDir, taskId);
  await fs.mkdir(dir, { recursive: true });
  const saved: { localPath: string; mediaType: string }[] = [];

  // Images
  for (let i = 0; i < images.length; i++) {
    const im = images[i]!;
    const buf = await getView(im.filename, im.subfolder ?? "", im.type ?? "");
    const ext = path.extname(im.filename) || ".png";
    const fname = `img_${i}${ext}`;
    await fs.writeFile(path.join(dir, fname), buf);
    saved.push({ localPath: `${publicBase}/${fname}`, mediaType: "image" });
    log(taskId, "info", `下载第 ${i + 1} 张图像`);
  }
  // 视频（mp4 / gif / webm）
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i]!;
    const buf = await getView(v.filename, v.subfolder ?? "", v.type ?? "");
    const ext = path.extname(v.filename) || ".mp4";
    const fname = `vid_${i}${ext}`;
    await fs.writeFile(path.join(dir, fname), buf);
    saved.push({ localPath: `${publicBase}/${fname}`, mediaType: "video" });
    log(taskId, "info", `下载第 ${i + 1} 个视频`);
  }
  // 音频（SaveAudio / AudioComposite）
  for (let i = 0; i < audios.length; i++) {
    const a = audios[i]!;
    const buf = await getView(a.filename, a.subfolder ?? "", a.type ?? "");
    const ext = path.extname(a.filename) || ".wav";
    const fname = `aud_${i}${ext}`;
    await fs.writeFile(path.join(dir, fname), buf);
    saved.push({ localPath: `${publicBase}/${fname}`, mediaType: "audio" });
    log(taskId, "info", `下载第 ${i + 1} 个音频`);
  }
  // 通用 3D / 未知文件产物（mesh、gltf、obj …）
  for (let i = 0; i < others.length; i++) {
    const o = others[i]!;
    const buf = await getView(o.filename, o.subfolder ?? "", o.type ?? "");
    const ext = path.extname(o.filename) || ".bin";
    const fname = `file_${i}${ext}`;
    await fs.writeFile(path.join(dir, fname), buf);
    saved.push({ localPath: `${publicBase}/${fname}`, mediaType: "other" });
    log(taskId, "info", `下载第 ${i + 1} 个文件`);
  }
  // 文本产物（ShowText）：存成 .txt，结果可读可查。
  for (let i = 0; i < texts.length; i++) {
    const fname = `txt_${i}.txt`;
    await fs.writeFile(path.join(dir, fname), texts[i]!, "utf-8");
    saved.push({ localPath: `${publicBase}/${fname}`, mediaType: "text" });
    log(taskId, "info", `保存第 ${i + 1} 段文本`);
  }

  // 把真 seed + 采样器元数据一起回写 Task。
  // priority：actualSeed (history) > reqSeed (用户填) > null。`runtime` 块独立于
  // `params.seed` 字段（用户输入），便于审计「用户填了什么 vs server 跑的是什么」。
  const taskParamsPatched: Record<string, unknown> = { ...taskParams };
  if (Object.keys(runtime).length > 0) {
    const prevRuntime = taskParamsPatched.runtime;
    taskParamsPatched.runtime = {
      ...(typeof prevRuntime === "object" && prevRuntime ? prevRuntime : {}),
      ...(actualSeed !== undefined ? { seed: actualSeed } : {}),
      ...(runtime.steps !== undefined ? { steps: runtime.steps } : {}),
      ...(runtime.cfg !== undefined ? { cfg: runtime.cfg } : {}),
      ...(runtime.sampler_name ? { sampler_name: runtime.sampler_name } : {}),
      ...(runtime.scheduler ? { scheduler: runtime.scheduler } : {}),
      ...(runtime.denoise !== undefined ? { denoise: runtime.denoise } : {}),
      ...(runtime.samplerClassType
        ? { sampler_class: runtime.samplerClassType }
        : {}),
      ...(runtime.samplerNodeId ? { sampler_node: runtime.samplerNodeId } : {}),
      // 一个工作流可能有多个采样节点：顶层字段只反映主采样器（第一个），完整
      // 逐节点信息随 samplers 数组落库，原始 JSON 因此能展示全部 KSampler。
      ...(runtime.samplers && runtime.samplers.length > 0
        ? { samplers: runtime.samplers }
        : {}),
      source: "history",
    };
  }

  // ── 方案 B: 任务完成时双写执行快照到 DB 行 ──
  // WorkflowTemplate 是覆盖式单行存储，模板重新导入会整体覆盖 rawJson/graph，
  // 导致历史任务无法精确复现当时实际跑的工作流。这里把本次执行实际用到的
  // workflow 一并写进 Task.workflowSnapshot，使「任务」与「模板当前版本」彻底
  // 解耦、可独立复现。`source: "execution"` 标记这是执行时自动捕获的独立副本。
  const workflowSnapshot =
    executedWorkflow != null
      ? {
          workflow: executedWorkflow,
          capturedAt: new Date().toISOString(),
          source: "execution",
        }
      : undefined;

  /* 与 finalizeFailure 共用同一把「DB 终态一次写入」锁：若 reaper 已把
   *  这条任务判过终态，就不再覆盖，避免「执行日志说成功、应用日志说失败」
   *  这类矛盾（反之亦然）。 */
  if (!claimFinalize(taskId)) {
    log(taskId, "warn", "跳过重复收口：终态已由其它路径落库（本次结果：成功）");
    s.active = Math.max(0, s.active - 1);
    kickQueue();
    return;
  }
  await taskRepository.finalizeSuccess(taskId, {
    resultImages: saved,
    params: taskParamsPatched,
    ...(workflowSnapshot ? { workflowSnapshot } : {}),
  });
  await taskRepository.createImages(
    taskId,
    saved.map((s2, i) => ({
      localPath: s2.localPath,
      sortIndex: i,
      isCover: i === 0,
      mediaType: s2.mediaType,
      seed: actualSeed !== undefined ? String(actualSeed) : (reqSeed ?? null),
      width: s2.mediaType === "image" ? (reqW ?? null) : null,
      height: s2.mediaType === "image" ? (reqH ?? null) : null,
    })),
  );

  // 项目级产出：写一份可复现的 manifest，便于「按项目归档 + 一键还原」。
  const manifest = {
    taskId,
    projectId,
    workflowName: taskRow?.workflowName ?? null,
    prompt: taskRow?.prompt ?? null,
    negativePrompt: taskRow?.negativePrompt ?? null,
    seed: actualSeed !== undefined ? String(actualSeed) : (reqSeed ?? null),
    size: sizeStr || null,
    referenceImages: (taskRow?.referenceImages as string[] | null) ?? [],
    params: taskParams,
    createdAt: taskRow?.createdAt ?? null,
    files: saved,
  };
  await fs
    .writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    )
    .catch(() => undefined);

  // 落盘本次执行实际用到的 workflow.json。种子等已在
  // manifest.seed + TaskImage.seed 持久化，工作流模板后续改动时凭这份快照即可
  // 完整复现本次生成结果。raw 路径为 liblib subgraph 格式（未展开），api 路径为
  // 已展开 graph。
  if (executedWorkflow != null) {
    await fs
      .writeFile(
        path.join(dir, "workflow.json"),
        JSON.stringify(executedWorkflow, null, 2),
        "utf-8",
      )
      .catch(() => undefined);
  }

  await persistLogs(taskId);
  taskRuntimeLog.info(`任务完成 ${taskId}`, { outputs: saved.length });
  /* 打一行「总耗时 Xs」：让用户看到整轮跑的墙上时间。startedAt 缺失时退化成一句
   * 通用说明 —— 这只在「上一次服务端生命周期入队、本次重新接管」时才会发生，
   * 极其罕见。 */
  const startedAt = s.startedAt.get(taskId);
  if (startedAt) {
    const elapsedSec = Math.max(
      0,
      Math.round((Date.now() - startedAt) / 100) / 10,
    );
    log(taskId, "info", `✓ 全部完成（总耗时 ${elapsedSec}s）`);
    s.startedAt.delete(taskId);
  }
  s.lastNodeByTask.delete(taskId);
  s.emitter.emit(taskId, { type: "done", images: saved });
  s.promptToTask.delete(promptId);
  s.promptByTask.delete(taskId);
  s.executedWorkflow.delete(taskId);
  s.lastLogPct.delete(taskId);
  s.active = Math.max(0, s.active - 1);
  kickQueue();
}

/** 对外的失败入口：先抢终态，再收口。
 *  `validationErrors` 为可选的结构化校验错误（ComfyUI /prompt 的
 *  `node_errors` 拆解），仅在「提交即校验失败」路径传入；其它失败
 *  （超时/执行异常）不携带，落库为 null。 */
export async function fail(
  taskId: string,
  promptId: string,
  error: unknown,
  validationErrors?: ValidationError[],
) {
  if (!claimSettle(taskId)) return;
  await finalizeFailure(taskId, promptId, error, validationErrors);
}

/** 真正的失败收口。**不做 settled 判断** —— 调用方必须已经抢到终态。
 *  `error` 故意放宽为 `unknown`：ComfyUI 的 `execution_error.exception_message`
 *  在某些版本（kaytool v0.28）里是结构化对象，`friendlyError` 会剥出真正的
 *  `.message`/`.exception_message`，而不是直接 toString() 成 "[object Object]"。*/
export async function finalizeFailure(
  taskId: string,
  promptId: string,
  error: unknown,
  validationErrors?: ValidationError[],
) {
  const s = state();
  const friendly = friendlyError(error) || "任务失败";
  /* 一次性落库锁：同一任务可能被 executor（complete/fail 的异常分支）、
   *  看门狗、reaper 多条路径同时尝试收口。首个写入者落库 + 写日志，其余
   *  直接跳过——否则后写入的原因会覆盖先写入的，SSE（执行日志）与
   *  DB / 应用日志就会显示两个互相矛盾的失败原因。 */
  if (!claimFinalize(taskId)) {
    log(
      taskId,
      "warn",
      `跳过重复收口：终态已由其它路径落库（本次原因：${friendly}）`,
    );
    /* 仍需释放活跃槽位并推进队列，否则重复收口会把队列卡死。 */
    s.active = Math.max(0, s.active - 1);
    kickQueue();
    return;
  }
  /* 失败分支同样打出总耗时：让用户知道「这个任务其实跑了 Xs 才失败」，而不是
   * 「它一上来就死了」。 */
  const startedAt = s.startedAt.get(taskId);
  const elapsedSuffix = startedAt
    ? `（已运行 ${Math.max(0, Math.round((Date.now() - startedAt) / 100) / 10)}s）`
    : "";
  log(taskId, "error", `✗ 生成失败：${friendly}${elapsedSuffix}`);

  await taskRepository.finalizeFailure(
    taskId,
    friendly,
    validationErrors?.length ? validationErrors : undefined,
  );

  await persistLogs(taskId);
  taskRuntimeLog.error(`任务失败 ${taskId}: ${friendly}`);
  // 清掉本模块给这个任务加的状态，同一个 taskId 再入队时从干净状态开始。
  if (startedAt) s.startedAt.delete(taskId);
  s.lastNodeByTask.delete(taskId);
  /* executedWorkflow 只在 complete() 成功分支清过，失败分支一直留着——
   * 既泄漏内存，又让「已执行过就永远算被本进程认领」把 reaper 的孤儿回收
   * 永久挡住。失败收口同样清掉。 */
  s.executedWorkflow.delete(taskId);
  /* 以前 finalizeFailure 只发 `error` 事件。而 `error` 会把 SSE 流关掉（见
   * /api/tasks/[id]/stream/route.ts），于是带着结构化 `validationErrors` 的
   * `state` 补丁永远到不了客户端。cancelTask() 的做法是对的 —— 先 `state` 再
   * `error`。这里照做：让面板**在流还开着的时候**拿到结构化诊断，在关闭之前把
   * d.validationErrors 补上。顺序要紧：先 state（修 UI），后 error（关连接）。 */
  s.emitter.emit(taskId, {
    type: "state",
    status: "FAILED",
    progress: 0,
    error: friendly,
    validationErrors: validationErrors?.length ? validationErrors : [],
  });
  s.emitter.emit(taskId, { type: "error", error: friendly });
  if (promptId) s.promptToTask.delete(promptId);
  s.promptByTask.delete(taskId);
  s.lastLogPct.delete(taskId);
  s.active = Math.max(0, s.active - 1);
  kickQueue();
}
