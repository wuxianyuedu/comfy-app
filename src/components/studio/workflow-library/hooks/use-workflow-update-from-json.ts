"use client";

// ── 在线工作流「从 JSON 更新」：变更 + 反馈收口（#4377，规范 17 §17.2 第②层）──
// 提交新 JSON → 服务端替换 rawJson 并做 IO 连线保持；断线报告（broken /
// droppedIOKeys）返回给视图就地展示。成功即失效详情 / 列表缓存（封装状态与
// 连线都会变）。

import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { runAsyncAction, type ActionReport } from "~/lib/async-action";
import type { BrokenWire } from "~/lib/workflow/workflow-update-remap";
import { useToast } from "../../ToastProvider";
import { useTRPC } from "~/trpc/react";

/** 更新完成后的断线报告（空 = 全部保持）。 */
export type UpdateJsonReport = {
  broken: Array<BrokenWire>;
  droppedIOKeys: Array<string>;
};

export function useWorkflowUpdateFromJson() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const updateMut = useMutation(trpc.workflow.updateFromJson.mutationOptions());
  const [submitting, setSubmitting] = useState(false);
  const [report, setReport] = useState<UpdateJsonReport | null>(null);

  /* #4463：报告属于「那一次更新」，不属于工作流本身 —— 换工作流 / 重新打开
   * 弹窗时由视图调用，避免上一条工作流的断线清单残留到下一条。 */
  const clearReport = useCallback(() => {
    setReport(null);
  }, []);

  /** 提交新 JSON。成功返回断线报告（可能为空），失败（解析 / 网络 / 服务端
   *  校验）返回 null 并给用户可见出口。 */
  const submit = useCallback(
    async (id: string, raw: unknown): Promise<UpdateJsonReport | null> => {
      setSubmitting(true);
      /* 新一次提交开始：上一份报告即刻作废（#4463），本次结果回来再摆新的。 */
      setReport(null);
      try {
        /* 反馈通道：失败走 toast（#4377 的断线报告由视图就地展示）。 */
        const report: ActionReport = (kind, detail) => {
          if (kind === "err") {
            toast.error(detail);
          }
        };
        let out: UpdateJsonReport | null = null;
        const result = await runAsyncAction(
          async () => {
            const res = await updateMut.mutateAsync({ id, raw });
            const value: UpdateJsonReport = {
              broken: res.broken,
              droppedIOKeys: res.droppedIOKeys,
            };
            out = value;
            setReport(value);
            /* 更新后详情与列表都要重算（IO 连线 / 封装状态 / 预览都变了）。 */
            await queryClient.invalidateQueries(trpc.workflow.detail.queryFilter({ id }));
            await queryClient.invalidateQueries(trpc.workflow.detailFull.queryFilter({ id }));
            await queryClient.invalidateQueries(trpc.workflow.list.queryFilter());
            return true;
          },
          {
            report,
            failureText: "更新失败",
            successText: () =>
              out !== null && (out.broken.length > 0 || out.droppedIOKeys.length > 0)
                ? "工作流已更新（部分连线已断开，请重新配置）"
                : "工作流已更新（IO 连线全部保持）",
          },
        );
        return result.ok ? out : null;
      } finally {
        setSubmitting(false);
      }
    },
    [updateMut, queryClient, trpc, toast],
  );

  return { submit, submitting, report, clearReport };
}
