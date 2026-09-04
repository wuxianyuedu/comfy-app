"use client";

// ── 工作流参数暴露配置：逻辑层（规范 17 §17.2 第②层）──────────────────────
// 承载 workflow.detail 查询、paramMap 的渲染期同步，以及 workflow.update 保存。
// WorkflowParamConfig 视图只消费本 hook 的 controller，不再出现 `api.workflow.*`。

import { useCallback, useMemo, useState } from "react";

import { api } from "~/trpc/react";

export type WorkflowNodeForConfig = {
  id: string;
  class_type: string;
  title: string;
};

export type ParamMapValue = Record<string, string>; // roleKey -> nodeId

export interface WorkflowParamConfigController {
  paramMap: ParamMapValue;
  /** 变更某节点承担的角色（empty = 解除）。 */
  changeRole: (nodeId: string, roleKey: string) => void;
  /** 渲染用节点列表：有 initialNodes 时用传入的，否则用查询回来的。 */
  displayNodes: WorkflowNodeForConfig[];
  saving: boolean;
  saved: boolean;
  error: string;
  save: () => Promise<void>;
}

interface UseWorkflowParamConfigOptions {
  workflowId: string;
  initialNodes?: WorkflowNodeForConfig[];
  initialParamMap?: ParamMapValue;
  onSave?: (pm: ParamMapValue) => void;
}

export function useWorkflowParamConfig({
  workflowId,
  initialNodes,
  initialParamMap = {},
  onSave,
}: UseWorkflowParamConfigOptions): WorkflowParamConfigController {
  const [paramMap, setParamMap] = useState<ParamMapValue>(initialParamMap);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const detailQ = api.workflow.detail.useQuery(
    { id: workflowId },
    { enabled: !(initialNodes && initialNodes.length > 0) },
  );

  const fetchedNodes: WorkflowNodeForConfig[] = useMemo(
    () =>
      Object.entries(detailQ.data?.template.graph ?? {}).map(([id, n]) => {
        // graph 列是 JsonValue：逐条收窄后再读 class_type / title（§5.6）。
        const rec =
          typeof n === "object" && n !== null
            ? (n as Record<string, unknown>)
            : {};
        const classType =
          typeof rec.class_type === "string" ? rec.class_type : "";
        return {
          id,
          class_type: classType,
          title: typeof rec.title === "string" ? rec.title : classType,
        };
      }),
    [detailQ.data?.template.graph],
  );

  const displayNodes =
    initialNodes && initialNodes.length > 0 ? initialNodes : fetchedNodes;

  // 从查询结果同步 paramMap（渲染期调整，React 19 模式）。
  const paramMapSrc = detailQ.data?.template.paramMap as
    ParamMapValue | undefined;
  const [prevParamMapSrc, setPrevParamMapSrc] = useState<
    ParamMapValue | undefined
  >(paramMapSrc);
  if (paramMapSrc !== prevParamMapSrc) {
    setPrevParamMapSrc(paramMapSrc);
    if (paramMapSrc) setParamMap(paramMapSrc);
  }

  const [prevIsError, setPrevIsError] = useState(detailQ.isError);
  if (detailQ.isError !== prevIsError) {
    setPrevIsError(detailQ.isError);
    if (detailQ.isError) setError("无法加载工作流详情");
  }

  const updateWf = api.workflow.update.useMutation();

  const changeRole = useCallback((nodeId: string, roleKey: string) => {
    setParamMap((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(next)) {
        if (v === nodeId) delete next[k];
      }
      if (roleKey) {
        next[roleKey] = nodeId;
      }
      return next;
    });
    setSaved(false);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      await updateWf.mutateAsync({ id: workflowId, paramMap });
      setSaved(true);
      onSave?.(paramMap);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [workflowId, paramMap, onSave, updateWf]);

  return {
    paramMap,
    changeRole,
    displayNodes,
    saving,
    saved,
    error,
    save,
  };
}
