"use client";

// ── 参考图装载预设库：取数 / 保存收口（规范 17 §17.2 第②层）────────────────
// 预设编辑弹窗与工作流绑定区共用这一份（同一份清单、同一个保存出口），不各写各的。

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ReferenceLoaderPreset } from "~/lib/workshop/reference-loader-preset";
import { useTRPC } from "~/trpc/react";

export function useReferenceLoaderPresets() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const presetsQ = useQuery(
    trpc.referenceLoader.presetsGet.queryOptions(undefined, {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    }),
  );
  const saveMut = useMutation(trpc.referenceLoader.presetsSave.mutationOptions());

  const save = useCallback(
    async (presets: Array<ReferenceLoaderPreset>): Promise<Array<ReferenceLoaderPreset>> => {
      const res = await saveMut.mutateAsync(presets);
      await queryClient.invalidateQueries({
        queryKey: trpc.referenceLoader.presetsGet.queryKey(),
      });
      return res.presets;
    },
    [saveMut, queryClient, trpc],
  );

  return {
    presets: presetsQ.data?.presets ?? [],
    loading: presetsQ.isLoading,
    /** 保存（全量覆盖）。失败向上抛，由调用方给用户可见出口。 */
    save,
  };
}

/** 节点类目录按需查询（#4376）：预设编辑器加节点按 `search` 搜，已选节点按
 *  `classes` 取控件定义。`enabled: false` 时不发请求。 */
export function useNodeClassCatalog(args: {
  classes?: Array<string>;
  enabled?: boolean;
  search?: string;
}) {
  const trpc = useTRPC();
  return useQuery(
    trpc.referenceLoader.nodeClasses.queryOptions(
      { classes: args.classes, search: args.search },
      { enabled: args.enabled ?? true },
    ),
  );
}
