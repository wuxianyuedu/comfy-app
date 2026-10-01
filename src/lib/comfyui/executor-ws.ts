/**
 * `executor-ws.ts` — WS 连接 / 消息处理 / 看门狗（executor 的通道层）
 * ===========================================================================
 *
 * 从 executor.ts 拆出的「事件通道」模块（batch 4）：负责建立并维持
 * ComfyUI WS 连接、统一消息分发（协议差异交给 comfyProtocol Adapter）、
 * 终态抢占（claimSettle）与活动看门狗（armWatchdog）。
 *
 * 消息的终态处理（complete / fail）在 {@link ./executor-finalize}，
 * 派发（领取 + 提交）在 {@link ./executor-dispatch}，本层只做路由。
 *
 * **当前拓扑下这条通道承载什么（ISSUE #1315 的取证结论，读数在 ADR §28）**：
 * 自 4-B3「唯一提交实现 = comfy-cli」之后，ComfyUI 只把**执行帧**（`executing` /
 * `progress` / `execution_success` / `execution_error`）发给排队那个 client，也就是
 * comfy-cli 自己那条连接；本连接收到的只有 `status` 与第三方节点的遥测广播
 * （本机一轮实测 35 条 = `status`×4 / `kaytool.resources`×16 / `dasiwa.system_monitor`×15，
 * **一条执行帧都没有**，inline 与 host 两种形态同形）。
 * ⇒ 下面那几段按节点分支（`node-started` / `node-finished` / `progress`）**今天是零消费的**，
 * 面板里的按节点现场只可能来自 {@link ./executor-cli-stream}。
 * **但别删它们**：它们是给「直连 `/prompt`」那种形态留的正确实现，帧哪天回来就得是对的；
 * 要在这条通道上补新功能，先照 ADR §28 的架子数一遍帧型，别写完发现测不出效果。
 *
 * @module comfyui/executor-ws — WS 连接 / 消息处理 / 看门狗（executor 的通道层）
 */
import WebSocket from "ws";
// `../core/repository` 静态值 import 改成 lazy（P3 §5 第 1 期·最后一步）——
// 本模块只用一个方法 `updateProgress`，其余 server-chain 依赖（logger 与
// resolveComfyBase via ./client）都是第三类，静态引不再牵 server-only throw。
import { errorText } from "~/lib/error-message";
import { fireAndForget } from "~/lib/async-action";
import { toPct } from "~/lib/progress";
import { logger } from "~/lib/core/logger";
import {
  probeComfyBase,
  resolveComfyBase,
  resetComfyBase,
  toWsBase,
} from "./client";
import { comfyProtocol, type ComfyWsMessage } from "./protocol-adapter";
import {
  state,
  log,
  claimSettle,
  CLIENT_ID,
  JOB_TIMEOUT_MS,
  WS_PATHS,
} from "./runner-state";
import { WS_RECONNECT, backoffDelayMs } from "../retry-policy";
import { complete, fail } from "./executor-finalize";
import { announceToQueuedTasks } from "./executor-continuation";
import {
  COMFYUI_AUTOSTART_TIMEOUT_MS,
  ensureComfyUiReady,
  isComfyAutoStartSuppressed,
} from "./lifecycle";
import { kickQueue } from "./executor-continuation";
import {
  fetchHistoryEntry,
  traceComfyQueue,
  type ComfyHistoryEntry,
} from "./executor-history";
import { trace } from "./trace";
import { classTypeForNode, nodeLabel } from "./graph-node-class";

/* 既有导入路径的兼容出口：这两个符号曾在本模块定义，现已下沉到叶子模块
 * （断环所需）。对外的名字与签名逐字不变，只换实现位置。 */
export { fetchHistoryEntry, traceComfyQueue };
export type { ComfyHistoryEntry };
/* 同款兼容出口：`claimSettle` 曾在本模块定义，已下沉到 runner-state（状态叶子）。 */
export { claimSettle };

/* ── 依赖注入接缝（P3 §5 第 1 期·最后一步：让 executor-ws 也能被纯 Node host 加载） ── */

