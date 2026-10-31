"use client";

/**
 * 设置页「Drizzle Studio 本地数据库可视化」分区的 sub-hook（`use-settings-page`
 * 的拆分件）。
 *
 * 收口 4 个 tRPC 通道（`dbStudioStatus` 查询 + `dbStudioStart` /
 * `dbStudioStop` / `dbStudioOpen` 三个 mutation）、3 段进行态（starting /
 * stopping / opening）、3 个动作（startDbStudio / stopDbStudio / openDbStudio）
 * 与运行时日志的「正在启动则每秒跟随、否则挂载取一次」的 `active` 判据。
 *
 * 状态查询的 `enabled` 由主 hook 传入的 `statusQueriesEnabled` 门控——首屏
 * 两份配置（`setting.get` / `llm.configGet`）就绪之前**不**发探测，避免与
 * 秒级 HTTP 探测并进同一批请求，把首屏也拖慢数秒（同 `comfyStatus` 的口径）。
 *
 * `dbStudioLogActive` = 正在启动 OR 服务端快照说 starting：与 `useRuntimeLogSource`
 * 的「跟随本次启动」联动，返回给主 hook 直接展开到 controller 的
 * `dbStudioLog: { ...log, active }`。
 *
 * 这一整块与 ComfyUI 的探测通道**共享同一 statusQueriesEnabled 门控**，
 * 但状态与动作各自独立、无交叉。返回形状与主 hook controller 逐字段一致，
 * 视图与测试都不感知——§12.18 复用优先，拆包只挪文件、不动契约。
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useExternalAction } from "~/components/ui/use-external-action";
import { runAsyncAction } from "~/lib/async-action";
import { useTRPC } from "~/trpc/react";
import type { ActionReport } from "~/lib/async-action";
import {
  useRuntimeLogSource,
  type RuntimeLogController,
} from "~/components/studio/logs/use-runtime-log-source";

export type DbStudioStatus = {
  port: number;
  starting: boolean;
  up: boolean;
};

export type UseSettingsDbStudio = {
  dbStudioLog: RuntimeLogController & { active: boolean };
  dbStudioOpening: boolean;
  dbStudioStarting: boolean;
  dbStudioStatus: DbStudioStatus | null;
  dbStudioStopping: boolean;
  openDbStudio: () => Promise<void>;
  startDbStudio: () => Promise<void>;
  stopDbStudio: () => Promise<void>;
};

export function useSettingsDbStudio({
  showFlash,
  statusQueriesEnabled,
}: {
  /** 整页提示条通道，来自主 hook 的 useFlashLatch。 */
  showFlash: ActionReport;
  /** 首屏两份配置就绪前不发探测（同 comfyStatus 的口径）。 */
  statusQueriesEnabled: boolean;
}): UseSettingsDbStudio {
  const trpc = useTRPC();
  const statusQ = useQuery(
    trpc.setting.dbStudioStatus.queryOptions(undefined, {
      enabled: statusQueriesEnabled,
      refetchInterval: 15_000,
    }),
  );
  const startM = useMutation(trpc.setting.dbStudioStart.mutationOptions());
  const stopM = useMutation(trpc.setting.dbStudioStop.mutationOptions());
  const openM = useMutation(trpc.setting.dbStudioOpen.mutationOptions());
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  /* ── Drizzle Studio 启动 / 关闭 / 打开 ─────────────────── */
  const startDbStudio = useCallback(async () => {
    setStarting(true);
    try {
      await runAsyncAction(
        async () => {
          const result = await startM.mutateAsync();
          await statusQ.refetch();
          return result;
        },
        { failureText: "启动 Drizzle Studio 失败", report: showFlash },
      );
    } finally {
      setStarting(false);
    }
  }, [startM, statusQ, showFlash]);

  const stopDbStudio = useCallback(async () => {
    setStopping(true);
    try {
      await runAsyncAction(
        async () => {
          const result = await stopM.mutateAsync();
          await statusQ.refetch();
          return result;
        },
        { failureText: "关闭 Drizzle Studio 失败", report: showFlash },
      );
    } finally {
      setStopping(false);
    }
  }, [stopM, statusQ, showFlash]);

  const openDbStudioAction = useExternalAction({
    report: showFlash,
    target: "browser",
  });
  const openDbStudio = useCallback(async () => {
    await openDbStudioAction.run(() => openM.mutateAsync());
  }, [openDbStudioAction, openM]);

  const logActive = starting || !!statusQ.data?.starting;
  const log = useRuntimeLogSource({
    active: logActive,
    source: "drizzle-studio-runtime",
  });

  const raw = statusQ.data;
  return {
    dbStudioLog: { ...log, active: logActive },
    dbStudioOpening: openDbStudioAction.busy,
    dbStudioStarting: starting,
    dbStudioStatus: raw
      ? {
          port: raw.port ?? 4983,
          starting: !!raw.starting,
          up: !!raw.up,
        }
      : null,
    dbStudioStopping: stopping,
    openDbStudio,
    startDbStudio,
    stopDbStudio,
  };
}
