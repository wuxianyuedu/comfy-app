/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
// P3 executor: WS connection / message handling / queue scheduling / task
// completion & failure handling for the ComfyUI runner.
//
// Extracted from `runner.ts` (1971 → split) — the public entry stays at
// `runner.ts`; this module is the *execution engine* and is imported by
// enqueue.ts (connect / processQueue / cliProcs) and re-exported through the
// runner for the public helpers below.

import WebSocket from "ws";
import { spawn, type ChildProcess } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { taskRepository } from "../core/repository";
import { logger } from "~/server/lib/logger";
import {
  getView,
  getHistory,
  postPrompt,
  resolveComfyBase,
  resetComfyBase,
  toWsBase,
} from "./client";
import { prepareGraphForExecution } from "./raw";
import { type ValidationError, extractValidationErrors } from "./validation";
import { comfyProtocol } from "./protocol-adapter";
import {
  state,
  log,
  persistLogs,
  CLIENT_ID,
  MAX_CONCURRENCY,
  JOB_TIMEOUT_MS,
  HISTORY_RETRIES,
  HISTORY_RETRY_DELAY_MS,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  WS_PATHS,
} from "./runner-state";
import type { Job, RawWorkflowOverride } from "./runner-state";

function nodeLabel(classType?: string): string {
  const map: Record<string, string> = {
    CheckpointLoaderSimple: "加载模型",
    CLIPTextEncode: "编码提示词",
    EmptyLatentImage: "初始化潜空间",
    KSampler: "采样去噪",
    VAEDecode: "VAE 解码",
    SaveImage: "保存图像",
    LoraLoader: "加载 LoRA",
  };
  return map[classType ?? ""] ?? classType ?? "未知节点";
}

/**
 * 建立事件通道。
 *
 * ⚠️ 这里必须走 `resolveComfyBase()` 而不是同步的配置值：ComfyUI 端口被占用时
 * 会自动 +1 启动，HTTP 侧靠探测找到了真实端口，WS 侧如果还连配置端口就会
 * 「提交成功但收不到任何事件」，最后卡到超时。两条链路必须用同一个 base。
 */
export async function connect(): Promise<void> {
  const s = state();
  if (s.connecting || s.ws) return;
  s.connecting = true;

  let base: string;
  try {
    base = await resolveComfyBase();
  } catch {
    s.connecting = false;
    scheduleReconnect();
    return;
  }
  // await 期间可能已有别的调用建好了连接
  if (s.ws) {
    s.connecting = false;
    return;
  }

  const path = WS_PATHS[s.wsPathIndex % WS_PATHS.length];
  const url = `${toWsBase(base)}${path}?clientId=${CLIENT_ID}`;

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    s.connecting = false;
    s.wsPathIndex += 1; // 换一条 WS 路径重试
    scheduleReconnect();
    return;
  }

  let opened = false;
  ws.on("open", () => {
    opened = true;
    s.connecting = false;
    s.reconnectAttempts = 0;
    void processQueue();
  });
  ws.on("message", (data) => void handleMessage((data as Buffer).toString()));
  // error / close 都交给 handleWsDrop 统一处理（幂等，双发只生效一次）。
  ws.on("close", () => handleWsDrop(ws));
  ws.on("error", (err: Error) => {
    // 某些 ComfyUI 版本 / 网络下 error 之后不一定再发 close，
    // 这里兜底触发重连，否则队列会卡死在 RUNNING。
    logger.warn(`[comfyui] WS(${path}) 出错：${err?.message ?? err}`);
    // 连接阶段（未 open）就失败：换下一条 WS 路径重试一次。
    if (!opened) s.wsPathIndex += 1;
    handleWsDrop(ws);
  });
  s.ws = ws;
}

/**
 * 统一处理 WS 掉线。
 * 幂等：error 与 close 事件可能双发，第二次进来时 `s.ws` 已不是当前 socket，直接忽略，
 * 避免重复排两次重连。同时丢掉端口探测缓存，让下次重连重新发现 ComfyUI（可能换了端口）。
 */
function handleWsDrop(ws: WebSocket) {
  const s = state();
  if (s.ws !== ws) return;
  s.ws = null;
  s.connecting = false;
  resetComfyBase();
  scheduleReconnect();
}

function scheduleReconnect() {
  const s = state();
  const attempt = Math.min(s.reconnectAttempts++, 8);
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
  setTimeout(() => void connect(), delay);
}

/**
 * 统一 WS 消息入口。所有协议判断（标准 ComfyUI vs kaytool v0.28 非标准信号）
 * 都委托给 `comfyProtocol` Adapter，协议差异只存在于 protocol-adapter.ts。
 */
