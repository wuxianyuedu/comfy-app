/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { Icon } from "@/components/ui/Icon";
import { api } from "~/trpc/react";

/**
 * WorkflowParamConfig — 工作流节点参数暴露配置器
 *
 * 展示工作流所有节点，用户可为每个节点分配"角色"
 * （如正向提示词、输入图像、Checkpoint 等）。
 * 配置保存到后端 WorkflowTemplate.paramMap。
 *
 * 用法：
 *   <WorkflowParamConfig workflowId="xxx" onSave={(pm) => ...} />
 */

/* ── 可分配的角色定义 ── */
export interface ParamRole {
  key: string;           // 存储在 paramMap 中的键名
  label: string;         // 中文显示名
  icon: string;          // emoji 图标
  description: string;   // 说明文字
  color: string;         // 标签颜色（tailwind 类）
  /** 匹配优先级：数字越小越优先用于自动推断 */
  priority: number;
}

export const PARAM_ROLES: ParamRole[] = [
  {
    key: "positiveNode",
    label: "正向提示词",
    icon: "pen",
    description: "主提示词输入（CLIPTextEncode）",
    color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
    priority: 1,
  },
  {
    key: "negativeNode",
    label: "反向提示词",
    icon: "ban",
    description: "排除词输入（CLIPTextEncode）",
    color: "text-red-400 bg-red-500/15 border-red-500/30",
    priority: 2,
  },
  {
    key: "inputImageNode",
    label: "输入图像",
    icon: "image",
    description: "图生图/参考图加载（LoadImage）",
    color: "text-cyan-400 bg-cyan-500/15 border-cyan-500/30",
    priority: 3,
  },
  {
    key: "checkpointNode",
    label: "大模型",
    icon: "brain",
    description: "Checkpoint 加载（CheckpointLoaderSimple）",
    color: "text-violet-400 bg-violet-500/15 border-violet-500/30",
    priority: 4,
  },
  {
    key: "samplerNode",
    label: "采样器",
    icon: "dice",
    description: "采样节点（KSampler 等）",
    color: "text-amber-400 bg-amber-500/15 border-amber-500/30",
    priority: 5,
  },
  {
    key: "seedNode",
    label: "种子",
    icon: "sprout",
    description: "随机种子输入（Seed/Primitive）",
    color: "text-lime-400 bg-lime-500/15 border-lime-500/30",
    priority: 6,
  },
  {
    key: "vaeNode",
    label: "VAE",
    icon: "wand",
    description: "VAE 编解码（VAEEncode/VAEDecode）",
    color: "text-pink-400 bg-pink-500/15 border-pink-500/30",
    priority: 7,
  },
  {
    key: "loraNode",
    label: "LoRA",
    icon: "link",
    description: "LoRA 加载（LoraLoader）",
    color: "text-indigo-400 bg-indigo-500/15 border-indigo-500/30",
    priority: 8,
  },
];

export type WorkflowNodeForConfig = {
  id: string;
  class_type: string;
  title: string;
};

export type ParamMapValue = Record<string, string>; // roleKey -> nodeId

interface WorkflowParamConfigProps {
  workflowId: string;
  /** Initial nodes list (from graph); if omitted, will fetch from API */
  nodes?: WorkflowNodeForConfig[];
  /** Initial paramMap */
  initialParamMap?: ParamMapValue;
  /** Called after save completes */
  onSave?: (pm: ParamMapValue) => void;
  /** Compact mode: hide header/description, just show node→role mapping */
  compact?: boolean;
}