async function loadRealTaskRepo() {
  return (await import("../core/repository")).taskRepository;
}
type TaskRepoForWs = Pick<
  Awaited<ReturnType<typeof loadRealTaskRepo>>,
  "updateProgress"
>;

export type ExecutorWsDeps = { taskRepo: TaskRepoForWs };
let depsOverride: Partial<ExecutorWsDeps> = {};

/** executor host 在 boot 时注入自带 DB 句柄；Next 侧无需（走 dynamic import 兜底）。 */
export function configureExecutorWs(next: Partial<ExecutorWsDeps>): void {
  depsOverride = { ...depsOverride, ...next };
}

async function resolveTaskRepo(): Promise<TaskRepoForWs> {
  if (depsOverride.taskRepo) return depsOverride.taskRepo;
  return loadRealTaskRepo();
}

/* 自动启动状态提示的防重复标记：仅在 WS 真正打开后复位，
   避免重连循环对同一段启动反复刷「未运行，正在自动启动」。 */
let comfyDownNotified = false;

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
    /* `resolveComfyBase()` 在「配置了路径、进程表又查不到 main.py」时不再抛错
     * （Comfy Desktop 的实例由 standalone-env 启动、命令行里没有 main.py，
     * 抛错会让 HTTP 探测一次都发不出去，见 ISSUE #344），改为回落配置地址。
     * 那条回落路径必须在这里补一次真实探测才能判定「能不能用」——否则
     * WS 会拿着一个连不上的地址去建连，自动启动也不再被触发。 */
    if (!(await probeComfyBase())) {
      throw new Error("Configured ComfyUI instance is not reachable");
    }
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
      announceToQueuedTasks("ComfyUI 未运行，正在自动启动…", "warn");
      announceToQueuedTasks(
        "启动完成后将自动继续执行当前工作流，请稍候",
        "info",
      );
      void ensureComfyUiReady({
        timeoutMs: COMFYUI_AUTOSTART_TIMEOUT_MS,
        // onLog 在单飞中被首次调用捕获；启动进程内的每一步 note 都会经这里
        // 写进队列任务的日志面板。
        onLog: (msg) => announceToQueuedTasks(`ComfyUI 启动：${msg}`),
      })
        .then((r) => {
          if (r.ok) {
            announceToQueuedTasks("ComfyUI 已就绪，继续执行工作流…", "success");
          } else {
            // 失败已经由 lifecycle 落了「不再自动重试」闩锁（ISSUE #335）：
            // 这里除了报告失败，还要把「为什么不再重试、怎么恢复」讲清楚，
            // 否则用户只看到一条错误，等不到重试也不知道该怎么办。
            announceToQueuedTasks(
              `ComfyUI 自动启动失败：${r.detail}\n已停止自动重试（避免反复刷同一条错误）；修好环境或到 设置 → 创作后端 点「启动 ComfyUI」即可恢复。`,
              "error",
            );
          }
        })
        .catch((err: unknown) => {
          logger.warn(`[comfyui] ${errorText(err, "自动启动失败")}`);
          announceToQueuedTasks(
            errorText(err, "ComfyUI 自动启动失败"),
            "error",
          );
        });
    } else if (!isComfyAutoStartSuppressed()) {
      // 自动启动已在单飞中进行：仅维持调用以保 isComfyStarting 为真，
      // 不再重复挂日志回调（否则启动完成会向队列刷多条「已就绪」）。
      // 但**必须挂一个 catch**——单飞的 promise 若因未预期路径 reject，
      // 上面 `if (!comfyDownNotified)` 分支那次调用已挂了 .then/.catch，
      // 这次「已经在飞」的分支若不接住，reject 就变成 unhandledRejection。
      fireAndForget(
        ensureComfyUiReady({ timeoutMs: COMFYUI_AUTOSTART_TIMEOUT_MS }),
        (e) => logger.warn(`[comfyui] ${errorText(e, "自动启动等待失败")}`),
      );
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
    kickQueue();
  });
  ws.on("message", (data) =>
    fireAndForget(handleMessage((data as Buffer).toString()), (e) =>
      logger.warn(`[comfyui] ${errorText(e, "handleMessage 异常")}`),
    ),
  );
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

