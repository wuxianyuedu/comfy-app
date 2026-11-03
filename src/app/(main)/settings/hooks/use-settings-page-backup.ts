"use client";

/**
 * 设置页「数据库备份/恢复」分区的 sub-hook：收口 backupList 查询 + create/restore 两 mutation（§12.18 对齐 db-studio 件）。
 * 「恢复」是两步：服务端只写待恢复标记，真正换文件在下次启动（`applyPendingRestoreAtBoot`）——运行期多个进程
 * 持有这个库，别人握着句柄时覆盖 `db.sqlite` 是不可逆数据事故；故产出有 `pending`，视图报「已登记，重启后生效」。
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { runAsyncAction } from "~/lib/async-action";
import { useTRPC } from "~/trpc/react";
import type { ActionReport } from "~/lib/async-action";

/** 一份可选备份（与服务端 `listBackupEntries` 的形状同源）。 */
export type BackupEntry = {
  /** 文件名里的时刻（毫秒）；形态认不出时 null。 */
  at: number | null;
  name: string;
  size: number;
};

/** 待恢复标记（写入后到下次启动之间一直有效）。 */
export type PendingRestore = {
  at: string | null;
  file: string;
};

export type UseSettingsBackup = {
  backupBusy: boolean;
  backups: Array<BackupEntry>;
  createBackupNow: () => Promise<void>;
  /** 备份清单首次加载完成前为 true（视图据此避免把「还没读到」当「一份都没有」）。 */
  loading: boolean;
  pending: PendingRestore | null;
  restoreBusy: boolean;
  restoreFrom: (name: string) => Promise<void>;
};

export function useSettingsBackup({
  statusQueriesEnabled,
  showFlash,
}: {
  /** 整页提示条通道，来自主 hook 的 useFlashLatch。 */
  showFlash: ActionReport;
  /** 首屏两份配置就绪前不发探测（同 dbStudio / comfyStatus 的口径）。 */
  statusQueriesEnabled: boolean;
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
            if (!result.ok) {
              throw new Error(result.reason);
            }
            return {
              /* SAFETY: 类型断言已复核 */
              ok: true as const,
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
