"use client";

/**
 * 设置页「加载失败判定与补记日志」的 sub-hook（ISSUE #304）。
 * `queryFailed` = 任一查询 isError；`hasError` = queryFailed 且草稿未就绪 —— 只按「两份数据都为空」判时，
 * 「一半成功一半失败」会落到没有重试的死角文案。加载失败不过全局错误钩子，须主动补记，同文案 ref 去重只记一次。
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { errorMessage, rawErrorDetail } from "~/lib/error-message";
import { postAppRuntimeLog } from "~/lib/log/log-file-client";
import { useTRPC } from "~/trpc/react";

export function useSettingsLoadStatus() {
  const trpc = useTRPC();
  const settingsQ = useQuery(trpc.setting.get.queryOptions());
  const llmQ = useQuery(trpc.llm.configGet.queryOptions());

  /* ── 加载失败判定（ISSUE #304）：「任一查询失败」与「两份都没拿到」是两件事。
   * `queryFailed` = 任一 isError；`hasError` = queryFailed 且草稿未就绪（此前只按「两份都空」判，
   * 「一半成功一半失败」会落到没有重试、没有日志指引的死角文案）。 */
  const queryFailed = !!settingsQ.isError || !!llmQ.isError;
  const isInitialLoad = settingsQ.isLoading || llmQ.isLoading;

  /* 多查询同批失败时，优先展示「更靠近根因」的那条：两份都没拿到时按
   * settings → llm 顺序取第一条非空错误（都是 undefined 时交 fallback）。 */
  const failedError =
    (settingsQ.isError ? settingsQ.error : undefined) ?? (llmQ.isError ? llmQ.error : undefined);

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
    if (!queryFailed || errorText === loggedErrorRef.current) {
      return;
    }
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
