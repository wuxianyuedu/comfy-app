/**
 * app-events —— 「跨组件广播一条应用事件」的**唯一出口**
 * （规范 16 §16.2.4.65）。
 *
 * 为什么收口：全库的自定义事件散在多个文件里订阅或派发，而它们的**命运
 * 各不相同** —— 这不是重复代码，是**同一份字面量的两端分开两处**：
 *   · **写侧改名、读侧认不出自己**；
 *   · **写侧删掉、读侧永远等不到** —— 监听器成了**没有任何触发源的死代码**
 *     （没有任何构建会报它，注释还写着「某某按钮通过它请求打开详情」）；
 *   · **读侧删掉、写侧白忙一场** —— 广播照发，没人重渲染；
 *   · **载荷类型只在读侧写一遍** —— 派发侧多写一个字段不会有人发现。
 *
 * 因此本出口做三件事，且只有这三件：
 *   1. **事件名与载荷类型一起定义**（`AppEvents` 表）——名字与形状在同一行上，
 *      改名时编译期就能看见所有读侧；
 *   2. **订阅与派发各一个带类型的函数**（`subscribeAppEvent` /
 *      `emitAppEvent`）—— 类型从表里取，读侧不必再断言；
 *   3. 表里每一条**两端都在场** —— 由 `tests/app-event-pairing.test.ts` 判
 *      （固定守护清单成员）。缺任何一端就是上面第二、第三种死法，
 *      而它们的表现都是「界面该刷新的时候没刷新」这种没人报的故障。
 *
 * 刻意**不做**的事（每一种都有人以为「该这样」）：
 *   · **不做事件总线 / 不做订阅中心** —— 这是 DOM 的 `window` 事件原样转发，
 *      不引入「谁订阅了谁」的注册表。多一份状态就多一处能泄漏的地方；
 *   · **不做 SSR 兜底里的「静默排空」** —— `emitAppEvent` 在无 `window` 时
 *      直接返回（与收口前的 `typeof window !== "undefined"` 守卫同一口径），
 *      但**不排队重放**：事件是「此刻的广播」，补发一条上一轮的广播会让读侧
 *      拿到过期的载荷。**这条承诺是判据把「读侧还要在挂载时自己读一次状态」
 *      写进注释的理由** —— 只靠事件的读侧必须能容忍「派发那一刻还没有读侧挂着」
 *      （同一份状态可能在别的页面上被改，而那些页面没挂提示器）；
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
 * **也不许只写一端** —— `tests/app-event-pairing.test.ts` 要求这一行的每一条
 * 都既有派发方又有订阅方（认字面量，也认 `export const X = "…"` 常量的间接写法）。
 */
export interface AppEvents {
  /** 画布仓库（项目索引 / 激活项）发生增删改后广播。载荷：无。 */
  "comfyapp:canvas-store-changed": undefined;
  /**
   * 画布的**服务端镜像**状态变了（某条被永久拒收、或某条重新同步成功）。
   * 载荷：无 —— 状态本身可查（`~/lib/project-canvas/sync-notice` 的
   * `listSyncNotices()`），读侧**在挂载时也要读一次**：本模块不排队重放，
   * 而写镜像的入口不止画布那一页（工作区首页新建、画廊删除都会发镜像），
   * 那些页面上没有提示器 —— 只靠事件的读侧必然漏掉那一次。
   */
  "comfyapp:canvas-sync-changed": undefined;
  /** 某个画布节点产出了结果，读侧据此把输出喂给下游。 */
  "canvas:produce": {
    id: string;
    resultPath: string;
    resultMediaType?: string;
  };
  /**
   * 请求工作区切到某个视图。载荷：视图 id（`WorkspaceView`）。
   *
   * 为什么用事件而不是 props：触发方（工坊右栏的「资源库」卡）与持有视图状态的
   * 容器（`app/workspace/page.tsx`）之间隔着 `WorkshopPipeline` / `WorkshopAside`
   * 两层，为一条「跳过去」的链接穿三层 props 不划算；订阅侧也只有一处。
   *
   * 载荷刻意写成 `string` 而不是 import `WorkspaceView`：本模块在 `src/lib`，
   * 不得反向依赖视图层（§18 硬规则 22）—— 合法性由订阅侧按已有枚举收敛。
   */
  "workspace:navigate": { view: string };
  /**
   * 自定义节点注册表被重新灌入（画布挂载时那一次、以及每次解析收尾后的那一次）。
   * 载荷：无 —— 结论本身可查（`~/config/custom-nodes` 的
   * `getCustomNodesRegistryState()`：版本号 / 节点数 / 有没有拿到清单）。
   *
   * 为什么读侧**必须**在挂载时先读一次再订阅：本模块不排队重放，而最早的一次灌入
   * 就发生在画布挂载的 effect 里（`WorkflowEditorInner` 调 `refreshCustomNodes()`），
   * 那一刻订阅还没建立 —— 只订阅不读表的写法，会让「首屏节点数为 0、再进来才有」
   * 这类现象永远说不清是谁的锅。
   *
   * 曾经这条链上有过一份同名事件、只有派发方没有订阅方（当年的订阅方是画布的
   * 添加节点菜单，后来那个菜单不在了），于是它是一个「没人听的广播」—— 台账 E9
   * 记的就是它。现在订阅侧在 `~/components/studio/canvas/use-custom-nodes-registry`。
   */
  "comfyapp:custom-nodes-updated": undefined;
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