export function WorkflowParamConfig({
  workflowId,
  nodes: initialNodes,
  initialParamMap = {},
  onSave,
  compact = false,
}: WorkflowParamConfigProps) {
  const [paramMap, setParamMap] = useState<ParamMapValue>(initialParamMap);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Fetch nodes if not provided
  const detailQ = api.workflow.detail.useQuery(
    { id: workflowId },
    { enabled: !(initialNodes && initialNodes.length > 0) }
  );
  const fetchedNodes: WorkflowNodeForConfig[] = useMemo(
    () => Object.entries(detailQ.data?.template.graph ?? {}).map(([id, n]) => ({
      id,
      class_type: n.class_type,
      title: n.title ?? n.class_type,
    })),
    [detailQ.data?.template.graph]
  );

  const displayNodes = (initialNodes && initialNodes.length > 0) ? initialNodes : fetchedNodes;

  // Sync paramMap from fetched data (adjusted during render, React 19 pattern)
  const [prevParamMapSrc, setPrevParamMapSrc] = useState<ParamMapValue | undefined>(
    detailQ.data?.template.paramMap as ParamMapValue | undefined,
  );
  const paramMapSrc = detailQ.data?.template.paramMap as ParamMapValue | undefined;
  if (paramMapSrc !== prevParamMapSrc) {
    setPrevParamMapSrc(paramMapSrc);
    if (paramMapSrc) setParamMap(paramMapSrc);
  }

  const [prevIsError, setPrevIsError] = useState(detailQ.isError);
  if (detailQ.isError !== prevIsError) {
    setPrevIsError(detailQ.isError);
    if (detailQ.isError) setError("无法加载工作流详情");
  }

  // Reverse map: nodeId -> roleKey (for showing which role a node has)
  const nodeRoleMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [roleKey, nodeId] of Object.entries(paramMap)) {
      if (nodeId) map[nodeId] = roleKey;
    }
    return map;
  }, [paramMap]);

  const handleRoleChange = useCallback((nodeId: string, roleKey: string) => {
    setParamMap((prev) => {
      const next = { ...prev };
      // Remove this node from any existing role
      for (const [k, v] of Object.entries(next)) {
        if (v === nodeId) delete next[k];
      }
      // Assign new role (empty = unassign)
      if (roleKey) {
        next[roleKey] = nodeId;
      }
      return next;
    });
    setSaved(false);
  }, []);

  const updateWf = api.workflow.update.useMutation();

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      await updateWf.mutateAsync({ id: workflowId, paramMap });
      setSaved(true);
      onSave?.(paramMap);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message ?? "保存失败");
    } finally {
      setSaving(false);
    }
  }, [workflowId, paramMap, onSave, updateWf]);

  /* ── Assigned roles summary ── */
  const assignedRoles = PARAM_ROLES.filter((PARAM_ROLES) => paramMap[PARAM_ROLES.key]);
  const unassignedRoles = PARAM_ROLES.filter((PARAM_ROLES) => !paramMap[PARAM_ROLES.key]);

  if (!compact) {
    return (
      <div className="space-y-3 rounded-xl border border-white/[0.06] bg-[#0f0f16]/70 p-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="flex items-center text-[13px] font-semibold text-[#e5e7eb]">
              <Icon name="settings" size={14} className="mr-1.5 inline align-[-2px]" />
              参数暴露配置
            </h3>
            <p className="mt-0.5 text-[10.5px] text-[#6b7088]">
              选择工作流中哪些节点作为输入参数暴露给创作台
            </p>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-400 disabled:opacity-50"
          >
            {saving ? "保存中…" : saved ? "✓ 已保存" : "保存配置"}
          </button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        {/* Assigned roles pills */}
        {assignedRoles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10.5px] text-gray-500 pt-0.5">已配置：</span>
            {assignedRoles.map((assignedRole) =>
(
              <span
                key={assignedRole.key}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${assignedRole.color}`}
              >
                {assignedRole.icon} {assignedRole.label}
              </span>
            ))}
          </div>
        )}

        {/* Node list with role selectors */}
        <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
          {displayNodes.map((node) => {
            const currentRole = nodeRoleMap[node.id];
            const roleDef = currentRole ? PARAM_ROLES.find((PARAM_ROLES) => PARAM_ROLES.key === currentRole) : null;
            return (
              <div
                key={node.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 transition-colors hover:border-white/[0.1]"
              >
                {/* Node info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-[#e5e7eb]">{node.title}</p>
                  <p className="truncate text-[10px] text-[#6b7088]">
                    {node.class_type} · {node.id.slice(0, 8)}…
                  </p>
                </div>

                {/* Role selector */}
                <DarkSelect
                  className="h-7 w-[120px] py-1 text-[11px]"
                  value={currentRole ?? ""}
                  onChange={(value) => handleRoleChange(node.id, value)}
                  options={PARAM_ROLES.map((PARAM_ROLES) => PARAM_ROLES.key)}
                  labels={Object.fromEntries(PARAM_ROLES.map((PARAM_ROLES) => [PARAM_ROLES.key, PARAM_ROLES.label]))}
                  placeholder="— 不暴露 —"
                />

                {/* Current role badge */}
                {roleDef && (
                  <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${roleDef.color}`}>
                    <Icon name={roleDef.icon} size={11} />
                  </span>
                )}
              </div>
            );
          })}
          {displayNodes.length === 0 && (
            <p className="py-6 text-center text-[11px] text-gray-600">
              暂无节点数据。请先确保工作流已正确导入。
            </p>
          )}
        </div>

        {/* Unassigned roles hint */}
        {unassignedRoles.length > 0 && unassignedRoles.length < PARAM_ROLES.length && (
          <p className="text-[10px] text-gray-600">
            未配置：{unassignedRoles.map((unassignedRole) => unassignedRole.label).join("、")}（可选）
          </p>
        )}
      </div>
    );
  }

  /* ── Compact mode (for inline use in CreatePanel) ── */
  return (
    <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-300">
          参数映射
          {assignedRoles.length > 0 && (
            <span className="ml-1.5 text-violet-400">({assignedRoles.length})</span>
          )}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-violet-500/20 px-2 py-1 text-[10.5px] font-medium text-violet-300 hover:bg-violet-500/30 disabled:opacity-50"
        >
          {saving ? "…" : saved ? "✓" : "保存"}
        </button>
      </div>

      {/* Compact: show only assigned roles + quick unassign */}
      <div className="space-y-1">
        {assignedRoles.map((assignedRole) =>
{
          const nodeId = paramMap[assignedRole.key];
          const node = displayNodes.find((displayNode) => displayNode.id === nodeId);
          return (
            <div key={assignedRole.key} className="flex items-center justify-between gap-2">
              <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${assignedRole.color}`}>
                <Icon name={assignedRole.icon} size={11} /> {assignedRole.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-gray-400">
                {node?.title ?? nodeId?.slice(0, 12) ?? "—"}
              </span>
              <button
                type="button"
                onClick={() => handleRoleChange(nodeId ?? "", "")}
                className="text-gray-600 hover:text-red-400"
                title="移除"
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          );
        })}

        {/* Add role dropdown */}
        <div className="flex gap-1.5">
          <DarkSelect
            className="h-6 flex-1 py-0.5 text-[10px]"
            value=""
            onChange={(value) => {
              if (value) {
                const unassignedNode = displayNodes.find(
                  (node) => !Object.values(paramMap).includes(node.id)
                );
                if (unassignedNode) {
                  handleRoleChange(unassignedNode.id, value);
                }
              }
            }}
            options={unassignedRoles.map((unassignedRole) => unassignedRole.key)}
            labels={Object.fromEntries(unassignedRoles.map((unassignedRole) => [unassignedRole.key, unassignedRole.label]))}
            placeholder="+ 映射新参数…"
          />
        </div>
      </div>

      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