async function handleMessage(raw: string) {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  const data = msg.data ?? {};
  const promptId: string | undefined = data.prompt_id;
  if (!promptId) return;
  const s = state();
  const taskId = s.promptToTask.get(promptId);
  if (!taskId) return;

  const signal = comfyProtocol.classify(msg);

  // 任何来自 ComfyUI 的活动（节点开始执行 / 进度推进）都续期看门狗，
  // 避免长任务被 5 分钟硬超时误杀（P2 修复）。完成/错误分支走 claimSettle
  // 会清掉定时器，这里刷新无害。
  if (signal === "node-started" || signal === "node-finished" || signal === "progress") {
    armWatchdog(taskId, promptId);
  }

  if (signal === "node-started") {
    // A node started executing — surface it in the log for transparency.
    const graph = s.promptByTask.get(taskId);
    const classType = graph?.[data.node]?.class_type;
    const nodeId = String(data.node);
    // R-ardot111 (2026-08-17): remember this node so we can log its
    // completion when ComfyUI emits the next `executing` with
    // `data.node === null`.  This turns a "▶ KSampler" line into a
    // proper "▶ KSampler → ✔ KSampler" pair.
    s.lastNodeByTask.set(taskId, { node: nodeId, classType: classType ?? "", t: Date.now() });
    log(taskId, "info", `▶ 节点 [${nodeId}] ${nodeLabel(classType)}（${classType ?? "?"}）`);
    return;
  }

  // R-ardot111 (2026-08-17): when ComfyUI signals the previous node
  // finished (executing → null node) and we have a recorded
  // lastNodeByTask entry, surface a "✔ 完成" line so the user sees
  // a per-node timeline.  Only do this for the API-format path
  // (where data.node is a string id); comfy-cli emits its own
  // "▶ 节点 N/total" lines via executeViaComfyCli.
  if (signal === "node-finished") {
    const last = s.lastNodeByTask.get(taskId);
    if (last) {
      const dur = Math.max(0, Math.round((Date.now() - last.t) / 100) / 10);
      log(taskId, "info", `✔ 节点 [${last.node}] ${nodeLabel(last.classType)} 完成（${dur}s）`);
      s.lastNodeByTask.delete(taskId);
    }
  }

  if (signal === "progress") {
    const value = Number(data.value ?? 0);
    const max = Number(data.max ?? 1);
    const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
    await taskRepository.updateProgress(taskId, pct);
    s.emitter.emit(taskId, { type: "progress", progress: pct });

    // Throttled milestone log so the panel stays readable.
    const last = s.lastLogPct.get(taskId) ?? -1;
    if (pct - last >= 25 || pct === 100) {
      s.lastLogPct.set(taskId, pct);
      log(taskId, "progress", `采样进度 ${pct}%`);
    }
    return;
  }

  // Completion: standard ComfyUI uses `executing` with node===null; the
  // kaytool build (v0.28) emits `execution_success` instead.
  if (signal === "completion") {
    await complete(taskId, promptId);
  } else if (signal === "error") {
    await fail(taskId, promptId, data.exception_message ?? "执行错误");
  }
}

/**
 * 抢占任务的终态。
 *
 * 返回 true 表示本次调用赢得了收口权（并已停掉超时定时器）；返回 false 表示
 * 别处已经把任务结算过了，调用方应直接退出。
 *
 * ⚠️ 历史坑：complete() 曾在入口就 `settled.add`，随后它内部的失败分支再调
 * fail()，而 fail() 第一行就是 `if (settled.has) return` —— 直接空转。结果
 * 是任务永远停在 RUNNING、`active` 不回落、MAX_CONCURRENCY=1 的队列被彻底
 * 堵死，只能重启进程。所以失败收口一律走 finalizeFailure()，不再经过 fail()。
 */
function claimSettle(taskId: string): boolean {
  const s = state();
  if (s.settled.has(taskId)) return false;
  s.settled.add(taskId);
  const t = s.timers.get(taskId);
  if (t) clearTimeout(t);
  s.timers.delete(taskId);
  return true;
}

/**
 * （重）启动任务的看门狗定时器。
 *
 * ⚠️ P2 修复：原实现在提交后用一次 `setTimeout(JOB_TIMEOUT_MS)` 后即不再理会，
 * 长任务（如 WAN 81 帧生成）即便进度正常推进，5 分钟一到也被误判 FAILED，
 * 而此时 ComfyUI 后台仍在占 GPU。改为「有活动就续期」：每次收到进度 /
 * 执行事件都重置定时器，只有连续 JOB_TIMEOUT_MS 毫秒**毫无活动**才判定为
 * 真正的卡死（超时）。
 */
function armWatchdog(taskId: string, promptId: string) {
  const s = state();
  const existing = s.timers.get(taskId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    void fail(taskId, promptId, "生成超时");
  }, JOB_TIMEOUT_MS);
  s.timers.set(taskId, timer);
}

/** 轮询 history —— ComfyUI 是「先广播完成、后写 history」，直接读会扑空。 */
async function fetchHistoryEntry(promptId: string): Promise<any> {
  for (let i = 0; i < HISTORY_RETRIES; i++) {
    try {
      const hist = (await getHistory(promptId)) as any;
      const entry = hist?.[promptId];
      // outputs 落盘也可能晚一拍，等到有 outputs 或明确报错为止。
      if (entry && (entry.outputs || entry.status?.status_str)) return entry;
      if (entry && i >= 3) return entry; // 有条目但一直空 → 不再干等
    } catch {
      /* ComfyUI 短暂不可达，继续重试 */
    }
    await new Promise((resolve) => setTimeout(resolve, HISTORY_RETRY_DELAY_MS));
  }
  return null;
}

async function complete(taskId: string, promptId: string) {
  if (!claimSettle(taskId)) return;
  const s = state();
  const executedWorkflow = s.executedWorkflow.get(taskId) ?? null;
  try {
    await completeInner(taskId, promptId, executedWorkflow);
  } catch (e: any) {
    // 下载 / 落盘 / 写库任何一步炸了，都必须把任务收口，否则队列同样会卡死。
    await finalizeFailure(taskId, promptId, e?.message ?? "结果处理失败");
  }
}

type CollectedOutputs = {
  images: { filename: string; subfolder: string; type: string }[];
  videos: { filename: string; subfolder: string; type: string }[];
  audios: { filename: string; subfolder: string; type: string }[];
  others: { filename: string; subfolder: string; type: string }[];
  texts: string[];
};

/**
 * 从 ComfyUI history 的 outputs 中收集各类产物。
 * 纯函数，便于单测（P2：补齐 audio/text/3D，避免只认 images/videos 导致的死锁）。
 */