/* 待触发的重连句柄。保存它有两个用途：`handleWsDrop` 幂等防叠加之外，
 * 在退避窗口内若再次调度（理论上不该发生，但事件双发时可能），先清掉旧的
 * 就不会排队两个 `connect()`。 */
let reconnectHandle: ReturnType<typeof setTimeout> | null = null;

function scheduleReconnect() {
  const s = state();
  /* 退避算法走 `~/lib/retry-policy` 的 {@link backoffDelayMs}（指数退避 + 上限，
   * 且 `2 ** attempt` 的夹取在出口里 —— 此前 8 这个数字内联在这里，看不出
   * 它是「防溢出」而不是「最多重试 8 次」，见 §16.2.4.49）。 */
  const delay = backoffDelayMs({
    ...WS_RECONNECT,
    attempt: s.reconnectAttempts++,
  });
  if (reconnectHandle) clearTimeout(reconnectHandle);
  reconnectHandle = setTimeout(() => {
    reconnectHandle = null;
    fireAndForget(connect(), (err) =>
      logger.warn(`[comfyui] ${errorText(err, "WS 重连失败")}`),
    );
  }, delay);
}

/**
 * 不带 `prompt_id` 的 WS 帧：**每类只留第一帧**的证据。
 *
 * 为什么要有这一条（ISSUE #1315 取证的前提）：以前这一跳是静默 `return`，而三个
 * 「会落 trace」的出口都在它之后 —— 于是「WS 一条帧都没来」与「帧来了但不带
 * `prompt_id`」在诊断文件里长得一模一样，谁也分不开。本机数第一轮是 35 条：
 * `status`×4 / `kaytool.resources`×16 / `dasiwa.system_monitor`×15，全是第三方节点的
 * 遥测与状态广播，**没有一条执行帧**。
 *
 * 为什么逐帧不落：上面那 35 条里三分之二是同一个类型的重复行，遥测约 1s 一条，
 * 长会话一小时就是几千行诊断噪声，而这个问题只需要「这类帧来过」这一个事实。
 *
 * 计数放在模块级（不是 `RunnerState`）：纯诊断，跨 HMR 丢了计数不影响任何判决，
 * 不值得为它升那份单例键的版本；类型数设上限，免得被异常服务刷成一个无界集合。
 */
const unownedFrameTypes = new Set<string>();
const UNOWNED_FRAME_TYPE_MAX = 32;

function noteUnownedFrame(type: string, dataKeys: string[]): void {
  if (unownedFrameTypes.has(type)) return;
  if (unownedFrameTypes.size >= UNOWNED_FRAME_TYPE_MAX) return;
  unownedFrameTypes.add(type);
  trace("ws", null, "WS 帧不带 prompt_id（跳过归属）", { type, dataKeys });
}

/**
 * 统一 WS 消息入口。所有协议判断（标准 ComfyUI vs kaytool v0.28 非标准信号）
 * 都委托给 `comfyProtocol` Adapter，协议差异只存在于 protocol-adapter.ts。
 *
 * 导出只给用例（`executor-ws.test.ts` 里那条 #1202 的判据：喂一帧 `progress`，
 * 断言落库的 `progressNode` 带类名与中文标签）—— 真连接由 `connect()` 挂上去，
 * 别处不该直接调它。
 */
