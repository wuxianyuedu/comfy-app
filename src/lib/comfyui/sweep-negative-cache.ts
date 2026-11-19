// 进程表「确认查无此实例」的短窗黏滞缓存（ISSUE #4195）。
//
// 背景：ComfyUI **运行中**时，状态判定走便宜路径（配置端口一探即中，见
// status.ts 的步骤 1.5）；**关停后**每一拍状态轮询都会落进最重路径——
// 最多约 6 个解释器候选**并发起 PowerShell 枚举 Win32_Process**（单个
// ~2.5s、超时上限 10s），且 status 与 instance-port 两条判据链各扫一遍。
// 实例明明已经不在了，这些扫描仍每拍照付，实测连续轰击 9 分钟以上。这段
// 时间里机器被 WMI 查询占满，页面对应用服务的同源连接池被自家慢请求占满，
// 2s 一拍的探活连续超时——好好的服务被误报成「应用服务已断开」（同一根因
// 的两侧：资源风暴 + 探活饿死）。
//
// 做法：一次**结论可信**的完整扫描（没有任何候选命中、也没有任何查询失败）
// 把「这条配置路径下当前没有实例进程」黏滞 {@link SWEEP_NEGATIVE_TTL_MS}；
// 窗口内的后续判定只做便宜探测（bound 子进程、配置端口探测、端口扫描），
// 不再重复发起进程表扫描。外部实例落在配置端口上仍由端口探测即时认出
//（#339 的主场景不受影响）；落在偏移端口由端口扫描认出——本缓存只免掉
// 「按路径找进程」那一跳，不碰任何端口事实。
//
// 时长取 30s：同一份「查无实例」事实要喂给两条节拍——设置页 5s 一拍的状态
// 轮询，与 reaper 的 30s 拍距（ISSUE #4198：窗口短于拍距时，reaper 每一拍都
// 会把刚过期的黏滞重新扫一遍，卡住的任务多久、无谓的 WMI 轰击就多久）。检测
// 不受窗口变长影响：实例落回配置端口由端口探测即时认出（快照步骤 1.5 与
// resolveComfyBase 的端口扫描每拍照跑、不经过本缓存），偏移端口由偏移扫描
// 认出；「进程在、端口未绑定」的启动中场景由 `COMFY_STARTING_WINDOW_MS`
//（12s）与 force 复核兜底。`COMFY_NOT_RUNNING_HOLD_MS`（10s）仍管「未运行」
// 这个**结论**对状态行的黏滞，两者各管各的。
//
// 作废时机：任何「进程树事实即将/已经变化」的动作（手动启动 / 关闭 / 配置
// 保存 / 会话结束）都会走 `resetComfyRuntimeSnapshot()`，它在作废快照的同时
// 调用 {@link clearSweepNegative}；扫描命中实例（running）时也当即作废——
// 负面结论在「知道它在跑」的那一刻天然过期。
//
// §18.4 三选一：本模块走第三类（纯 Node 宿主）——零依赖、零 IO，只做时刻
// 比对；登记进 `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`
// 语义（无 server-only、无 Node API 之外的平台依赖）。

/** 负面结论的黏滞时长（毫秒）。取 30s：对齐 reaper 的拍距（`REAPER_MS`，
 *  ISSUE #4198），让 30s 一拍的 reaper 也落在同一份黏滞里；状态轮询与检测
 *  语义见文件头「时长」段。 */
export const SWEEP_NEGATIVE_TTL_MS = 30_000;

/** 最多记几条：键是配置路径，本机实际上只有一条；上限只为防「路径被反复改」
 *  这类病态输入让 Map 无界生长，到顶即淘汰最早写入的一条（Map 保持插入序）。 */
const SWEEP_NEGATIVE_MAX_ENTRIES = 8;

type SweepCacheGlobal = {
  /** 配置路径 → 最近一次「确认查无实例」的时刻（毫秒）。 */
  negativeAt?: Map<string, number>;
};

declare global {
  var __comfySweepNegative_v1: SweepCacheGlobal | undefined;
}

/** 取（或建）跨模块实例存活的存储（HMR 重载不丢：与 status.ts 的
 *  `__comfyRuntimeSnapshot_v1` 同一取向）。 */
function store(): Map<string, number> {
  const holder = (globalThis.__comfySweepNegative_v1 ??= {});
  return (holder.negativeAt ??= new Map<string, number>());
}

/** 该配置路径的「确认查无实例」是否仍在黏滞窗口内。 */
export function sweepNegativeHit(key: string, now: number = Date.now()): boolean {
  if (key === "") {
    return false;
  }
  const at = store().get(key);
  return at !== undefined && now - at < SWEEP_NEGATIVE_TTL_MS;
}

/** 记下「这条路径刚刚被完整扫描过、确认没有实例进程」。 */
export function markSweepNegative(key: string, now: number = Date.now()): void {
  if (key === "") {
    return;
  }
  const map = store();
  if (map.size >= SWEEP_NEGATIVE_MAX_ENTRIES && !map.has(key)) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }
  map.set(key, now);
}

/** 作废全部负面黏滞：进程树事实已变（启动 / 关闭 / 配置保存）或扫描命中了实例。 */
export function clearSweepNegative(): void {
  store().clear();
}

/** 只给用例：清空存储。生产代码不得调用。 */
export function resetSweepNegativeForTests(): void {
  clearSweepNegative();
}
