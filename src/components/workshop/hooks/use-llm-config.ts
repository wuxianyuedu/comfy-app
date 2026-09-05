"use client";

// ── LLM 配置：逻辑层（规范 17 §17.2 第②层）─────────────────────────────────
// 集中承载 LLMProvider 的 configGet 查询与设置弹窗的 configSave 提交。
// LLMContext.tsx（provider + 弹窗视图）不再直接出现 `api.llm.*`。

import { useCallback, useState } from "react";

import { type LLMConfigView } from "@/lib/llm/types";
import { api } from "~/trpc/react";

/** 候选模型条目（兼容旧字符串与新对象）→ 名字数组，供工坊切换选择。 */
function toModelNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim() !== "") names.push(item);
    } else if (typeof item === "object" && item !== null) {
      const name: unknown = (item as { name?: unknown }).name;
      if (typeof name === "string" && name.trim() !== "") names.push(name);
    }
  }
  return names;
}

export interface LLMConfigController {
  /** 当前生效配置（已做 hasApiKey 收窄）；首次加载完成前为 null。 */
  config: LLMConfigView | null;
  loading: boolean;
  refresh: () => void;
}

export function useLLMConfig(): LLMConfigController {
  const configQ = api.llm.configGet.useQuery();
  const [config, setConfig] = useState<LLMConfigView | null>(null);

  const refresh = useCallback(() => {
    void configQ.refetch();
  }, [configQ]);

  // query 结果 → 本地状态（渲染期调整，React 19 模式，见 §17.2 hook 范式）。
  const cfg = configQ.data?.config;
  const [prevCfg, setPrevCfg] = useState(cfg);
  if (cfg !== prevCfg) {
    setPrevCfg(cfg);
    if (cfg) {
      /* 服务端的候选列表已条目化（远端条目可带独立连接参数），工坊只关心名字 */
      setConfig({
        ...cfg,
        extraModels: toModelNames(cfg.extraModels),
        hasApiKey: !!cfg.apiKey,
      });
    }
  }

  return {
    config,
    loading: configQ.isLoading,
    refresh,
  };
}

export interface LLMConfigSaveInput {
  /** 工坊弹窗只切模型；其余字段省略 → 服务端保持原值不变 */
  model: string;
}

export interface LLMConfigSaveController {
  saving: boolean;
  /** 保存成功返回收窄后的视图配置；失败抛带可读文案的 Error。 */
  save: (input: LLMConfigSaveInput) => Promise<LLMConfigView>;
}

export function useLLMConfigSave(): LLMConfigSaveController {
  const saveCfg = api.llm.configSave.useMutation();
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (input: LLMConfigSaveInput): Promise<LLMConfigView> => {
      setSaving(true);
      try {
        const data = await saveCfg.mutateAsync(input);
        const cfg = data.config;
        const rawExtra: unknown = (cfg as Record<string, unknown>).extraModels;
        return {
          ...cfg,
          hasApiKey: !!cfg.apiKey,
          provider: cfg.provider as "local" | "remote",
          extraModels: toModelNames(rawExtra),
          temperatureByTask:
            (cfg.temperatureByTask as
              Record<string, number> | null | undefined) ?? undefined,
        };
      } finally {
        setSaving(false);
      }
    },
    [saveCfg],
  );

  return { saving, save };
}
