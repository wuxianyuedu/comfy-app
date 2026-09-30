"use client";

/**
 * 设置页「加载失败判定与补记日志」的 sub-hook（`use-settings-page` 的拆分件）。
 *
 * 「任一查询失败」与「两份配置都没拿到」是两件事。此前 `hasError` 只按
 * 「两份数据都为空」判定，于是「setting.get 成功、llm.configGet 失败」时：
 * 失败为真、草稿却仍为空 → 既不满足 hasError、也不满足 isInitialLoad，
 * 容器一路落到那句没有重试、没有原因、也没有日志指引的「配置数据未就绪」，
 * 用户被冻在死胡同里（正是 ISSUE #304 截图的现象）。现在把两个语义拆开：
 *   - `queryFailed`：任一查询 isError（错误视图与补记日志的判据）；
 *   - `hasError`：queryFailed **且** 草稿未就绪（容器据此走降级视图）。
 * 「一半成功一半失败」时草稿同样为空，因此也会落到错误视图，拿到重试与
 * 日志出口，而不是死角文案。
 *
 * 补记日志：加载失败只体现在降级 UI，不经过 console / unhandledrejection，
 * 全局错误钩子收不到——不主动补记的话，用户遇到失败时面板里什么也没有。
 * 同一错误文案只记一次（ref 去重；重试后仍是同一错误不刷屏）。
 */
import { useEffect, useRef } from "react";

import { errorMessage, rawErrorDetail } from "~/lib/error-message";
import { postAppRuntimeLog } from "~/lib/log/log-file-client";
import { api } from "~/trpc/react";

export function useSettingsLoadStatus() {
  const settingsQ = api.setting.get.useQuery();
  const llmQ = api.llm.configGet.useQuery();

  /* ── 加载失败判定 ────────────────────────────────────────────
   * 「任一查询失败」与「两份配置都没拿到」是两件事。此前 `hasError` 只按
   * 「两份数据都为空」判定，于是「setting.get 成功、llm.configGet 失败」时：
   * 失败为真、草稿却仍为空 → 既不满足 hasError、也不满足 isInitialLoad，
   * 容器一路落到那句没有重试、没有原因、也没有日志指引的「配置数据未就绪」，
   * 用户被冻在死胡同里（正是 ISSUE #304 截图的现象）。
   * 现在把两个语义拆开：
   *   - `queryFailed`：任一查询 isError（错误视图与补记日志的判据）；
   *   - `hasError`：queryFailed **且** 草稿未就绪（容器据此走降级视图）。
   * 「一半成功一半失败」时草稿同样为空，因此也会落到错误视图，拿到重试与
   * 日志出口，而不是死角文案。 */
  const queryFailed = !!settingsQ.isError || !!llmQ.isError;
  const isInitialLoad = settingsQ.isLoading || llmQ.isLoading;

  /* 多查询同批失败时，优先展示「更靠近根因」的那条：两份都没拿到时按
   * settings → llm 顺序取第一条非空错误（都是 undefined 时交 fallback）。 */
  const failedError =
    (settingsQ.isError ? settingsQ.error : undefined) ??
    (llmQ.isError ? llmQ.error : undefined);

  const errorText = queryFailed ? errorMessage(failedError, "未知错误") : "";

  /* 失败涉及的查询名（给面板日志的字段用；两个都失败时都记上）。 */
  const failedQueries = [
    settingsQ.isError ? "setting.get" : null,
    llmQ.isError ? "llm.configGet" : null,
  ]
    .filter((name): name is string => name !== null)
    .join(",");

  /* 加载失败落 app-runtime 错误日志（面板轮询 source=app-runtime 可见）。
   * 查询失败只体现在降级 UI，不经过 console / unhandledrejection，全局
   * 错误钩子收不到——不主动补记的话，用户遇到失败时面板里什么也没有。
   * 同一错误文案只记一次（ref 去重；重试后仍是同一错误不刷屏）。 */
  const loggedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!queryFailed || errorText === loggedErrorRef.current) return;
    loggedErrorRef.current = errorText;
    void postAppRuntimeLog("settings", "error", `设置加载失败 ${errorText}`, {
      query: failedQueries,
      /* 原始报错（含 tRPC code / 服务端 message / stack 首行）一并落盘：
       * 面板展示的是翻译后的可读文案，原文留在日志里供排查。 */
      raw: rawErrorDetail(failedError),
    });
  }, [queryFailed, errorText, failedQueries, failedError]);

  return { queryFailed, isInitialLoad, errorText };
}
