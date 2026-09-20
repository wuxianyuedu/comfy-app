"use client";

/**
 * 「把一段文本写进剪贴板，并按成败给反馈」的唯一出口（规范 16 §16.2.4.43）。
 *
 * IO 本身早已收口（`~/lib/browser-io` 的 `copyText` 是唯一的剪贴板写入，
 * 见 §16.2.3 的 P5 判据）。**收口之后剩下的问题**是：写完之后的成败怎么告诉
 * 用户 —— 实测 14 个落点给出**六种答案**：
 *
 * | 落点 | 成败之后 |
 * |------|---------|
 * | `ShellTabs` / `DebugChainFooter` / `ResultCard` / `ErrorPanel`×2 | 完全静默（`void copyText(…)`） |
 * | `ProjectOutputs` / `WorkflowNodeJsonPopover` | `useFlashState` 亮一下（成功才亮） |
 * | `use-history-detail-actions` | `toast.success` + `toast.error` 两条 |
 * | `use-history-list`（「重试」实为复制） | 进 `runAsyncAction` 的成功文案 |
 * | `logs/LogRow` | 三态 `setOutcome("done"｜"failed")` + flash |
 * | 设置页加载错误 / `ui/json-viewer` | `if (await copyText(…))` —— **没有失败分支** |
 *
 * 差别不是风格：**「复制失败」在一半落点下连按钮都不变**，用户以为复制成功了
 * （浏览器要「非安全上下文 / 无剪贴板权限」两条同时不成立才会失败，所以这条
 * 在开发机上几乎复现不出来，只在打包后的 `http://` 里出现 —— 正是 §16.2.4.10
 * 记的那类「可选链把失败吞掉」）。
 *
 * ## 收什么、不收什么
 *
 * **收**：调用形状（`copy(text)`）、成功与失败**都要有出口**、以及「同一时刻
 * 只有一次复制在飞」这条判据（连点两下不该让第一次的复位抹掉第二次的亮起 ——
 * 与 `useFlashState` 同款）。
 * **不收**：反馈**形态**（flash / toast / 行内的三态文字）—— 那是调用处的表现层
 * 选择，与 `~/lib/async-action` 的口径一致：出口只保证「成败都被说出口」，
 * 说什么由调用处给。
 *
 * 用法（成功亮一下、失败给一句可照做的提示）：
 *
 * ```tsx
 * // 用法：成功亮一下、失败给一句可照做的提示
 * 用法：const copy = useCopyFeedback({
 *   onSuccess: () => copied.flash(),        // 成功分支：亮一下
 *   onFailure: () => toast.error("复制失败", "请手动选中后复制"), // 失败分支
 * });
 * <Button onClick={() => copy(text)}>复制</Button>  // 调用处只传文本
 * ```
 *
 * 完全不需要反馈的落点（正文里已经写着「复制失败请手动选中」这类固定说明、
 * 且位置就在旁边）显式传 `onFailure: "silent"` —— 让「故意静默」与「忘了写
 * 失败分支」在代码上长得不一样（与 `runAsyncAction` 的 `successText` 缺席
 * 即「成功静默」同款）。
 */

import { useCallback, useEffect, useRef } from "react";

import { copyText } from "~/lib/browser-io";

/** 回调用「复制结果」这一件事：`true` = 已进剪贴板。 */
export type CopyFeedback = (ok: boolean) => void;

export interface UseCopyFeedbackOptions {
  /** 成功之后的反馈（不给 = 成功静默，是有意为之的常见选择）。 */
  onSuccess?: CopyFeedback;
  /**
   * 失败之后的反馈。
   *
   * - 给回调 → 由它说（toast / 行内文案 / 亮红）；
   * - 给 `"silent"` → **显式声明**失败也不提示（旁边已有固定的手抄指引）；
   * - 不给 → 与 `"silent"` 同样静默，但**读起来像忘了写** —— 新增落点请显式选一个。
   */
  onFailure?: CopyFeedback | "silent";
}

/**
 * 复制一段**文本**，并把成败交给调用处的反馈。
 *
 * 还有一支「文本由调用处现算」的形态 —— 见 {@link CopyProducer}：日志面板的
 * 「复制全部」要从 store 取当前筛选下的全部行再拼串，那件事发生在点击那一刻，
 * 不能提前算好当参数。
 */
export type CopyRunner = (text: string) => void;

/**
 * 复制一段**点击那一刻才算出来的**文本（产出 `null` = 没有可复制的内容，
 * 不算失败，也不触发任何反馈）。
 */
