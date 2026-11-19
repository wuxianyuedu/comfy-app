"use client";

/**
 * 「把一段文本写进剪贴板，并按成败给反馈」的唯一出口（规范 16 §16.2.4.43）。IO 已收口（`~/lib/browser-io` 的 `copyText`），剩下的问题是成败怎么告诉用户：14 个落点有六种答案，一半落点「复制失败」连按钮都不变（打包后的 `http://` 才复现）。
 * 收：调用形状 `copy(text)`、成功与失败都要有出口、「同一时刻只有一次复制在飞」；不收：反馈形态（flash / toast / 行内三态文字），那由调用处选。完全不需要反馈的落点显式传 `onFailure: "silent"`，让「故意静默」与「忘了写」长得不一样。
 * 失败文案的上半句与下半句也在这里（§16.2.4.46）：收口前 10 处手写同一句、有 5 种变体且一处漏字，`copyFailureText` 一次给出，只有「可复制物在哪」经 `target` 注入。
 */

import { useCallback, useEffect, useRef } from "react";

import { copyText } from "~/lib/browser-io";
import { useReentrancyLock } from "~/components/ui/use-reentrancy-lock";

/** 回调用「复制结果」这一件事：`true` = 已进剪贴板。 */
export type CopyFeedback = (ok: boolean) => void;

export type UseCopyFeedbackOptions = {
  /**
   * 失败之后的反馈：给回调 → 由它说（toast / 行内文案 / 亮红）；给 `"silent"` → 显式声明失败也不提示（旁边已有固定手抄指引）。
   * 不给 → 与 `"silent"` 同样静默，但读起来像忘了写 —— 新增落点请显式选一个。
   */
  onFailure?: CopyFeedback | "silent";
  /** 成功之后的反馈（不给 = 成功静默，是有意为之的常见选择）。 */
  onSuccess?: CopyFeedback;
};

/**
 * 复制一段文本，并把成败交给调用处的反馈。还有一支「文本由调用处现算」的形态 —— 见 `CopyProducer`：日志面板的「复制全部」要从 store 取当前筛选下的全部行再拼串，那件事发生在点击那一刻。
 */
export type CopyRunner = (text: string) => void;

/**
 * 复制一段**点击那一刻才算出来的**文本（产出 `null` = 没有可复制的内容，
 * 不算失败，也不触发任何反馈）。
 */
export type CopyProducer = (produce: () => Promise<boolean>) => void;

/**
 * 出口的完整形状：既可当 `copy(text)` 调，也可当 `copy(() => …)` 调。需要拿到原始成败的落点见 `useCopyResult`：把两件事塞进同一个返回值会让调用处分不清这次到底报没报。
 */
export type CopyController = {} & CopyRunner & CopyProducer;

/**
 * 复制失败的提示文案 —— 出口给上半句与下半句，调用处只补「可复制物在哪」（`target`）。固定句走出口、位置走参数：位置是界面事实（布局变了说法要跟着变），而「浏览器拒绝剪贴板」与落点无关。
 */
export function copyFailureText(target?: string): string {
  const where = target !== undefined && target !== "" ? `${target}后复制` : "后复制";
  return `复制失败：剪贴板不可用，请手动选中${where}`;
}

/**
 * 复制到剪贴板 + 按成败反馈。重复调用直接忽略（同步 `ref` 判，不等 `setState`）：连点两下不该发两次写入、更不该让第一次的复位抹掉第二次的反馈——与 `useItemAction` 用 ref 判重入同一个坑。
 */
export function useCopyFeedback({
  onSuccess,
  onFailure,
}: UseCopyFeedbackOptions = {}): CopyController {
  /* 反馈回调常是行内箭头函数（每次渲染换引用），用 ref 持有最新一份，否则 `copy` 每次重建。写入放 effect 而非渲染期：`react-hooks/refs` 禁止渲染期写 ref；effect 在提交后跑，而 `copy` 只由事件触发，延迟透明。 */
  const handlersRef = useRef<{
    failure?: CopyFeedback | "silent";
    success?: CopyFeedback;
  }>({ success: onSuccess, failure: onFailure });
  useEffect(() => {
    handlersRef.current = { success: onSuccess, failure: onFailure };
  }, [onSuccess, onFailure]);

  /* 重入判重：同步可见，不等 React 提交 —— 判据收在唯一出口里
   *（规范 16 §16.2.4.69：「同一时刻只跑一件」）。 */
  const lock = useReentrancyLock();

  /* ⚠️ 入参必须是**产出 Promise 的函数**，不能是 Promise 本身：
   * 后者会在调用 `report` 之前就把写入发出去，重入判据于是形同虚设
   *（连点两下仍然发两次写入）—— 本用例集正是钉住这一点的。 */
  const report = useCallback(
    (start: () => Promise<boolean>) => {
      if (!lock.tryEnter()) {
        return;
      }
      void start()
        .then((ok) => {
          const handlers = handlersRef.current;
          if (ok) {
            handlers.success?.(true);
          } else if (handlers.failure !== "silent") {
            handlers.failure?.(false);
          }
        })
        .finally(() => {
          lock.exit();
        });
    },
    [lock],
  );

  /* 两种调用形态共用同一条重入判据与同一份反馈：
   *   · `copy("文本")` —— 最常见；
   *   · `copy(() => copyAllFromStore())` —— 文本由点击那一刻现算（日志面板）。 */
  const run = useCallback(
    (text: string) => {
      report(() => copyText(text));
    },
    [report],
  );
  return useCallback(
    (arg: string | (() => Promise<boolean>)) => {
      if (typeof arg === "string") {
        run(arg);
      } else {
        report(arg);
      }
    },
    [report, run],
  );
}

/**
 * 「写剪贴板并拿到成败」的出口 —— 不触发任何反馈。给调用处自己要把成败接进另一条通道的落点用（历史列表「重试」实为复制，结果喂给 `runAsyncAction`），否则同一件事说两遍。
 * 与 `useCopyFeedback` 分开是因为返回值形状不同；重入期间直接返回 `false`（正在飞的那次还没定论）。
 */
export function useCopyResult(): (text: string) => Promise<boolean> {
  const lock = useReentrancyLock();
  return useCallback(
    (text: string): Promise<boolean> => {
      if (!lock.tryEnter()) {
        return Promise.resolve(false);
      }
      return copyText(text).finally(() => {
        lock.exit();
      });
    },
    [lock],
  );
}