export function collectOutputs(outputs: Record<string, any>): CollectedOutputs {
  const images: { filename: string; subfolder: string; type: string }[] = [];
  const videos: { filename: string; subfolder: string; type: string }[] = [];
  const audios: { filename: string; subfolder: string; type: string }[] = [];
  const others: { filename: string; subfolder: string; type: string }[] = [];
  const texts: string[] = [];
  for (const nodeOut of Object.values(outputs)) {
    if (!nodeOut || typeof nodeOut !== "object") continue;
    if (Array.isArray(nodeOut.images)) images.push(...nodeOut.images);
    if (Array.isArray(nodeOut.videos)) videos.push(...nodeOut.videos);
    // VHS_VideoCombine emits its files under `gifs` (mp4/gif/webm).
    if (Array.isArray(nodeOut.gifs)) videos.push(...nodeOut.gifs);
    // SaveAudio / AudioComposite emit under `audios`.
    if (Array.isArray(nodeOut.audios)) audios.push(...nodeOut.audios);
    // ShowText / 任意文本输出节点：保留渲染文本（无文件）.
    if (typeof nodeOut.text === "string" && nodeOut.text.trim()) texts.push(nodeOut.text);
    else if (Array.isArray(nodeOut.text))
      for (const t of nodeOut.text) if (typeof t === "string" && t.trim()) texts.push(t);
    // 3D / 未知文件输出（Hunyuan3D、mesh、gltf…）：兜底收集任何其它
    // 「数组内含 {filename,...}」的输出，避免被静默丢弃。
    for (const [k, v] of Object.entries(nodeOut)) {
      if (k === "images" || k === "videos" || k === "gifs" || k === "audios" || k === "text") continue;
      if (Array.isArray(v) && v.length && v.every((it: any) => it && typeof it.filename === "string"))
        others.push(...v);
    }
  }
  return { images, videos, audios, others, texts };
}

async function completeInner(taskId: string, promptId: string, executedWorkflow: any = null) {
  const s = state();

  // 2026-08-13 项目级产出：读取任务归属的项目与请求参数，决定磁盘落点 +
  // 复现元数据。projectId 为 localStorage 的 CanvasProject.id（client 侧字符串）。
  const taskRow = await taskRepository.findExecutionMeta(taskId);
  const projectId: string | null = taskRow?.projectId ?? null;
  const taskParams = (taskRow?.params as Record<string, any>) ?? {};
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

  // R-ardot111 (2026-08-17): explicit "拉取 history" line so the
  // gap between "last node done" and "history is ready" is visible
  // — ComfyUI is async here (success signal lands before outputs
  // are persisted), so a hang in this window would otherwise look
  // like "the runner froze".
  log(taskId, "info", "🔍 拉取 ComfyUI history（最长 ~3s）…");
  const entry = await fetchHistoryEntry(promptId);
  if (!entry) {
    await finalizeFailure(taskId, promptId, "未找到生成结果");
    return;
  }
  const outputsCount = Object.keys(entry.outputs ?? {}).length;
  log(taskId, "info", `✓ history 就绪（${outputsCount} 节点输出）`);

  const msgs: any[] = entry.status?.messages ?? [];
  const errored = msgs.some((msg) => msg?.[0] === "execution_error");
  if (errored || entry.status?.status_str === "error") {
    const ex = msgs.find((msg) => msg?.[0] === "execution_error")?.[1]?.exception_message;
    await finalizeFailure(taskId, promptId, ex ?? "执行错误");
    return;
  }

  const { images, videos, audios, others, texts } = collectOutputs(entry.outputs ?? {});
  const hasOutput =
    images.length || videos.length || audios.length || texts.length || others.length;
  if (!hasOutput) {
    await finalizeFailure(taskId, promptId, "无输出内容");
    return;
  }

  // R-ardot62 (2026-08-15): KSampler 的真实 seed 不在 outputs 里，藏在
  // entry.prompt[2] 里（ComfyUI 0.33.1 history 格式）。`control_after_generate=
  // randomize` 时默认值是 UI 占位，server 实际抽的 seed 在 history graph
  // `inputs.seed/noise_seed` 字段。这里抽出后优先覆盖 `reqSeed`（用户填的）
  // 与 workflowHints（workflow 元数据），存到 `TaskImage.seed` + `Task.params.runtime`
  // 里让前端历史详情「生成参数卡」能展示真 seed。
  const runtime = extractRuntimeParams(entry);
  const actualSeed: number | undefined = runtime.seed;
  if (actualSeed !== undefined) {
    log(taskId, "info", `真实执行 seed = ${actualSeed}（${runtime.samplerClassType ?? "KSampler"}@${runtime.samplerNodeId ?? "?"}）`);
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

  // Videos (mp4 / gif / webm)
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i]!;
    const buf = await getView(v.filename, v.subfolder ?? "", v.type ?? "");
    const ext = path.extname(v.filename) || ".mp4";
    const fname = `vid_${i}${ext}`;
    await fs.writeFile(path.join(dir, fname), buf);
    saved.push({ localPath: `${publicBase}/${fname}`, mediaType: "video" });
    log(taskId, "info", `下载第 ${i + 1} 个视频`);
  }

  // Audio (SaveAudio / AudioComposite)
  for (let i = 0; i < audios.length; i++) {
    const a = audios[i]!;
    const buf = await getView(a.filename, a.subfolder ?? "", a.type ?? "");
    const ext = path.extname(a.filename) || ".wav";
    const fname = `aud_${i}${ext}`;
    await fs.writeFile(path.join(dir, fname), buf);
    saved.push({ localPath: `${publicBase}/${fname}`, mediaType: "audio" });
    log(taskId, "info", `下载第 ${i + 1} 个音频`);
  }

  // Generic 3D / unknown file outputs (mesh, gltf, obj, …)
  for (let i = 0; i < others.length; i++) {
    const o = others[i]!;
    const buf = await getView(o.filename, o.subfolder ?? "", o.type ?? "");
    const ext = path.extname(o.filename) || ".bin";
    const fname = `file_${i}${ext}`;
    await fs.writeFile(path.join(dir, fname), buf);
    saved.push({ localPath: `${publicBase}/${fname}`, mediaType: "other" });
    log(taskId, "info", `下载第 ${i + 1} 个文件`);
  }

  // Text outputs (ShowText): persist as .txt so the result is inspectable.
  for (let i = 0; i < texts.length; i++) {
    const fname = `txt_${i}.txt`;
    await fs.writeFile(path.join(dir, fname), texts[i]!, "utf-8");
    saved.push({ localPath: `${publicBase}/${fname}`, mediaType: "text" });
    log(taskId, "info", `保存第 ${i + 1} 段文本`);
  }

  // R-ardot62 (2026-08-15): 把真 seed + 采样器元数据一起回写 Task。
  // priority：actualSeed (history) > reqSeed (用户填) > null。`runtime` 块独立于
  // `params.seed` 字段（用户输入），便于审计「用户填了什么 vs server 跑的是什么」。
  const taskParamsPatched: Record<string, any> = { ...taskParams };
  if (Object.keys(runtime).length > 0) {
    taskParamsPatched.runtime = {
      ...(typeof taskParamsPatched.runtime === "object" && taskParamsPatched.runtime ? taskParamsPatched.runtime : {}),
      ...(actualSeed !== undefined ? { seed: actualSeed } : {}),
      ...(runtime.steps !== undefined ? { steps: runtime.steps } : {}),
      ...(runtime.cfg !== undefined ? { cfg: runtime.cfg } : {}),
      ...(runtime.sampler_name ? { sampler_name: runtime.sampler_name } : {}),
      ...(runtime.scheduler ? { scheduler: runtime.scheduler } : {}),
      ...(runtime.denoise !== undefined ? { denoise: runtime.denoise } : {}),
      ...(runtime.samplerClassType ? { sampler_class: runtime.samplerClassType } : {}),
      ...(runtime.samplerNodeId ? { sampler_node: runtime.samplerNodeId } : {}),
      source: "history",
    };
  }

  // ── 方案 B (2026-08-15): 任务完成时双写执行快照到 DB 行 ──
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
      seed:
        actualSeed !== undefined
          ? String(actualSeed)
          : reqSeed ?? null,
      width: s2.mediaType === "image" ? reqW ?? null : null,
      height: s2.mediaType === "image" ? reqH ?? null : null,
    }))
  );

  // 2026-08-13 项目级产出：写一份可复现的 manifest，便于「按项目归档 + 一键还原」。
  const manifest = {
    taskId,
    projectId,
    workflowName: taskRow?.workflowName ?? null,
    prompt: taskRow?.prompt ?? null,
    negativePrompt: taskRow?.negativePrompt ?? null,
    seed: actualSeed !== undefined ? String(actualSeed) : reqSeed ?? null,
    size: sizeStr || null,
    referenceImages: (taskRow?.referenceImages as string[] | null) ?? [],
    params: taskParams,
    createdAt: taskRow?.createdAt ?? null,
    files: saved,
  };
  await fs
    .writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8")
    .catch(() => undefined);

  // R-ardot65 (2026-08-15): 落盘本次执行实际用到的 workflow.json。种子等已在
  // manifest.seed + TaskImage.seed 持久化，工作流模板后续改动时凭这份快照即可
  // 完整复现本次生成结果。raw 路径为 liblib subgraph 格式（未展开），api 路径为
  // 已展开 graph。
  if (executedWorkflow != null) {
    await fs
      .writeFile(path.join(dir, "workflow.json"), JSON.stringify(executedWorkflow, null, 2), "utf-8")
      .catch(() => undefined);
  }

  await persistLogs(taskId);
  // R-ardot111 (2026-08-17): emit "总耗时 Xs" so the user can see
  // the wall-clock duration of the whole run.  Falls back to a
  // generic note if startedAt is missing (which can happen for
  // tasks enqueued in a previous server lifetime and re-claimed on
  // a re-attach — extremely rare).
  const startedAt = s.startedAt.get(taskId);
  if (startedAt) {
    const elapsedSec = Math.max(0, Math.round((Date.now() - startedAt) / 100) / 10);
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
  void processQueue();
}

