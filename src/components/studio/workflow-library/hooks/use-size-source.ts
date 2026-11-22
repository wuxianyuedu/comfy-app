// 尺寸来源开关的编排（第②层，从 WorkflowCanvasNodePreview 拆出以满足函数长度）：
// 读的是参数落点 hook 合并后的生效 paramMap，写走它的 commitParamMap（先并本地态再
// 落库），避免这一笔覆盖在飞连线改动。没有模式时只读展示，不提供切换。

import { useCallback } from "react";

import { sizeSourceForMode, withSizeSource } from "~/lib/workflow/workflow-size-source";

export function useSizeSource({
  commitParamMap,
  effectiveMode,
  effectiveParamMap,
}: {
  commitParamMap: (next: Record<string, unknown>) => void;
  effectiveMode: string | null;
  effectiveParamMap: Record<string, unknown>;
}) {
  const sizeFromReference =
    sizeSourceForMode(effectiveParamMap, effectiveMode) === "reference-image";
  const onSizeFromReferenceChange = useCallback(
    (enabled: boolean) => {
      if (effectiveMode === null) {
        return;
      }
      commitParamMap(
        withSizeSource({
          paramMap: effectiveParamMap,
          mode: effectiveMode,
          from: enabled ? "reference-image" : null,
        }),
      );
    },
    [commitParamMap, effectiveMode, effectiveParamMap],
  );
  return { onSizeFromReferenceChange, sizeFromReference };
}