export type CopyProducer = (produce: () => Promise<boolean>) => void;

/**
 * 出口的完整形状：既可当 `copy(text)` 调、也可当 `copy(() => …)` 调。
 *
 * 需要**拿到原始成败**的落点（调用处自己要把结果接进另一条通道）不在这里 ——
 * 见 {@link useCopyResult}：那种落点要的是「不报反馈、只给结果」，
 * 把两件事塞进同一个返回值会让调用处分不清这次到底报没报。
 */
export interface CopyController extends CopyRunner, CopyProducer {}

/**
 * 复制到剪贴板 + 按成败反馈。
 *
 * 重复调用直接忽略（同步 `ref` 判，不等 `setState`）：连点两下不该发两次写入、
 * 更不该让第一次的复位提前抹掉第二次的反馈 —— 与 `useItemAction`（§16.2.4.40）
 * 用 ref 判重入是同一个坑（`setState` 是异步的，同一次事件循环里读不到刚写的值）。
 */
export function useCopyFeedback({
  onSuccess,
  onFailure,
}: UseCopyFeedbackOptions = {}): CopyController {
  /* 反馈回调常常是行内箭头函数（每次渲染换引用）。用 ref 持有最新的一份 ——
   * 否则 `copy` 每次渲染都要重建，而它会被塞进 `useCallback` / effect 依赖里。
   *
   * 写入放在 effect 里而不是渲染期：React 19 的 `react-hooks/refs` 规则禁止
   * 渲染期写 ref（ref 的变化不参与渲染，并发渲染下会读到撕裂的值）。
   * effect 在**提交后**跑，而 `copy` 只可能由事件触发（那是提交之后的事），
   * 所以这一帧的延迟对调用点是透明的。 */
  const handlersRef = useRef<{
    success?: CopyFeedback;
    failure?: CopyFeedback | "silent";
  }>({ success: onSuccess, failure: onFailure });
  useEffect(() => {
    handlersRef.current = { success: onSuccess, failure: onFailure };
  }, [onSuccess, onFailure]);

  /* 重入判重：同步可见，不等 React 提交。 */
  const pendingRef = useRef(false);

  /* ⚠️ 入参必须是**产出 Promise 的函数**，不能是 Promise 本身：
   * 后者会在调用 `report` 之前就把写入发出去，`pendingRef` 的重入判据
   * 于是形同虚设（连点两下仍然发两次写入）—— 本用例集正是钉住这一点的。 */
  const report = useCallback((start: () => Promise<boolean>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    void start()
      .then((ok) => {
        const handlers = handlersRef.current;
        if (ok) handlers.success?.(true);
        else if (handlers.failure !== "silent") handlers.failure?.(false);
      })
      .finally(() => {
        pendingRef.current = false;
      });
  }, []);

  /* 两种调用形态共用同一条重入判据与同一份反馈：
   *   · `copy("文本")` —— 最常见；
   *   · `copy(() => copyAllFromStore())` —— 文本由点击那一刻现算（日志面板）。 */
  const run = useCallback(
    (text: string) => report(() => copyText(text)),
    [report],
  );
  return useCallback(
    (arg: string | (() => Promise<boolean>)) => {
      if (typeof arg === "string") run(arg);
      else report(arg);
    },
    [report, run],
  );
}

/**
 * 「写剪贴板并拿到成败」的出口 —— **不触发任何反馈**。
 *
 * 给「调用处自己要把成败接进另一条通道」的落点用：历史列表的「重试」实为
 * 「复制参数」，它要把复制结果喂给 `runAsyncAction` 的成功 / 失败文案 ——
 * 那就不能同时让 {@link useCopyFeedback} 再报一次（同一件事说两遍）。
 *
 * 与 `useCopyFeedback` 分开而不是给它加个 `resolve` 方法：两者的返回值形状
 * 不同（一个是「报反馈的调用」、一个是「Promise」），揉在一个对象上会让
 * 调用处看不出这次到底报没报 —— 而「报没报」正是这条账的全部内容。
 *
 * 重入期间直接返回 `false`（正在飞的那次还没定论，重复点不该再发一次）。
 */
export function useCopyResult(): (text: string) => Promise<boolean> {
  const pendingRef = useRef(false);
  return useCallback((text: string): Promise<boolean> => {
    if (pendingRef.current) return Promise.resolve(false);
    pendingRef.current = true;
    return copyText(text).finally(() => {
      pendingRef.current = false;
    });
  }, []);
}