/**
 * 从 ComfyUI history 的 prompt graph 里抽取本次执行**实际使用**的 KSampler 参数。
 *
 * 为什么需要这个？KSampler 的真实 seed 来自 server 端的 `control_after_generate`
 * 处理（randomize 时随机、increment/decrement 时上下浮动），写入 history 但**不**
 * 出现在 `entry.outputs` 里（outputs 只有图像文件）。前端看到的工作流默认 seed
 * 是 UI 元数据，对 randomize 节点而言不是真实执行值。
 *
 * 形态参考（来自 0.33.1 history entry.prompt[2]）：
 *   "76:69": {
 *     "class_type": "KSampler",
 *     "inputs": { "seed": 941524759465139, "steps": 25, "cfg": 4, "denoise": 0.7, ... }
 *   }
 *
 * 取 graph 顺序第一个 KSampler/KSamplerAdvanced 为主采样器。返回值所有字段都可能
 * 为 `undefined`，调用方自行决定是否覆盖请求默认值。
 */
export type RuntimeParams = {
  seed?: number;
  steps?: number;
  cfg?: number;
  sampler_name?: string;
  scheduler?: string;
  denoise?: number;
  samplerNodeId?: string;
  samplerClassType?: string;
};

export function extractRuntimeParams(entry: any): RuntimeParams {
  const out: RuntimeParams = {};
  const graph = entry?.prompt?.[2];
  if (!graph || typeof graph !== "object") return out;
  for (const [nid, nodeRaw] of Object.entries(graph)) {
    const node = nodeRaw as Record<string, unknown> | undefined;
    const t = typeof node?.class_type === "string" ? node.class_type : "";
    // KSamplerAdvanced 用 noise_seed；KSampler / SamplerCustom 用 seed。
    if (t !== "KSampler" && t !== "KSamplerAdvanced" && t !== "SamplerCustom") continue;
    const inputs = (node?.inputs ?? {}) as Record<string, unknown>;
    if (out.samplerNodeId === undefined) {
      out.samplerNodeId = nid;
      out.samplerClassType = t;
    }
    // 仅看第一个主采样器：后续出现的同类型不覆盖。
    if (out.samplerNodeId !== nid) continue;
    const seedRaw = inputs.noise_seed ?? inputs.seed;
    const n =
      typeof seedRaw === "number"
        ? seedRaw
        : typeof seedRaw === "string" && seedRaw.trim() !== "" && Number.isFinite(Number(seedRaw))
          ? Number(seedRaw)
          : undefined;
    if (typeof n === "number" && Number.isFinite(n) && out.seed === undefined) out.seed = n;
    if (typeof inputs.steps === "number" && out.steps === undefined) out.steps = inputs.steps;
    if (typeof inputs.cfg === "number" && out.cfg === undefined) out.cfg = inputs.cfg;
    if (typeof inputs.sampler_name === "string" && inputs.sampler_name && out.sampler_name === undefined)
      out.sampler_name = inputs.sampler_name;
    if (typeof inputs.scheduler === "string" && inputs.scheduler && out.scheduler === undefined)
      out.scheduler = inputs.scheduler;
    if (typeof inputs.denoise === "number" && out.denoise === undefined) out.denoise = inputs.denoise;
  }
  return out;
}