export async function handleMessage(raw: string) {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    /* ISSUE #216：WS 帧解析不了也必须留证，否则「ComfyUI 明明发了消息但我们没反应」
     *  这类问题在日志里完全不可见。 */
    trace("ws", null, "WS 消息非合法 JSON", { raw });
    return;
  }
  if (!msg || typeof msg !== "object") return;
  // ComfyUI WS 消息的最小结构视图（协议判断委托给 comfyProtocol Adapter）。
  const message = msg as ComfyWsMessage;
  const data = message.data ?? {};
  const promptId: string | undefined =
    typeof data.prompt_id === "string" ? data.prompt_id : undefined;
  if (!promptId) {
    /* #1315 取证的前提：这一跳以前是**静默**的，于是「WS 到底有没有帧进来」在 trace 里
     * 数不出来（其余三个 `trace("ws", …)` 出口都在它之后）。本机第一次数出来的是
     * 一轮 35 条：`status`×4 / `kaytool.resources`×16 / `dasiwa.system_monitor`×15
     * —— 全是第三方节点的遥测与状态广播，**没有一条执行帧**。
     * 所以留证要按类型节流：逐帧落盘的话，一轮里三分之二是同一个类型的重复行，
     * 长会话一小时就是几千行，而它回答的问题只需要「这类帧来过、大概多久一条」。
     * 只记类型与 `data` 的键（`status` 的 data 里带着 `exec_info`，整帧抄进日志没用又大）。 */
    noteUnownedFrame(
      typeof message.type === "string" ? message.type : "(无 type)",
      Object.keys(data).slice(0, 8),
    );
    return;
  }
  const s = state();
  const taskId = s.promptToTask.get(promptId);
  if (!taskId) {
    /* 无归属任务的 ComfyUI 帧（例如别处提交的 prompt）——只落 trace，不进面板。 */
    trace("ws", null, "WS 消息无归属任务", { promptId, message: msg });
    return;
  }
  /* ISSUE #216：本任务所有 WS 帧原文落 trace；面板侧仍只显示解析后的事件行。 */
  trace("ws", taskId, "WS 消息", { promptId, message: msg });

  const signal = comfyProtocol.classify(message);

  // 任何来自 ComfyUI 的活动（节点开始执行 / 进度推进）都续期看门狗，
  // 避免长任务被 5 分钟硬超时误杀（P2 修复）。完成/错误分支走 claimSettle
  // 会清掉定时器，这里刷新无害。
  if (
    signal === "node-started" ||
    signal === "node-finished" ||
    signal === "progress"
  ) {
    armWatchdog(taskId, promptId);
  }

  if (signal === "node-started") {
    // 某节点开始执行 —— 打进日志，让进度对用户透明。
    const nodeId = String(data.node);
    /* 类名从**真正提交出去的那张图**里认（`executedWorkflow`），API 图与 RAW 原件两种
     * 形状都认。此前读的是 `promptByTask`，而那份写入方随 4-B3 删掉 `enqueue()` 一起
     * 消失了 ⇒ 这一格恒空，日志永远打成「▶ 节点 [3] 未知节点（?）」（ISSUE #1202）。
     * 认不出仍然是 undefined、仍然打 "?"，不猜。 */
    const classType = classTypeForNode(s.executedWorkflow.get(taskId), nodeId);
    /* 记下这个节点，等 ComfyUI 下一条 `executing` 把 `data.node` 发成 null 时，
     * 就能补上它的完成行 —— 于是日志从孤零零一行 "▶ KSampler"，变成
     * "▶ KSampler → ✔ KSampler" 的成对时间线。 */
    s.lastNodeByTask.set(taskId, {
      node: nodeId,
      classType: classType ?? "",
      t: Date.now(),
    });
    log(
      taskId,
      "info",
      `▶ 节点 [${nodeId}] ${nodeLabel(classType)}（${classType ?? "?"}）`,
    );
    return;
  }

  /* ComfyUI 用「executing → node 为 null」表示上一个节点跑完。此时若
   * lastNodeByTask 里有记录，就补一行 "✔ 完成"，让用户看到按节点的时间线。
   * 只对直连 /prompt 这条路做 —— comfy-cli 路径自己会在 executeViaComfyCli
   * 里打 "▶ 节点 N/total"。 */
  if (signal === "node-finished") {
    const last = s.lastNodeByTask.get(taskId);
    if (last) {
      const dur = Math.max(0, Math.round((Date.now() - last.t) / 100) / 10);
      log(
        taskId,
        "info",
        `✔ 节点 [${last.node}] ${nodeLabel(last.classType)} 完成（${dur}s）`,
      );
      s.lastNodeByTask.delete(taskId);
    }
  }

  if (signal === "progress") {
    const value = Number(data.value ?? 0);
    const max = Number(data.max ?? 1);
    /* 「值 / 上限 → 百分比」收在 `~/lib/progress`：上限不可用（≤0 / 非有限）
     * 时它返回 `null`，这里落回 0 —— 落库的 `progress` 是**确定值**语义。 */
    const pct = toPct(value, max) ?? 0;
    // progress 消息自带 node id——把节点 id / 类别名 / 步数一并
    // 发给前端，画布与管线节点才能显示「当前节点 + 百分比」而不仅是总数。
    let node:
      | {
          id: string;
          label?: string;
          classType?: string;
          value: number;
          max: number;
        }
      | undefined;
    const rawNodeId: unknown = data.node;
    const nodeId =
      typeof rawNodeId === "string" || typeof rawNodeId === "number"
        ? String(rawNodeId)
        : null;
    if (nodeId) {
      const classType = classTypeForNode(
        s.executedWorkflow.get(taskId),
        nodeId,
      );
      node = {
        id: nodeId,
        value,
        max,
        /* `classType` 与 `label` 都存（P3 §5 ADR §14 D1 的 4-B2）：`label` 是给
         * 画布看的中文标签，而状态栏那一格历史上显示的是**类名**（此前只活在内存
         * 的 `lastNodeByTask` 里，host 执行时 Next 读不到）。类名跟着快照一起落库，
         * 两个宿主才是同一份契约；认不出类名时两者都不带。 */
        ...(classType ? { classType, label: nodeLabel(classType) } : {}),
      };
    }
    /* 进度回写走「只在非终态行生效」的 compare-and-set：本任务若已被
     *  reaper 判终态、或被用户取消，说明这一轮结果不再归我们，迟到的进度
     *  帧**必须被丢弃**。否则 DB 行会从终态被打回 RUNNING，SSE 的 3s 实情
     *  轮询先看到终态关掉了流，客户端就永远卡在「生成中…」（用户看不到
     *  任何失败出口，只能刷新）。
     *  node 一并落库（P3 §5 ADR §13-3C D1）：SSE 单源化后节点进度只能从 DB
     *  读；无节点信息的帧传 undefined，impl 侧不覆写原值。 */
    const taskRepository = await resolveTaskRepo();
    if (!(await taskRepository.updateProgress(taskId, pct, node))) {
      log(
        taskId,
        "warn",
        "忽略迟到进度：本任务已由其它路径收口（终态不再改写）",
      );
      return;
    }

    // 里程碑日志做节流，避免面板被刷得读不动。
    const last = s.lastLogPct.get(taskId) ?? -1;
    if (pct - last >= 25 || pct === 100) {
      s.lastLogPct.set(taskId, pct);
      log(taskId, "progress", `采样进度 ${pct}%`);
    }
    return;
  }

  /* 完成信号有两条口径：标准 ComfyUI 发 `executing` 且 node 为 null；
   * kaytool 构建（v0.28）改发 `execution_success`。两者都要认。 */
  if (signal === "completion") {
    await complete(taskId, promptId);
  } else if (signal === "error") {
    /* ISSUE #216：WS 错误信号此前只取 exception_message 一个字段，节点定位 /
     *  traceback 全丢。原文进 trace，面板给可见出口。 */
    trace("ws", taskId, "ComfyUI 报执行错误（WS）", { promptId, data });
    log(
      taskId,
      "error",
      "ComfyUI 通过 WebSocket 报执行错误，完整消息见 log/comfyui/comfyui-trace.log",
    );
    await fail(taskId, promptId, data.exception_message ?? "执行错误");
  }
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
    fireAndForget(fail(taskId, promptId, "生成超时"), (e) =>
      logger.warn(`[comfyui] ${errorText(e, `fail(${taskId}) 超时收口异常`)}`),
    );
  }, JOB_TIMEOUT_MS);
  s.timers.set(taskId, timer);
}
