"use client";

/**
 * 角色库单条取消（规范 17 §17.2 第②层）：复用队列页同一套「按条目防连点 +
 * runAsyncAction 反馈」写法。取消成功后立刻对账，不等下一轮 5 秒轮询；
 * 失败也对账一次，任务可能已在别处取消，界面不该一直显示生成中。
 */
import { useCallback } from "react";

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

  const cancelOne = useCallback(
    async (id: string): Promise<void> => {
      const row = items.find((item) => item.id === id);
      if (row?.status !== "generating") {
        return;
      }
      const taskId = row.taskId;
      if (taskId === null || taskId === "") {
        return;
      }
      await action.run(id, async () => {
        await runAsyncAction(() => cancelTask(taskId), {
          report,
          failureText: `取消「${row.name}」失败，请稍后重试`,
          successText: "已发送取消请求，正在对账",
        });
        await syncNow();
      });
    },
    [action, items, report, syncNow],
  );

  return { cancelOne, isCancelBusy: action.isBusy };
}
