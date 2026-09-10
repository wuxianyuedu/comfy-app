/**
 * `executor-ws.ts` — WS 连接 / 消息处理 / 看门狗（executor 的通道层）
 * ===========================================================================
 *
 * 从 executor.ts 拆出的「事件通道」模块（batch 4）：负责建立并维持
 * ComfyUI WS 连接、统一消息分发（协议差异交给 comfyProtocol Adapter）、
 * 终态抢占（claimSettle）与活动看门狗（armWatchdog）。
 *
 * 消息的终态处理（complete / fail）在 {@link ./executor-finalize}，
 * 队列调度（processQueue）在 {@link ./executor-scheduler}，本层只做路由。
 *
 * @module comfyui/executor-ws
 */
import WebSocket from "ws";
import { taskRepository } from "../core/repository";
import { logger } from "~/server/lib/logger";
import {
  getHistory,
  resolveComfyBase,
  resetComfyBase,
  toWsBase,
} from "./client";
import { comfyProtocol, type ComfyWsMessage } from "./protocol-adapter";
import {
  state,
  log,
  CLIENT_ID,
  JOB_TIMEOUT_MS,
  HISTORY_RETRIES,
  HISTORY_RETRY_DELAY_MS,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  WS_PATHS,
  type LogEntry,
} from "./runner-state";
import { complete, fail } from "./executor-finalize";
import {
  COMFYUI_AUTOSTART_TIMEOUT_MS,
  ensureComfyUiReady,
  isComfyAutoStartSuppressed,
} from "./lifecycle";
import { processQueue } from "./executor-scheduler";

/* 自动启动状态提示的防重复标记：仅在 WS 真正打开后复位，
   避免重连循环对同一段启动反复刷「未运行，正在自动启动」。 */
let comfyDownNotified = false;

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
 * ComfyUI `GET /history/{prompt_id}` 单条条目的最小结构视图
 * （外部输入，字段仅取本层与 finalize / outputs 层实际读取的部分；
 * 结构对照 0.33.1：`outputs`、`status.status_str`、`status.messages`、
 * `prompt`（prompt graph 数组，`prompt[2]` 为 API graph））。
 */
export type ComfyHistoryEntry = {
  outputs?: Record<string, unknown>;
  status?: {
    status_str?: string;
    messages?: unknown[];
  };
  prompt?: unknown;
};

/**
 * 把一条执行日志同时打到当前队列里所有等待任务上。
 *
 * ComfyUI 未运行触发自动启动时，队列任务（工作流库「就地运行」/ 画布节点）
 * 都停在 QUEUED 等待 WS 打开；这条消息让它们在执行日志面板里明确看到
 * 「ComfyUI 未运行，正在自动启动…」「已就绪，继续执行」，而不是只显示
 * 无信息的「任务已加入执行队列」并长时间卡在 0%（用户会误以为任务连接中断）。
 */
