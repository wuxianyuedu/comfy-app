/* ── 生成节点的「强制取消」动作（第②层逻辑）───────────────────────────
 * 从 ImageGenerationPanel / GlobalStepLogPanel 两处视图里抽出的同一段逻辑：
 *   1. `cancelling` 标记，让按钮进入不可重复点击的「取消中…」态；
 *   2. 用 ref 持有最新的 taskId / 失败回调，异步回调里才能读到新值；
 *   3. 失败要**本地回滚**：把状态打回 error 并带上原因，否则按钮会一直挂在
 *      running，用户再点也没反应（SSE 的 error 事件未必会来）。
 *
 * 两处消费方只差「失败时怎么回报」，故这里把它做成回调参数，
 * 而不是把画布节点或日志面板的数据模型硬编进 hook。
 */

"use client";

import { useCallback, useRef, useState } from "react";
import { errorMessage } from "~/lib/error-message";
import { cancelTask } from "~/lib/task-cancel-client";

export interface UseCancelTaskArgs {
  /** 当前要取消的任务 id（可能还没就绪 —— 见下方取消回调注释）。 */
  taskId?: string | null;
  /** 失败时的本地回滚，形态由调用方决定（画布节点 patch，日志面板 setError）。 */
  onFailed: (reason: string) => void;
}

export interface CancelTaskController {
  cancelling: boolean;
  cancel: () => Promise<void>;
}

export function useCancelTask({
  taskId,
  onFailed,
}: UseCancelTaskArgs): CancelTaskController {
  const [cancelling, setCancelling] = useState(false);

  // 把最新的 taskId / onFailed 放在 ref 里，好让处理器（由异步
  // 回调触发）总能读到新鲜的值，而不必被重建。
  const taskIdRef = useRef(taskId);
  // eslint-disable-next-line react-hooks/refs -- 渲染期同步最新 props 到 ref，供异步取消回调读取（刻意模式）
  taskIdRef.current = taskId;
  const onFailedRef = useRef(onFailed);
  // eslint-disable-next-line react-hooks/refs -- 同上
  onFailedRef.current = onFailed;

  const cancel = useCallback(async () => {
    /* 不为「taskId 缺失」提前 return ——
     *  旧实现会吞掉「patch({ status: "running" })` 到 `patch({ taskId })`
     *  这一小段窗口内的取消点击（CanvasNode 正在发请求）。/cancel 端点幂等，
     *  对不存在的 taskId 返回 404 且无副作用；缺 id 时只告诉用户没送达。 */
    const currentTaskId = taskIdRef.current;
    setCancelling(true);
    try {
      if (!currentTaskId) {
        onFailedRef.current("取消请求异常：尚未生成 taskId");
        return;
      }
      await cancelTask(currentTaskId);
      // 取消请求已送达，收尾交给 SSE 的 error 事件。
    } catch (e) {
      onFailedRef.current(`取消请求异常：${errorMessage(e, "未知错误")}`);
    } finally {
      setCancelling(false);
    }
  }, []);

  return { cancelling, cancel };
}
