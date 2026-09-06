"use client";

import React from "react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { fetchLocalModels, fetchRemoteModels } from "@/lib/llm/model-catalog-client";

/** 提取通道：①工具(内置规则) ②本地模型 ③远端 API —— 单下拉三分组 */
export type ExtractChannel = "tool" | "local" | "remote";

/** 下拉选项 key：工具通道无模型；local/remote 携带模型名 */
export function channelOptionValue(channel: ExtractChannel, model: string): string {
  return channel === "tool" ? "tool" : `${channel}::${model}`;
}

export function parseChannelOption(value: string): { channel: ExtractChannel; model: string } {
  if (value === "tool") return { channel: "tool", model: "" };
  const idx = value.indexOf("::");
  const channel = value.slice(0, idx) as "local" | "remote";
  return { channel, model: value.slice(idx + 2) };
}

/** 下拉单行标签：模型名 + 右侧「本地 / 远端」小标 */
function optionLabel(name: string, badge: string): React.ReactNode {
  return (
    <span className="flex w-full items-center">
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">{badge}</span>
    </span>
  );
}

interface GroupState {
  localModels: string[];
  remoteModels: string[];
  localDetail: string;
  remoteDetail: string;
  loading: boolean;
}

const EMPTY_GROUP: GroupState = {
  localModels: [],
  remoteModels: [],
  localDetail: "",
  remoteDetail: "",
  loading: false,
};

const TOOL_OPTION = "tool";

/** 分组模型下拉：选项 = [工具] + [本地模型组] + [远端 API 组]。
 *  首次展开时拉取本地 / 远端模型清单；失败/未配置时在对应分组位置
 *  展示原因（不可选中的占位行，不弹错误）。
 *  暴露 onOpenChange / refreshKey：父层可感知展开时机（触发懒加载），
 *  以及在设置可能变化后要求重新拉取清单。 */
export function ExtractModelSelect({
  value,
  onChange,
  refreshKey = 0,
}: {
  value: string;
  onChange: (value: string) => void;
  /** 递增时清空已拉清单，下次展开重新拉取（如设置保存后） */
  refreshKey?: number;
}) {
  const [loaded, setLoaded] = React.useState(0);
  const [group, setGroup] = React.useState<GroupState>(EMPTY_GROUP);
  /** 展开期间：避免「加载占位行」与「已拉取清单」同时出现 */
  const [pending, setPending] = React.useState(false);
  /** 清单只拉一次，重挂时刷新（下拉关闭后再打开不重复请求） */
  const pendingRef = React.useRef(false);

  const load = React.useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    const [local, remote] = await Promise.all([fetchLocalModels(), fetchRemoteModels()]);
    setGroup({
      localModels: local.models,
      remoteModels: remote.models,
      localDetail: local.ok ? "" : local.detail,
      remoteDetail: remote.ok ? "" : remote.detail,
      loading: false,
    });
    pendingRef.current = false;
    setPending(false);
  }, []);

  if (refreshKey !== loaded) {
    setLoaded(refreshKey);
    setGroup(EMPTY_GROUP);
  }

  /** 占位行展示优先级：清单在拉 → 「正在获取…」；已拉完 → 各自的失败原因 */
  const localPlaceholder = pending
    ? "正在获取本地模型清单…"
    : group.localDetail
      ? `本地模型不可用：${group.localDetail}`
      : "";
  const remotePlaceholder = pending
    ? "正在获取远端模型清单…"
    : group.remoteDetail
      ? `远端 API 不可用：${group.remoteDetail}`
      : "";

  const options = React.useMemo(() => {
    const list = [TOOL_OPTION];
    for (const m of group.localModels) list.push(`local::${m}`);
    for (const m of group.remoteModels) list.push(`remote::${m}`);
    return list;
  }, [group.localModels, group.remoteModels]);

  const labels = React.useMemo(() => {
    const map: Record<string, React.ReactNode> = {
      [TOOL_OPTION]: "工具 · 内置规则解析（不调用模型）",
    };
    for (const m of group.localModels) map[`local::${m}`] = optionLabel(m, "本地");
    for (const m of group.remoteModels) map[`remote::${m}`] = optionLabel(m, "远端");
    return map;
  }, [group.localModels, group.remoteModels]);

  return (
    <div>
      <DarkSelect
        value={value}
        onChange={onChange}
        options={options}
        labels={labels}
        footer={
          localPlaceholder || remotePlaceholder ? (
            <div className="max-h-32 overflow-y-auto border-t border-white/8 px-3 py-2">
              {localPlaceholder && (
                <p className="text-muted-foreground py-0.5 text-[11px] leading-relaxed">
                  {localPlaceholder}
                </p>
              )}
              {remotePlaceholder && (
                <p className="text-muted-foreground py-0.5 text-[11px] leading-relaxed">
                  {remotePlaceholder}
                </p>
              )}
            </div>
          ) : null
        }
        onOpenChange={(opening) => {
          if (opening) void load();
        }}
        placeholder="选择提取方式"
        className="!bg-white/3 !border-white/8 text-xs"
        popoverMinWidth={280}
        autoFitFromOptions={false}
      />
    </div>
  );
}
