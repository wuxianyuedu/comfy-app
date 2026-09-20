/**
 * app-events —— 「跨组件广播一条应用事件」的**唯一出口**
 * （规范 16 §16.2.4.65）。
 *
 * 为什么收口：全库有 **5 条**自定义事件（`comfyapp:canvas-store-changed` /
 * 五条（`canvas:produce`、`open-task`、`custom-nodes:updated`，
 * 以及两条目录 / 仓库变更信号）/
 * `custom-nodes:updated`），散在 **9 个文件**里订阅或派发，而它们的**命运
 * 各不相同** —— 这不是重复代码，是**同一份字面量的两端分开两处**：
 *
 * | 事件 | 事件名的定义处 | 订阅侧 | 派发侧 |
 * |------|--------------|--------|--------|
 * | `comfyapp:canvas-store-changed` | `lib/project-canvas/canvas-store`（**不导出**） | 视图侧 **3 处硬编码字符串** | 同定义处 |
 * | `canvas:produce` | **没有** | 1 处硬编码 | 2 处硬编码 |
 * | `open-task` | **没有** | 1 处硬编码 | **已经不存在**（死监听） |
 * | `comfyapp:local-workflows-path-changed` | 订阅方自己的模块常量（**不导出**） | 同定义处 | 视图侧硬编码 |
 * | `custom-nodes:updated` | `config/custom-nodes`（**导出了**） | 视图侧 import | 同定义处 |
 *
 * 前四条的失效模式是同一种，且**全是静默的**：
 *   · **写侧改名、读侧认不出自己** —— 与 §16.2.4.58 的横幅色板同款；
 *   · **写侧删掉、读侧永远等不到** —— `open-task` 正是这一档：注释还写着
 *     「VideoQueueModal 的详情按钮通过它请求打开详情」，而那个派发早已搬走，
 *     监听器成了**没有任何触发源的死代码**（没有任何构建、测试会报它）；
 *   · **载荷类型只在读侧写一遍** —— `canvas:produce` 的 `{ id, resultPath,
 *     resultMediaType }` 只在订阅侧有个 `as {...}` 断言，派发侧多写一个字段
 *     不会有人发现。
 *
 * 因此本出口做两件事，且只有这两件：
 *   1. **事件名与载荷类型一起定义**（`AppEvents` 表）——名字与形状在同一行上，
 *      改名时编译期就能看见所有读侧；
 *   2. **订阅与派发各一个带类型的函数**（`subscribeAppEvent` /
 *      `emitAppEvent`）—— 类型从表里取，读侧不必再断言。
 *
 * 刻意**不做**的事（每一种都有人以为「该这样」）：
 *   · **不做事件总线 / 不做订阅中心** —— 这是 DOM 的 `window` 事件原样转发，
 *     不引入「谁订阅了谁」的注册表。多一份状态就多一处能泄漏的地方；
 *   · **不做 SSR 兜底里的「静默排空」** —— `emitAppEvent` 在无 `window` 时
 *     直接返回（与收口前的 `typeof window !== "undefined"` 守卫同一口径），
 *     但**不排队重放**：事件是「此刻的广播」，补发一条上一轮的广播会让读侧
 *     拿到过期的载荷；
 *   · **`subscribeAppEvent` 不返回 Promise、不做防抖** —— 订阅/退订就是
 *     `addEventListener` / `removeEventListener` 的配对，返回的退订函数
 *     直接给 `useEffect` 用。
 *
 * 与 §16.2.4.28 的 `~/lib/browser-storage` 分工：那个管**跨会话的持久化**，
 * 这个管**同一页面内的广播**。需要「改了存储并通知」的地方，两个都用
 * （写侧 `writeStorageItem` + `emitAppEvent`）。
 */