// Map raw ComfyUI/node errors to user-actionable hints.
//
// Why we don't just `String(raw)`: some ComfyUI builds (kaytool's v0.28
// included) emit `exception_message` as a structured object instead of a
// plain string, and tracebacks can be arrays of frames. A naive
// `Object.prototype.toString` would collapse all of those to
// "[object Object]", hiding the actual reason from the user.  This
// helper recursively peels known fields, falling back to a pretty-printed
// JSON dump so *something* informative always lands in `task.error`.
export function friendlyError(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (typeof raw === "bigint") return raw.toString();
  if (Array.isArray(raw)) {
    const parts = raw.map(friendlyError).filter((msg) => msg.trim() !== "");
    return parts.length ? parts.join("\n") : "";
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    // Ordered preference: ComfyUI's own canonical fields first, then
    // generic exception shape (Error.message / details / reason).
    const candidates: (keyof typeof o)[] = [
      "exception_message",
      "message",
      "error",
      "details",
      "reason",
      "msg",
      "detail",
      "description",
    ];
    for (const k of candidates) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    // Some ComfyUI exception_payloads nest `exception_message` deeper
    // (e.g. `{ data: { exception_message: "..." } }`).
    for (const k of ["data", "exception", "exception_payload"]) {
      const inner = o[k];
      if (inner && typeof inner === "object") {
        const innerText = friendlyError(inner);
        if (innerText.trim()) return innerText;
      }
    }
    // Last resort: pretty-print the object so the user at least sees
    // *something* other than "[object Object]".  Cap length so a
    // gigantic traceback payload can't blow up the DB column.
    try {
      const json = JSON.stringify(raw, null, 2);
      return json.length > 4000 ? json.slice(0, 4000) + "\n…(truncated)" : json;
    } catch {
      return "[unserializable error]";
    }
  }
  // Fallback for symbols / functions — should not happen, but be safe.
  if (typeof raw === "function") return raw.name || "[function]";
  if (typeof raw === "symbol") return Symbol.prototype.toString.call(raw);
  return "[unknown error]";
}

/** Build a human-readable failure message from ComfyUI's /prompt response.
 *  ComfyUI returns `node_errors` keyed by node id, each with `input_errors`
 *  (field → {message}) or a top-level `message`. Surface those instead of a
 *  generic "节点配置错误" so the user can fix the actual bad value. */
function buildPromptError(res: any, graph: Record<string, any>): string {
  // R69: previously `String(res.error)` — that collapses a structured
  // error object to the literal "[object Object]" and gets stored as
  // the task's error string, which then surfaces verbatim in the UI.
  // Reuse friendlyError so structured payloads (kaytool etc.) are
  // peeled to the real `.exception_message`/`.message`, and only the
  // true unknown-type cases fall through to a generic explanation.
  if (res?.error != null) {
    const peeled = friendlyError(res.error);
    const trimmed = peeled.trim();
    if (trimmed && trimmed !== "[object Object]") return peeled;
  }
  const ne = res?.node_errors;
  if (!ne || !Object.keys(ne).length) return "节点配置错误";
  const lines: string[] = [];
  for (const [nid, errRaw] of Object.entries(ne)) {
    if (typeof errRaw === "string") {
      lines.push(`节点 ${nid}: ${errRaw || "配置错误"}`);
      continue;
    }
    const err = errRaw as {
      class_type?: string;
      input_errors?: Record<string, unknown>;
      message?: string;
    };
    const cls = err.class_type ?? (graph?.[nid] as { class_type?: string } | undefined)?.class_type ?? "";
    let detail = "";
    if (err.input_errors) {
      detail = Object.entries(err.input_errors)
        .map(([k, v]) => `${k}: ${(v as { message?: string })?.message ?? (v as { details?: string })?.details ?? JSON.stringify(v)}`)
        .join("; ");
    } else if (typeof err.message === "string") {
      detail = err.message;
    }
    lines.push(`节点 ${nid}${cls ? ` (${cls})` : ""}: ${detail || "配置错误"}`);
  }
  return `节点配置错误:\n${lines.join("\n")}`;
}

/** 对外的失败入口：先抢终态，再收口。
 *  `validationErrors` 为可选的结构化校验错误（ComfyUI /prompt 的
 *  `node_errors` 拆解），仅在「提交即校验失败」路径传入；其它失败
 *  （超时/执行异常）不携带，落库为 null。 */
async function fail(
  taskId: string,
  promptId: string,
  error: unknown,
  validationErrors?: ValidationError[]
) {
  if (!claimSettle(taskId)) return;
  await finalizeFailure(taskId, promptId, error, validationErrors);
}

