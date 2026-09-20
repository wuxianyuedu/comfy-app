/* ── 「`unknown` 是不是一个纯对象」的唯一出口（规范 16 §16.2.4.44）────────────
 *
 * 这个三行的类型守卫在全库有 **9 份实现**，其中 8 份逐字相同（唯一的差别是
 * 形参叫 `v` 还是 `value`）：
 *
 *   REST 路由 4 份（`api/custom-nodes`、`api/llm`、`api/llm/test`、`api/llm/models`
 *   里各自的本地函数）
 *   `src/lib/workshop/api-channel-shared.ts`（导出）
 *   `src/lib/llm/usage-test.server.ts`（导出）
 *   `lib` 侧 3 份本地函数（`llm/ollama-client`、`workshop/script-parse`、
 *   `media/materials-client`）
 *
 * 它们的「不一致」目前只体现在形参名上 —— 但那正是这类账的典型形态：
 * 一份守卫一旦要被改（例如排除数组、排除 `Date`），九处就会各自漂移，
 * 而**消费侧看不出自己吃的是哪一份**。同一份判据只允许一处定义。
 *
 * 为什么放 `src/lib` 根（而不是某个子域）：它同时被**客户端**（`materials-client`
 * 收窄 fetch 响应）、**服务端域模块**（`usage-test.server` / `api-channel-shared`）
 * 与**REST 路由**读取，进任何子域都会让另两个反向依赖它 —— 与 `display-value` /
 * `list-filter` / `format-bytes` 同款：顶层单例（`DOMAIN_EXEMPT` 登记）。
 *
 * ⚠️ 它**不**排除数组（`typeof [] === "object"` 且非 `null`）—— 这是 8 份实现
 * 的共同行为，本出口保持不变（改判据会静默改变九处消费点的收窄结果）。
 * 需要「纯对象、非数组」时用 `isPlainRecord`。
 */

/** `unknown` 收窄成 `Record<string, unknown>`（数组也算，与既有九处同口径）。 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * 收窄成「**非数组**的普通对象」。
 *
 * 与 {@link isRecord} 分开而不是改它：既有九处消费点全都建立在「数组也算」的
 * 行为上（`usage-test` 对 `payload` 的收窄就是），改判据会静默改变它们的
 * 行为。需要「JSON 对象体」这一层时（如 REST 的请求体）用本函数。
 */
export function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return isRecord(v) && !Array.isArray(v);
}

/**
 * 「`unknown` 当宽松对象视图读」→ `Record<string, unknown>`；否则 `null`。
 *
 * 与 {@link isRecord} 是**两个语义**（这是本条账的核心，收口前被混在一起）：
 *   · `isRecord(v)` 回答「**是不是**对象」—— 类型守卫，收窄后 `v` 仍是原值；
 *   · `asRecord(v)` 回答「**当成对象读**」—— 返回视图或 `null`，值被转成
 *     `Record`，调用处接着写 `?.prop`（与旧 any 代码的运行时语义一致）。
 *
 * 收口前全库有 **四份**这个「宽松视图」实现，而它们**各自还兼着不同的名字**：
 *
 *   components/studio/workflow-utils.ts   `asRecord`（本地函数，未导出）
 *   lib/comfyui/raw.ts                    `asRecord`（导出，被 execution-graph /
 *                                          workflow-detail* 三处 import）
 *   lib/workshop/api-channel-core.ts      **叫 `isPlainRecord`，行为却是宽松视图**
 *                                          ——名字说「排除数组」，实现不排除
 *   components/studio/.../use-param-wiring.ts  `isPlainRecord`（本地，真排除数组）
 *
 * 第三处最危险：名字与 `~/lib/is-record` 的 `isPlainRecord`（严格版）
 * **同名不同义**，谁按名字理解就会拿到意外的收窄结果。本模块两个函数各司其职后，
 * 那处按它**实际的**行为改名为 `asRecord`。
 *
 * **不排除数组**：这是四份实现的共同行为，本出口保持不变（改判据会静默改变
 * 全部消费点的收窄结果）。要「纯对象、非数组」用 {@link isPlainRecord}。
 */
export function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null
    ? (v as Record<string, unknown>)
    : null;
}
