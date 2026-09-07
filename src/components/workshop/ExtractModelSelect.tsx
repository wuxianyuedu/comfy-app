"use client";

import React from "react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { fetchLocalModels, fetchRemoteModels } from "@/lib/llm/model-catalog-client";
import { useLLM } from "@/components/workshop/LLMContext";

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

const TOOL_OPTION = "tool";

/** 分组模型下拉：选项 = [工具] + [本地模型组] + [远端 API 组]。
 *  候选来源是设置里保存的「静态配置」（本地候选 + 远端独立模型），不再
 *  在展开时实时探测服务。选完本地 / 远端模型后才去校验对应服务是否可达，
 *  并把结果以内联提示展示在下方（不影响「工具」通道与提取动作）。 */
export function ExtractModelSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { localModels, remoteModels } = useLLM();
  const { channel, model } = parseChannelOption(value);
  const selKey = channel === "tool" || !model ? "" : `${channel}::${model}`;

  /* 「选完再校验可用性」：选中本地 / 远端模型后才去探测对应服务是否可达。
   * 以 (key → 结果) 的缓存保存校验结果，异步回调里才 setState（不违反
   * react-hooks/set-state-in-effect）；重复选同一模型不重复探测。 */
  const [availByKey, setAvailByKey] = React.useState<
    Record<string, { kind: "ok" } | { kind: "err"; detail: string }>
  >({});
  const probeStarted = React.useRef<Record<string, boolean>>({});

  React.useEffect(() => {
    if (!selKey) return;
    if (probeStarted.current[selKey]) return;
    probeStarted.current[selKey] = true;
    let cancelled = false;
    const probe = channel === "local" ? fetchLocalModels : fetchRemoteModels;
    void probe().then((res) => {
      if (cancelled) return;
      setAvailByKey((prev) => ({
        ...prev,
        [selKey]: res.ok
          ? { kind: "ok" }
          : { kind: "err", detail: res.detail },
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [selKey, channel]);

  const options = React.useMemo(() => {
    const list = [TOOL_OPTION];
    for (const m of localModels) list.push(`local::${m}`);
    for (const m of remoteModels) list.push(`remote::${m}`);
    return list;
  }, [localModels, remoteModels]);

  const labels = React.useMemo(() => {
    const map: Record<string, React.ReactNode> = {
      [TOOL_OPTION]: "工具 · 内置规则解析（不调用模型）",
    };
    for (const m of localModels) map[`local::${m}`] = optionLabel(m, "本地");
    for (const m of remoteModels) map[`remote::${m}`] = optionLabel(m, "远端");
    return map;
  }, [localModels, remoteModels]);

  /* 内联可用性提示（放在下拉触发钮下方，关闭后仍可见）。
   * 只有当前选中是本地 / 远端模型时才展示：校验中 → 结果（可达 / 原因）。 */
  const selAvail = selKey ? availByKey[selKey] : undefined;
  /* 无已缓存结果即视为校验中（探测在选中时即被 effect 触发）。 */
  const selChecking = !!selKey && !selAvail;
  let hint: React.ReactNode = null;
  if (channel !== "tool") {
    const badge = channel === "local" ? "本地" : "远端";
    if (selChecking) {
      hint = (
        <p className="text-muted-foreground mt-1 text-[11px]">
          {badge}服务可用性校验中…
        </p>
      );
    } else if (selAvail?.kind === "ok") {
      hint = (
        <p className="mt-1 text-[11px] text-emerald-600">{badge}服务可达，可直接提取。</p>
      );
    } else if (selAvail?.kind === "err") {
      hint = (
        <p className="mt-1 text-[11px] leading-relaxed text-red-600">
          {badge}模型不可用：{selAvail.detail}。可先确认对应服务已启动 / 配置正确后再提取。
        </p>
      );
    }
  }

  return (
    <div>
      <div className="min-w-56">
        <DarkSelect
          value={value}
          onChange={onChange}
          options={options}
          labels={labels}
          placeholder="选择提取方式"
          className="!bg-(--color-subtle) !border-(--color-border) text-xs"
          popoverMinWidth={280}
          autoFitFromOptions={false}
        />
      </div>
      {hint}
    </div>
  );
}