/** 真正的失败收口。**不做 settled 判断** —— 调用方必须已经抢到终态。
 *  `error` 故意放宽为 `unknown`：ComfyUI 的 `execution_error.exception_message`
 *  在某些版本（kaytool v0.28）里是结构化对象，`friendlyError` 会剥出真正的
 *  `.message`/`.exception_message`，而不是直接 toString() 成 "[object Object]"。*/
async function finalizeFailure(
  taskId: string,
  promptId: string,
  error: unknown,
  validationErrors?: ValidationError[]
) {
  const s = state();
  const friendly = friendlyError(error) || "任务失败";
  // R-ardot111 (2026-08-17): emit total elapsed time on the failure
  // branch too, so the user knows "this task actually ran for Xs
  // before failing" rather than "it died immediately".
  const startedAt = s.startedAt.get(taskId);
  const elapsedSuffix = startedAt
    ? `（已运行 ${Math.max(0, Math.round((Date.now() - startedAt) / 100) / 10)}s）`
    : "";
  log(taskId, "error", `✗ 生成失败：${friendly}${elapsedSuffix}`);

  await taskRepository.finalizeFailure(
    taskId,
    friendly,
    validationErrors?.length ? validationErrors : undefined
  );

  await persistLogs(taskId);
  // R-ardot111 (2026-08-17): clean up the per-task state we added so
  // a re-enqueue of the same taskId starts from a clean slate.
  if (startedAt) s.startedAt.delete(taskId);
  s.lastNodeByTask.delete(taskId);
  /* R-ardot116 (2026-08-18): previously finalizeFailure only emitted
   *  an `error` event.  The `error` event closes the SSE stream (see
   *  /api/tasks/[id]/stream/route.ts:54-59) so a `state` patch
   *  carrying structured `validationErrors` would never reach the
   *  client.  cancelTask() already does the right thing — it emits
   *  `state` first, then `error`.  Mirror that here so the panel
   *  gets the structured diagnostic *while the stream is still
   *  open* and patches d.validationErrors before the close.  Order
   *  matters: state first (heal UI), error second (close socket). */
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
  void processQueue();
}

/* ── comfy-cli execution path ───────────────────────────────────────────────
 * Raw UI-format workflows (e.g. liblib subgraph wrappers whose `rawJson` carries
 * a UUID `class_type` wrapper) cannot be POSTed directly to ComfyUI — the backend
 * rejects the UUID class_type. comfy-cli does the canonical client-side
 * UI→API conversion + subgraph expansion (the same `graphToPrompt` the official
 * frontend runs), so we delegate submission to it and harvest results through the
 * shared history→download→DB path (`complete`/`fail`).
 * ─────────────────────────────────────────────────────────────────────── */

export const cliProcs = new Map<string, ChildProcess>();
const CLI_TIMEOUT_MS = 25 * 60 * 1000;

/** Map an API-format node id (e.g. "76:67") or top-level id to the raw UI node. */
function resolveRawNode(raw: any, nodeId: string): any {
  const subs = raw?.definitions?.subgraphs;
  const subList: any[] = Array.isArray(subs) ? subs : Object.values(subs ?? {});
  if (nodeId.includes(":")) {
    const internalId = nodeId.split(":").pop()!;
    for (const sg of subList) {
      const n = (sg?.nodes ?? []).find((x: any) => String(x.id) === internalId);
      if (n) return n;
    }
    return null;
  }
  const top = (raw?.nodes ?? []).find((n: any) => String(n.id) === nodeId);
  if (top) return top;
  for (const sg of subList) {
    const n = (sg?.nodes ?? []).find((x: any) => String(x.id) === nodeId);
    if (n) return n;
  }
  return null;
}