/**
 * 全部应用事件的**名字与载荷**表。
 *
 * 新增事件 = 在这里加一行（名字与载荷类型写在同一处），然后在派发侧
 * `emitAppEvent("…", payload)`、读侧 `subscribeAppEvent("…", handler)`。
 * **不要在别处再写一遍事件名字符串** —— 判据 P61 会拦下视图 / 逻辑 /
 * 服务端里裸写的 `new CustomEvent("…")` 与 `addEventListener("…")`。
 */
export interface AppEvents {
  /** 画布仓库（项目索引 / 激活项）发生增删改后广播。载荷：无。 */
  "comfyapp:canvas-store-changed": undefined;
  /** 某个画布节点产出了结果，读侧据此把输出喂给下游。 */
  "canvas:produce": {
    id: string;
    resultPath: string;
    resultMediaType?: string;
  };
  /** 请求历史面板打开某条任务的详情。 */
  "open-task": string;
  /** 本地工作流目录配置变更。载荷：无。 */
  "comfyapp:local-workflows-path-changed": undefined;
  /** 自定义节点注册表刷新完成。 */
  "custom-nodes:updated": { count: number };
}

/** 应用事件名的联合类型。 */
export type AppEventName = keyof AppEvents;

/** 某个事件的载荷类型。 */
export type AppEventPayload<K extends AppEventName> = AppEvents[K];

/**
 * 派发一条应用事件。
 *
 * 无 `window`（SSR / 构建期模块图）时**直接返回** —— 广播方只在浏览器里跑。
 *
 * 载荷为 `undefined` 的事件（`comfyapp:canvas-store-changed` 这类
 * 「只表示『有变化』」的信号）派发**不带 `detail`** 的普通 `Event`：
 * 收口前它们用的就是 `new Event(name)`，读侧也从来不读 `detail`
 * —— 给一个 `detail: undefined` 只会让读侧以为「这里有东西可读」。
 *
 * 用法（带载荷与纯信号两种）：
 *
 * ```ts
 * emitAppEvent("canvas:produce", { id, resultPath });  // 带载荷
 * emitAppEvent("comfyapp:canvas-store-changed");       // 纯信号
 * ```
 */
export function emitAppEvent<K extends AppEventName>(
  name: K,
  ...payload: AppEvents[K] extends undefined ? [] : [AppEvents[K]]
): void {
  if (typeof window === "undefined") return;
  const detail = payload[0];
  window.dispatchEvent(
    detail === undefined ? new Event(name) : new CustomEvent(name, { detail }),
  );
}

/** 空操作：无 `window` 时订阅返回它（调用方可以无条件 `return` 订阅结果）。 */
function noop(): void {
  /* 刻意什么都不做 —— 见下方 subscribeAppEvent 的 SSR 说明。 */
}

/**
 * 订阅一条应用事件，返回**退订函数**（直接给 `useEffect` 的清理用）。
 *
 * 载荷从 `AppEvents` 表里取，读侧**不必再 `as` 断言** —— 收口前
 * `canvas:produce` 的读侧写着 `(e as CustomEvent).detail as {...}`，
 * 那个断言是「事件名 → 载荷形状」这条信息在库里唯一的存在形式，
 * 而它没有任何东西能保证它与派发侧一致。
 *
 * 无 `window` 时返回一个**空操作**（不是 `undefined`）：调用方可以无条件地
 * `return subscribeAppEvent(…)`，不必自己判环境。
 *
 * 订阅用法（直接给 `useEffect` 用，载荷类型从表里取）：
 *
 * ```ts
 * useEffect(() => subscribeAppEvent("canvas:produce", (p) => {  // 订阅
 *   void propagateFrom(p.id, p.resultPath);  // p 的类型已知，不必断言
 * }), [propagateFrom]);
 * ```
 */
export function subscribeAppEvent<K extends AppEventName>(
  name: K,
  handler: (payload: AppEvents[K]) => void,
): () => void {
  if (typeof window === "undefined") return noop;
  const listener = (event: Event) => {
    handler((event as CustomEvent).detail as AppEvents[K]);
  };
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}
