"use client";

/**
 * 角色库单条取消（规范 17 §17.2 第②层）：复用队列页同一套「按条目防连点 +
 * runAsyncAction 反馈」写法。取消成功后立刻对账，不等下一轮 5 秒轮询；
 * 失败也对账一次，任务可能已在别处取消，界面不该一直显示生成中。
 */
import { useCallback, useEffect, useRef } from "react";

import { useItemAction } from "~/components/ui/use-item-action";
import { runAsyncAction, type ActionReport } from "~/lib/async-action";
import { cancelTask } from "~/lib/task-cancel-client";

/** 只取本动作要用的列表字段，避免与 controller 互相 import 成环。 */
type CancelRow = {
  id: string;
  name: string;
  status: string;
  taskId: string | null;
};

export function useCharacterCancel({
  items,
  report,
  syncNow,
}: {
  items: ReadonlyArray<CancelRow>;
  report: ActionReport;
  syncNow: () => Promise<void>;
}) {
  const action = useItemAction(items.map((row) => row.id));
  /* 只取 run 这一枚稳定引用：action 对象每次渲染都可能换（useItemAction 的
   * 返回面随 busyId 变），把它整个放进依赖会让 cancelOne 跟着渲染失效，
   * 进而让 memo 卡片的回调 prop 每次都新（规范 14 C7）。 */
  const { run } = action;
  /* 行信息走 ref：列表刷新会换 items 引用，但取消回调要跨渲染稳定（规范 2.5），
   * 用 ref 读最新版本，取消时拿到的仍是当下这一行。 */
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const cancelOne = useCallback(
    async (id: string): Promise<void> => {
      const row = itemsRef.current.find((item) => item.id === id);
      if (row?.status !== "generating") {
        return;
      }
      const taskId = row.taskId;
      if (taskId === null || taskId === "") {
        return;
      }
      await run(id, async () => {
        await runAsyncAction(() => cancelTask(taskId), {
          report,
          failureText: `取消「${row.name}」失败，请稍后重试`,
          successText: "已发送取消请求，正在对账",
        });
        await syncNow();
      });
    },
    [report, run, syncNow],
  );

  return { cancelOne, isCancelBusy: action.isBusy };
}