/** Index of a named widget input within a UI node's `widgets_values` array. */
function widgetSlot(node: any, name: string): number {
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
export function applyRawOverrides(rawJson: any, overrides?: RawWorkflowOverride[]): any {
  if (!overrides?.length) return rawJson;
  const raw = JSON.parse(JSON.stringify(rawJson));
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
function seedWidgetSlot(node: any): number {
  const inputs = node?.inputs ?? [];
  let slot = 0;
  for (const inp of inputs) {
    if (!inp?.widget) continue;
    const wname = typeof inp.widget === "string" ? inp.widget : inp.widget.name ?? inp.name;
    if (typeof wname === "string" && /seed|noise_seed/i.test(wname)) return slot;
    slot++;
  }
  return -1;
}

async function executeViaComfyCli(job: Job) {
  const s = state();
  const { taskId, rawJson, overrides } = job;
  // R-ardot115 (2026-08-18): the entry line of the raw path so the
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

  const patched = applyRawOverrides(rawJson, overrides);
  const tmpDir = path.join(process.cwd(), ".workbuddy", "tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `wf-${taskId}.json`);
  log(taskId, "info", `写入临时工作流文件：${tmpFile}`);
  await fs.writeFile(tmpFile, JSON.stringify(patched), "utf-8");
  // R-ardot65 (2026-08-15): 记下本次实际提交给 ComfyUI 的 workflow（liblib
  // subgraph 未展开格式），任务完成落盘为 workflow.json 供完整复现。
  s.executedWorkflow.set(taskId, patched);
  log(
    taskId,
    "info",
    `工作流文件就绪（${Object.keys((patched)?.nodes ?? {}).length || Object.keys(patched).length} 节点）`
  );

  const binDir = process.platform === "win32" ? "Scripts" : "bin";
  const pyName = process.platform === "win32" ? "python.exe" : "python";
  const py = path.join(
    process.cwd(),
    ".workbuddy",
    "python-venv",
    "comfy-cli",
    binDir,
    pyName
  );
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

  // R-ardot115 (2026-08-18): surface the literal comfy-cli command so
  // the user (and we, on support) can reproduce the exact invocation
  // from the log panel without digging through devtools.
  log(
    taskId,
    "info",
    `comfy-cli 执行 raw 工作流（${host}:${port}）`
  );
  log(taskId, "info", `  ${pyName} ${args.join(" ")}`);
  // R-ardot111 (2026-08-17): explicit pre-spawn line so the user
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

  const child = spawn(py, args, {
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

  // R-ardot115 (2026-08-18): flatten /prompt errors returned via
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
  // R-ardot118 (2026-08-18): comfy-cli wraps the upstream /prompt
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
  const findNodeErrorsCarrier = (root: any, depth = 5): any => {
    if (!root || typeof root !== "object") return undefined;
    const seen = new WeakSet<any>();
    const stack: { node: any; d: number }[] = [{ node: root, d: 0 }];
    while (stack.length) {
      const { node, d } = stack.pop()!;
      if (d > depth || seen.has(node)) continue;
      seen.add(node);
      if (node && typeof node === "object") {
        const ne = (node).node_errors;
        if (ne != null && (Array.isArray(ne) ? ne.length : Object.keys(ne).length)) {
          return ne;
        }
        for (const v of Object.values(node)) {
          if (v && typeof v === "object") stack.push({ node: v, d: d + 1 });
        }
      }
    }
    return undefined;
  };

  const extractEnvelopeValidationErrors = (env: any): ValidationError[] | undefined => {
    const carrier = findNodeErrorsCarrier(env);
    if (!carrier) return undefined;
    return extractValidationErrors(carrier, patched);
  };

  const finish = (ok: boolean, env: any) => {
    if (settled) return;
    settled = true;
    clearTimeout(guard);
    cliProcs.delete(taskId);
    if (ok) {
      void complete(taskId, promptId ?? "");
    } else {
      const err = env?.error;
      const msg =
        (typeof err?.message === "string" ? err.message : undefined) ??
        (typeof err?.hint === "string" ? err.hint : undefined) ??
        "comfy-cli 执行失败";
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
        // Comprehensive-detection safety net (R-ardot118): the message
        // says "validation error" but the deep search found no
        // structured `node_errors`.  Dump the raw envelope (truncated)
        // so a support re-run can see the real shape instead of a
        // silent "Workflow has N validation error(s)" line.
        const rawMsg = typeof msg === "string" ? msg : "";
        if (/validation error/i.test(rawMsg) || env?.error?.code === "prompt_rejected") {
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
      let ev: any = null;
      try { ev = JSON.parse(line); } catch {
        // R-ardot115 (2026-08-18): surface non-JSON lines too so the
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
      if (ev.type === "queued" && ev.prompt_id) {
        promptId = ev.prompt_id;
        s.promptToTask.set(ev.prompt_id, taskId);
        void taskRepository
          .markRunning(taskId, ev.prompt_id)
          .catch(() => undefined);
        // R-ardot111 (2026-08-17): mirror the API-format branch's
        // "✓ 已接收…等待 executing" wording so the log panel shows a
        // consistent vocabulary across both submission paths.
        log(taskId, "info", `✓ comfy-cli 已提交（prompt_id: ${promptId}），等待节点执行…`);
      } else if (ev.type === "envelope") {
        finish(Boolean(ev.ok), ev);
      } else if (
        ev.type === "progress" &&
        typeof ev.completed === "number" &&
        typeof ev.total === "number" &&
        ev.total > 0
      ) {
        s.emitter.emit(taskId, {
          type: "progress",
          progress: Math.round((ev.completed / ev.total) * 100),
        });
      } else if (ev.type === "executing" || ev.type === "execution_success") {
        // R-ardot115 (2026-08-18): forward the raw CLI events for
        // per-node visibility (we can't map them back to the raw
        // graph class_type here without the original UUIDs, but the
        // node id + event type alone is enough to show "something is
        // running").
        const node = ev.node ?? ev.data?.node ?? "?";
        log(
          taskId,
          "info",
          ev.type === "execution_success"
            ? `✓ comfy-cli 节点 [${node}] 执行完成`
            : `▶ comfy-cli 节点 [${node}] 开始执行`
        );
      }
    }
  });

  // R-ardot115 (2026-08-18): stream stderr live so Python tracebacks
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

export async function processQueue() {
  const s = state();
  if (s.active >= MAX_CONCURRENCY) return;
  if (s.ws?.readyState !== WebSocket.OPEN) {
    void connect();
    return;
  }
  const job = s.queue.shift();
  if (!job) return;
  s.active += 1;

  try {
    // raw UI-format 工作流（含 liblib 子图 wrapper）：交给 comfy-cli 做
    // UI→API 转换 + 子图展开，原生客户端 graphToPrompt，绕开 UUID class_type。
    // R-ardot113 (2026-08-17): the previous `void executeViaComfyCli(job)`
    // (no .catch) was a *latent* active-slot deadlock.  If
    // `executeViaComfyCli` rejected synchronously (resolveComfyBase
    // throw, writeFile EACCES, spawn ENOENT on a missing Python
    // binary…), the rejection became an unhandled promise, no
    // fail()/finalizeFailure() ever ran, and `s.active` stayed
    // pegged at 1 forever.  That pegged slot then blocked every
    // later enqueue — task visible in the UI as "QUEUED 0%",
    // stuck indefinitely.  We now `.catch` the rejection and
    // funnel it through the same `finalizeFailure` path that
    // every other failure mode uses, so `s.active--` always fires
    // and the next queued job gets a chance.
    if (job.rawJson) {
      void executeViaComfyCli(job).catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log(job.taskId, "error", `raw 工作流启动异常：${msg}`);
        try {
          await finalizeFailure(job.taskId, "", msg);
        } catch (inner) {
          /* finalizeFailure may itself throw (DB down) — don't
           *  recurse into another catch, just log and release
           *  the slot manually so the queue keeps moving. */
          log(
            job.taskId,
            "error",
            `finalizeFailure 二次失败：${inner instanceof Error ? inner.message : String(inner)}`
          );
          if (s.startedAt.has(job.taskId)) s.startedAt.delete(job.taskId);
          s.lastNodeByTask.delete(job.taskId);
          s.active = Math.max(0, s.active - 1);
          void processQueue();
        }
      });
      return;
    }
    // 提交前剔除 bypass / mute / 纯前端节点(Reroute/Primitive/Note)，
    // 并对连线做穿透，严格对齐 ComfyUI 真实执行语义（P1：mode/Reroute）。
    const prep = prepareGraphForExecution(job.prompt!);
    // R-ardot65 (2026-08-15): 记下本次实际提交给 ComfyUI 的 graph（已展开、已穿透），
    // 任务完成落盘为 workflow.json 供完整复现。
    s.executedWorkflow.set(job.taskId, prep.graph);
    if (!Object.keys(prep.graph).length) {
      await fail(job.taskId, "", "工作流没有可执行的节点（可能全部被禁用）");
      return;
    }
    if (prep.removed.length) {
      log(
        job.taskId,
        "info",
        `执行前跳过 ${prep.removed.length} 个禁用/纯前端节点` +
          (prep.droppedInputs ? `，丢弃 ${prep.droppedInputs} 个悬空输入` : "")
      );
    }
    // R-ardot111 (2026-08-17): explicit pre-submit log so the user
    // sees a clear "→ 提交" line right before the HTTP POST to
    // ComfyUI.  Useful when /prompt hangs or rejects — without this
    // the user only ever sees the post-submit "✓ 已接收" line, which
    // makes it impossible to tell whether the request was ever sent.
    const nodeCount = Object.keys(prep.graph).length;
    log(job.taskId, "info", `→ 准备提交到 ComfyUI /prompt（${nodeCount} 节点）`);
    const res = (await postPrompt(prep.graph, CLIENT_ID)) as any;
    if (res.error || (res.node_errors && Object.keys(res.node_errors).length)) {
      // R-Next (2026-08-17): carry the flattened `node_errors` into the task
      // so the UI can show "节点 X · 字段 Y：消息" instead of just the
      // "Workflow has N validation error(s)" summary.
      const validationErrors = extractValidationErrors(res, prep.graph);
      // R-ardot116 (2026-08-18): mirror the raw-path branch's behaviour
      // (lines 1199-1224) — surface the structured list as per-line
      // log entries so the user sees "节点 X (KSampler) · 字段 cfg：…"
      // in the log panel *before* the closing "✗ 生成失败" line, and
      // not just the English summary from `buildPromptError`.  Without
      // this, a user staring at the panel saw one line ("✗ 生成失败:
      // Workflow has 6 validation error(s) against server") and no
      // way to identify which of the 6 fields to fix.  Capped at 12 to
      // match the raw branch and avoid blowing up the DB row when a
      // workflow drifts badly.
      if (validationErrors.length) {
        log(
          job.taskId,
          "error",
          `✗ ComfyUI 报 ${validationErrors.length} 条校验错误（见下方逐条 + 红框清单）`
        );
        validationErrors.slice(0, 12).forEach((ve) => {
          log(
            job.taskId,
            "error",
            `  · 节点 ${ve.nodeId}${ve.classType ? ` (${ve.classType})` : ""}` +
              (ve.field ? ` · 字段 ${ve.field}` : "") +
              `：${ve.message}`
          );
        });
        if (validationErrors.length > 12) {
          log(
            job.taskId,
            "error",
            `  …还有 ${validationErrors.length - 12} 条（请查看红框 / 重新执行工作流查看完整清单）`
          );
        }
      }
      await fail(
        job.taskId,
        "",
        buildPromptError(res, prep.graph),
        validationErrors
      );
      return;
    }
    const promptId: string = res.prompt_id;
    s.promptToTask.set(promptId, job.taskId);
    await taskRepository.markRunning(job.taskId, promptId);
    // R-ardot111 (2026-08-17): richer post-submit log so the user
    // can correlate the prompt_id they see in the panel with the
    // /history/{prompt_id} ComfyUI URL when investigating hangs.
    log(job.taskId, "info", `✓ ComfyUI 已接收（prompt_id: ${promptId}），等待首个 executing 事件…`);
    armWatchdog(job.taskId, promptId);
  } catch (e: any) {
    await fail(job.taskId, "", e?.message ?? "提交失败");
  }
}

/* R-ardot113 (2026-08-17): safety-net heartbeat.  `processQueue()`
 *  is normally driven by:
 *    (a) enqueue() right after the user clicks 生成
 *    (b) WS open  (line 181)
 *    (c) finalizeFailure / cancelTask (after active--)
 *
 *  In a few edge cases, none of these fire promptly:
 *    - The very first WS attempt fails during `new WebSocket()`,
 *      then `scheduleReconnect` defers the next attempt; during
 *      the back-off, a job sitting in `s.queue` has no trigger.
 *    - The handler that's supposed to call processQueue inside
 *      `executeViaComfyCli` runs, but the comfy-cli process spawn
 *      succeeds and the JS `spawn` promise resolves without ever
 *      emitting "queued" → no other life cycle re-fires it.
 *  Without a heartbeat, the user sees "QUEUED 0%" forever even
 *  though the slot is free and the WS is up.  We poll every 3s
 *  and re-run processQueue if it can make progress (queue non-
 *  empty, slot free, WS OPEN).  Idempotent — `processQueue` is a
 *  no-op when there's nothing to do.
 *
 *  Global flag to avoid double-heartbeats if the module is
 *  re-imported under HMR. */
const HEARTBEAT_MS = 3000;
let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
function startHeartbeat() {
  if (heartbeatHandle) return;
  heartbeatHandle = setInterval(() => {
    try {
      const s = state();
      if (s.queue.length > 0 && s.active < MAX_CONCURRENCY) {
        void processQueue();
      }
    } catch (err) {
      logger.warn(`[comfyui] heartbeat processQueue 失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, HEARTBEAT_MS);
}
startHeartbeat();
