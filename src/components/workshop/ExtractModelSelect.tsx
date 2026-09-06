"use client";

import React from "react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { Icon } from "@/components/ui/icon";
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

/** 分组模型下拉：选项 = [工具] + [本地模型组] + [远端 API 组]。
 *  打开时拉取本地 / 远端模型清单（失败在组内展示原因，不弹错误）。 */
export function ExtractModelSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open] = React.useState(false);
  const [group, setGroup] = React.useState<GroupState>({
    localModels: [],
    remoteModels: [],
    localDetail: "",
    remoteDetail: "",
    loading: false,
  });
  /** 清单只拉一次，重挂时刷新（下拉关闭后再打开不重复请求） */
  const loadedRef = React.useRef(false);

  const load = React.useCallback(async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setGroup((g) => ({ ...g, loading: true }));
    const [local, remote] = await Promise.all([fetchLocalModels(), fetchRemoteModels()]);
    setGroup({
      localModels: local.models,
      remoteModels: remote.models,
      localDetail: local.ok ? "" : local.detail,
      remoteDetail: remote.ok ? "" : remote.detail,
      loading: false,
    });
  }, []);

  const options = React.useMemo(() => {
    const list = ["tool"];
    for (const m of group.localModels) list.push(`local::${m}`);
    for (const m of group.remoteModels) list.push(`remote::${m}`);
    return list;
  }, [group.localModels, group.remoteModels]);

  const labels = React.useMemo(() => {
    const map: Record<string, React.ReactNode> = { tool: "内置规则解析（不调用模型）" };
    for (const m of group.localModels) map[`local::${m}`] = optionLabel(m, "本地");
    for (const m of group.remoteModels) map[`remote::${m}`] = optionLabel(m, "远端");
    return map;
  }, [group.localModels, group.remoteModels]);

  /** 触发器展示文案：选中项短标（隐藏分组前缀） */
  const triggerLabel = React.useMemo(() => {
    if (value === "tool") return "工具";
    const { channel, model } = parseChannelOption(value);
    return model ? `${model}（${channel === "local" ? "本地" : "远端"}）` : "";
  }, [value]);

  return (
    <div className="relative">
      <DarkSelect
        value={value}
        onChange={(v) => {
          onChange(v);
          if (v !== "tool") void load();
        }}
        options={options}
        labels={labels}
        placeholder={triggerLabel || "选择提取方式"}
        className="!bg-white/3 !border-white/8 text-xs"
        popoverMinWidth={280}
        autoFitFromOptions={false}
      />
      {/* 打开下拉时在选项层下方补充分组空态提示（清单失败的原因） */}
      <GroupHints open={open} onLoad={load} group={group} />
      <span className="pointer-events-none absolute right-8 top-1/2 hidden -translate-y-1/2">
        <Icon name="sparkles" size={12} />
      </span>
    </div>
  );
}

/** 下拉打开后：拉清单 + 渲染空组提示。
 *  DarkSelect 的弹层是 portal，这里用同一触发器位置的独立小浮层兜底展示
 *  「本地/远端当前不可用」的原因；组内无空态需求时什么都不渲染。 */
function GroupHints({
  open,
  onLoad,
  group,
}: {
  open: boolean;
  onLoad: () => void;
  group: GroupState;
}) {
  React.useEffect(() => {
    if (open) onLoad();
  }, [open, onLoad]);

  if (!open) return null;
  const hints: string[] = [];
  if (group.localModels.length === 0 && group.localDetail) {
    hints.push(`本地模型不可用：${group.localDetail}`);
  }
  if (group.remoteModels.length === 0 && group.remoteDetail) {
    hints.push(`远端 API 不可用：${group.remoteDetail}`);
  }
  if (hints.length === 0 && !group.loading) return null;
  if (group.loading) {
    return (
      <p className="text-muted-foreground mt-1 text-[11px]">
        正在获取模型清单…
      </p>
    );
  }
  return (
    <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">{hints.join("；")}</p>
  );
}
