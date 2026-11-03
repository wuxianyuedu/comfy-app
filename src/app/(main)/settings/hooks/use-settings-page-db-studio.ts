"use client";

/**
 * 设置页「Drizzle Studio」分区的 sub-hook：收口状态查询 + start/stop/open 三 mutation 与进行态。
 * 状态查询由 `statusQueriesEnabled` 门控 —— 首屏两份配置就绪前不发探测，避免与秒级 HTTP 探测同批拖慢首屏。
 * `dbStudioLogActive` = 正在启动 OR 服务端快照 starting；返回形状与 controller 逐字段一致（§12.18 拆包不动契约）。
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
  statusQueriesEnabled,
  showFlash,
}: {
  /** 整页提示条通道，来自主 hook 的 useFlashLatch。 */
  showFlash: ActionReport;
  /** 首屏两份配置就绪前不发探测（同 comfyStatus 的口径）。 */
  statusQueriesEnabled: boolean;
}): UseSettingsDbStudio {
  const trpc = useTRPC();
  const statusQ = useQuery(
    trpc.setting.dbStudioStatus.queryOptions(undefined, {
      refetchInterval: 15_000,
      enabled: statusQueriesEnabled,
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
        { report: showFlash, failureText: "启动 Drizzle Studio 失败" },
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
        { report: showFlash, failureText: "关闭 Drizzle Studio 失败" },
      );
    } finally {
      setStopping(false);
    }
  }, [stopM, statusQ, showFlash]);

  const openDbStudioAction = useExternalAction({
    target: "browser",
    report: showFlash,
  });
  const openDbStudio = useCallback(async () => {
    await openDbStudioAction.run(() => openM.mutateAsync());
  }, [openDbStudioAction, openM]);

  const logActive = starting || !!statusQ.data?.starting;
  const log = useRuntimeLogSource({
    source: "drizzle-studio-runtime",
    active: logActive,
  });

  const raw = statusQ.data;
  return {
    dbStudioStatus: raw
      ? {
          up: !!raw.up,
          starting: !!raw.starting,
          port: raw.port ?? 4983,
        }
      : null,
    dbStudioStarting: starting,
    dbStudioStopping: stopping,
    dbStudioOpening: openDbStudioAction.busy,
    dbStudioLog: { ...log, active: logActive },
    startDbStudio,
    stopDbStudio,
    openDbStudio,
  };
}