function logToQueuedTasks(msg: string, level: LogEntry["level"] = "info"): void {
  for (const job of state().queue) {
    log(job.taskId, level, msg);
  }
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
    // ComfyUI 不可达：若配置了安装路径 + 自动启动，则按需拉起并等待就绪。
    // 队列任务在 WS 未 OPEN 时不会出队，此前只能等 reaper 30s 判死；
    // 现在启动成功后下一次重连即可打开 WS，任务恢复正常执行。
    // 这里必须带超时上限：无限等待会让 isComfyStarting 一直为真，
    // reaper 的「启动窗口期跳过回收」被无限拉长，队列任务永远卡住。
    //
    // 把自动启动的状态实时同步给排队任务：未运行→启动中→就绪/失败 都写进
    // 各自执行日志面板，用户能看到「ComfyUI 未运行，正在自动启动…」并在
    // 启动完成后看到「已就绪，继续执行工作流」，而不是 0% 干等或误报
    // 「任务连接中断」。
    //
    // 只挂一次 then/catch 与 onLog：single-flight 令后续重连调用返回同一个
    // promise，若每次都挂 then，启动完成时会向队列重复刷「已就绪」多遍。
    if (!comfyDownNotified) {
      comfyDownNotified = true;
      logToQueuedTasks("ComfyUI 未运行，正在自动启动…", "warn");
      logToQueuedTasks("启动完成后将自动继续执行当前工作流，请稍候", "info");
      void ensureComfyUiReady({
        timeoutMs: COMFYUI_AUTOSTART_TIMEOUT_MS,
        // onLog 在单飞中被首次调用捕获；启动进程内的每一步 note 都会经这里
        // 写进队列任务的日志面板。
        onLog: (msg) => logToQueuedTasks(`ComfyUI 启动：${msg}`),
      })
        .then((r) => {
          if (r.ok) {
            logToQueuedTasks("ComfyUI 已就绪，继续执行工作流…", "success");
          } else {
            // 失败已经由 lifecycle 落了「不再自动重试」闩锁（ISSUE #335）：
            // 这里除了报告失败，还要把「为什么不再重试、怎么恢复」讲清楚，
            // 否则用户只看到一条错误，等不到重试也不知道该怎么办。
            logToQueuedTasks(
              `ComfyUI 自动启动失败：${r.detail}\n已停止自动重试（避免反复刷同一条错误）；修好环境或到 设置 → 创作后端 点「启动 ComfyUI」即可恢复。`,
              "error",
            );
          }
        })
        .catch((err: unknown) => {
          logger.warn(
            `[comfyui] 自动启动失败：${err instanceof Error ? err.message : String(err)}`
          );
          logToQueuedTasks(
            `ComfyUI 自动启动失败：${err instanceof Error ? err.message : String(err)}`,
            "error",
          );
        });
    } else if (!isComfyAutoStartSuppressed()) {
      // 自动启动已在单飞中进行：仅维持调用以保 isComfyStarting 为真，
      // 不再重复挂日志回调（否则启动完成会向队列刷多条「已就绪」）。
      void ensureComfyUiReady({ timeoutMs: COMFYUI_AUTOSTART_TIMEOUT_MS });
    }
    // 自动启动已被闩锁抑制（启动失败 / 用户手动关闭）时不重连：重连只会每
    // 15s 走一遍「探测失败 → 讨要启动 → 被闩锁拦下」的空转（ISSUE #335）。
    // 真正需要重连时机由用户动作带回（手动启动成功会写 st.child / 端口可达），
    // 而 status 轮询与后续 enqueue 会再次触发 connect()。
    if (!isComfyAutoStartSuppressed()) scheduleReconnect();
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
    // WS 就绪：清掉排队期写入的「等待连接」提示标记，避免下次断线重连时
    // 同一任务被 wsWaitLogged 挡住而无法重新提示；同时复位自动启动提示标记，
    // 供本次连接断开后的重新提示使用。
    s.wsWaitLogged.clear();
    comfyDownNotified = false;
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
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg || typeof msg !== "object") return;
  // ComfyUI WS 消息的最小结构视图（协议判断委托给 comfyProtocol Adapter）。
  const message = msg as ComfyWsMessage;
  const data = message.data ?? {};
  const promptId: string | undefined =
    typeof data.prompt_id === "string" ? data.prompt_id : undefined;
  if (!promptId) return;
  const s = state();
  const taskId = s.promptToTask.get(promptId);
  if (!taskId) return;

  const signal = comfyProtocol.classify(message);

  // 任何来自 ComfyUI 的活动（节点开始执行 / 进度推进）都续期看门狗，
  // 避免长任务被 5 分钟硬超时误杀（P2 修复）。完成/错误分支走 claimSettle
  // 会清掉定时器，这里刷新无害。
  if (signal === "node-started" || signal === "node-finished" || signal === "progress") {
    armWatchdog(taskId, promptId);
  }

  if (signal === "node-started") {
    // A node started executing — surface it in the log for transparency.
    const graph: Record<string, unknown> | undefined = s.promptByTask.get(taskId);
    const graphNode = graph?.[String(data.node)];
    const classTypeRaw =
      graphNode && typeof graphNode === "object"
        ? (graphNode as Record<string, unknown>).class_type
        : undefined;
    // class_type 正常是 string；非 string 时保留原值（断言仅收口类型，
    // 运行时与原 any 行为逐值一致：nodeLabel 内部按 string 键查表）。
    const classType =
      typeof classTypeRaw === "string"
        ? classTypeRaw
        : classTypeRaw != null
          ? (classTypeRaw as string)
          : undefined;
    const nodeId = String(data.node);
    // remember this node so we can log its
    // completion when ComfyUI emits the next `executing` with
    // `data.node === null`.  This turns a "▶ KSampler" line into a
    // proper "▶ KSampler → ✔ KSampler" pair.
    s.lastNodeByTask.set(taskId, { node: nodeId, classType: classType ?? "", t: Date.now() });
    log(taskId, "info", `▶ 节点 [${nodeId}] ${nodeLabel(classType)}（${classType ?? "?"}）`);
    return;
  }

  // when ComfyUI signals the previous node
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
    // progress 消息自带 node id——把节点 id / 类别名 / 步数一并
    // 发给前端，画布与管线节点才能显示「当前节点 + 百分比」而不仅是总数。
    let node: { id: string; label?: string; value: number; max: number } | undefined;
    const rawNodeId: unknown = data.node;
    const nodeId =
      typeof rawNodeId === "string" || typeof rawNodeId === "number"
        ? String(rawNodeId)
        : null;
    if (nodeId) {
      const graph: Record<string, unknown> | undefined = s.promptByTask.get(taskId);
      const graphNode = graph?.[nodeId];
      const classTypeRaw =
        graphNode && typeof graphNode === "object"
          ? (graphNode as Record<string, unknown>).class_type
          : undefined;
      const classType = typeof classTypeRaw === "string" ? classTypeRaw : undefined;
      node = {
        id: nodeId,
        value,
        max,
        ...(classType ? { label: nodeLabel(classType) } : {}),
      };
    }
    s.emitter.emit(taskId, { type: "progress", progress: pct, node });

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
export function claimSettle(taskId: string): boolean {
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
export function armWatchdog(taskId: string, promptId: string) {
  const s = state();
  const existing = s.timers.get(taskId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    void fail(taskId, promptId, "生成超时");
  }, JOB_TIMEOUT_MS);
  s.timers.set(taskId, timer);
}

/** 轮询 history —— ComfyUI 是「先广播完成、后写 history」，直接读会扑空。 */
export async function fetchHistoryEntry(promptId: string): Promise<ComfyHistoryEntry | null> {
  for (let i = 0; i < HISTORY_RETRIES; i++) {
    try {
      const hist = await getHistory(promptId);
      const entry = hist?.[promptId] as ComfyHistoryEntry | undefined;
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
