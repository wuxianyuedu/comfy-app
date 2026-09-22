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
 * 拆分动机：主 hook 曾 900+ 行；这一整块与 ComfyUI 的探测通道**共享同一
 * statusQueriesEnabled 门控**，但状态与动作各自独立、无交叉，是天然的第二块
 * 可拆单元。返回形状与主 hook 原控制器逐字段一致，视图与测试都不感知——
 * §12.18 复用优先，拆包只挪文件、不动契约。
 */
import { useCallback, useState } from "react";
import { useExternalAction } from "~/components/ui/use-external-action";
import { runAsyncAction } from "~/lib/async-action";
import { api } from "~/trpc/react";
import type { ActionReport } from "~/lib/async-action";
import {
  useRuntimeLogSource,
  type RuntimeLogController,
} from "./use-runtime-log-source";

export interface DbStudioStatus {
  up: boolean;
  starting: boolean;
  port: number;
}

export interface UseSettingsDbStudio {
  dbStudioStatus: DbStudioStatus | null;
  dbStudioStarting: boolean;
  dbStudioStopping: boolean;
  dbStudioOpening: boolean;
  dbStudioLog: RuntimeLogController & { active: boolean };
  startDbStudio: () => Promise<void>;
  stopDbStudio: () => Promise<void>;
  openDbStudio: () => Promise<void>;
}

export function useSettingsDbStudio({
  statusQueriesEnabled,
  showFlash,
}: {
  /** 首屏两份配置就绪前不发探测（同 comfyStatus 的口径）。 */
  statusQueriesEnabled: boolean;
  /** 整页提示条通道，来自主 hook 的 useFlashLatch。 */
  showFlash: ActionReport;
}): UseSettingsDbStudio {
  const statusQ = api.setting.dbStudioStatus.useQuery(undefined, {
    refetchInterval: 15_000,
    enabled: statusQueriesEnabled,
  });
  const startM = api.setting.dbStudioStart.useMutation();
  const stopM = api.setting.dbStudioStop.useMutation();
  const openM = api.setting.dbStudioOpen.useMutation();
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
