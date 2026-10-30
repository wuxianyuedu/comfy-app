"use client";

/**
 * 设置页「数据库备份 / 恢复」分区的 sub-hook（`use-settings-page` 的拆分件）。
 *
 * 收口 3 个 tRPC 通道（`backupList` 查询 + `backupCreate` / `backupRestore`
 * 两个 mutation）与 2 个动作，形状与 `use-settings-page-db-studio.ts` 逐字段
 * 对齐（§12.18 复用优先：拆包只挪文件、不动契约）。
 *
 * ── 这里为什么不「恢复完就完事」──────────────────────────────────────────
 *
 * 「恢复」在这条链路上是**两步**，而界面必须把第二步讲出来：
 *
 *   1. 点按钮 → 服务端只写一个**待恢复标记**（`backupRestore`）；
 *   2. 真正换文件发生在**下次启动**（`scripts/db-backup-core.mjs` 的
 *      `applyPendingRestoreAtBoot`，排在 Next 起来之前）。
 *
 * 分开的理由是硬的：运行期有多个进程持有这个库（内嵌 Next server、执行宿主、
 * 用户可能开着的 Drizzle Studio），在别人握着句柄时覆盖 `db.sqlite` 是不可逆的
 * 数据事故。所以这个 hook 的产出里有一个 `pending` —— 视图拿它渲染
 * 「已登记，重启后生效」，而不是弹一句「恢复成功」把人骗去刷新页面。
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { runAsyncAction } from "~/lib/async-action";
import { useTRPC } from "~/trpc/react";
import type { ActionReport } from "~/lib/async-action";

/** 一份可选备份（与服务端 `listBackupEntries` 的形状同源）。 */
export interface BackupEntry {
  name: string;
  size: number;
  /** 文件名里的时刻（毫秒）；形态认不出时 null。 */
  at: number | null;
}

/** 待恢复标记（写入后到下次启动之间一直有效）。 */
export interface PendingRestore {
  file: string;
  at: string | null;
}

export interface UseSettingsBackup {
  backups: Array<BackupEntry>;
  pending: PendingRestore | null;
  /** 备份清单首次加载完成前为 true（视图据此避免把「还没读到」当「一份都没有」）。 */
  loading: boolean;
  backupBusy: boolean;
  restoreBusy: boolean;
  createBackupNow: () => Promise<void>;
  restoreFrom: (name: string) => Promise<void>;
}

export function useSettingsBackup({
  statusQueriesEnabled,
  showFlash,
}: {
  /** 首屏两份配置就绪前不发探测（同 dbStudio / comfyStatus 的口径）。 */
  statusQueriesEnabled: boolean;
  /** 整页提示条通道，来自主 hook 的 useFlashLatch。 */
  showFlash: ActionReport;
}): UseSettingsBackup {
  const trpc = useTRPC();
  const listQ = useQuery(
    trpc.setting.backupList.queryOptions(undefined, {
      enabled: statusQueriesEnabled,
    }),
  );
  const createM = useMutation(trpc.setting.backupCreate.mutationOptions());
  const restoreM = useMutation(trpc.setting.backupRestore.mutationOptions());
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);

  /* 备份失败是**可预期的一档**（磁盘满 / 库被独占），服务端因此返回
   * `{ ok: false, reason }` 而不是抛；这里把它翻成一句带原因的提示，而不是笼统的
   * 「备份失败」—— 人能据此动手（清磁盘 / 关掉占用的进程）。 */
  const createBackupNow = useCallback(async () => {
    setBackupBusy(true);
    try {
      const result = await createM.mutateAsync();
      await listQ.refetch();
      if (result.ok) {
        showFlash("ok", `已备份数据库：${result.name}`);
      } else {
        showFlash("err", `备份没能完成：${result.reason}`);
      }
    } finally {
      setBackupBusy(false);
    }
  }, [createM, listQ, showFlash]);

  /* 恢复只写标记：**不断言「已恢复」**，说的是「已登记，重启后生效」——
   * 换文件还没发生（见文件头）。 */
  const restoreFrom = useCallback(
    async (name: string) => {
      setRestoreBusy(true);
      try {
        await runAsyncAction(
          async () => {
            const result = await restoreM.mutateAsync({ name });
            if (!result.ok) throw new Error(result.reason);
            return {
              ok: /* SAFETY: 类型断言已复核 */ true as const,
              text: `已登记恢复 ${name} —— **重启应用**后生效（当前进程还连着数据库，不能就地换文件）`,
            };
          },
          { report: showFlash, failureText: "登记恢复失败" },
        );
        await listQ.refetch();
      } finally {
        setRestoreBusy(false);
      }
    },
    [restoreM, listQ, showFlash],
  );

  return {
    backups: listQ.data?.backups ?? [],
    pending: listQ.data?.pending ?? null,
    loading: listQ.isLoading,
    backupBusy,
    restoreBusy,
    createBackupNow,
    restoreFrom,
  };
}
