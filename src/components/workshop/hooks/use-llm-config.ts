"use client";

// ── LLM 配置：逻辑层（规范 17 §17.2 第②层）─────────────────────────────────
// 集中承载 LLMProvider 的 configGet 查询与设置弹窗的 configSave 提交。
// LLMContext.tsx（provider + 弹窗视图）不再直接出现 `api.llm.*`。

import { useCallback, useState } from "react";

import { splitExtraModels, type LLMConfigView } from "@/lib/llm/types";
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
  /** 静态配置下的本地候选模型名（本地 Ollama，无 apiKey）。 */
  localModels: string[];
  /** 静态配置下的远端独立模型名（存 remoteModel 表）。 */
  remoteModels: string[];
  loading: boolean;
  refresh: () => void;
}

export function useLLMConfig(): LLMConfigController {
  const configQ = api.llm.configGet.useQuery();
  const [config, setConfig] = useState<LLMConfigView | null>(null);
  const [split, setSplit] = useState<{ local: string[]; remote: string[] }>({
    local: [],
    remote: [],
  });

  const refresh = useCallback(() => {
    void configQ.refetch();
  }, [configQ]);

  // query 结果 → 本地状态（渲染期调整，React 19 模式，见 §17.2 hook 范式）。
  const cfg = configQ.data?.config;
  const [prevCfg, setPrevCfg] = useState(cfg);
  /* 播种条件：数据引用变化时重新播种；或数据已就绪而 derived config 仍未
   * 落定（首帧即命中 tRPC 缓存的场景）时播种。若只用引用对比，热重挂时
   * prevCfg 初值被缓存命中、cfg===prevCfg 永不成立，分支不触发——本地/远端
   * 候选与 config 就一直为空（下拉只剩「工具」一项）。与设置页播种同源守卫。 */
  if (cfg && (cfg !== prevCfg || !config)) {
    setPrevCfg(cfg);
    /* 服务端的候选列表已条目化（本地=字符串、远端=带独立连接参数的对象），
       工坊下拉据此把「本地 / 远端」两组静态分开。 */
    const p = splitExtraModels(cfg.extraModels);
    const remoteNames = p.remoteEntries.map((e) => e.name);
    /* 兜底：当前生效主模型不在候选里时，按 provider 归入对应组，保证下拉总能选它。 */
    const local = p.localNames.slice();
    const remote = remoteNames.slice();
    const model = cfg.model?.trim() ?? "";
    if (model && !local.includes(model) && !remote.includes(model)) {
      if (cfg.provider === "remote") remote.push(model);
      else local.push(model);
    }
    setSplit({ local, remote });
    setConfig({
      ...cfg,
      extraModels: toModelNames(cfg.extraModels),
      hasApiKey: !!cfg.apiKey,
    });
  }

  return {
    config,
    localModels: split.local,
    remoteModels: split.remote,
    loading: configQ.isLoading,
    refresh,
  };
}

export interface LLMConfigSaveInput {
  /** 工坊弹窗切模型与提供方；其余字段省略 → 服务端保持原值不变 */
  model: string;
  provider?: "local" | "remote";
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
