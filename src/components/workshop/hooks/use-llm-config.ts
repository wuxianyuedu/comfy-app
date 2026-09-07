"use client";

// ── LLM 配置：逻辑层（规范 17 §17.2 第②层）─────────────────────────────────
// 集中承载 LLMProvider 的 configGet 查询与设置弹窗的 configSave 提交。
// LLMContext.tsx（provider + 弹窗视图）不再直接出现 `api.llm.*`。

import { useCallback, useState } from "react";

import {
  splitExtraModels,
  type LLMConfigView,
  type RemoteModelKind,
} from "@/lib/llm/types";
import { api } from "~/trpc/react";

/** 判断远端模型是否为文本生成(对话)可用类型。
 *  kind 缺省(null)的历史条目按 chat 处理——与设置页 `kind ?? "chat"` 归组一致。 */
function isChatModel(kind: RemoteModelKind | null | undefined): boolean {
  return kind == null || kind === "chat";
}

/** 候选模型条目（兼容旧字符串与新对象）→ 名字数组，供工坊切换选择。
 *  远端条目仅收文本生成(chat)类型；图片/视频模型不参与工坊文本链路。 */
function toModelNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim() !== "") names.push(item);
    } else if (typeof item === "object" && item !== null) {
      const rec = item as { name?: unknown; kind?: unknown };
      const name = typeof rec.name === "string" ? rec.name.trim() : "";
      if (name === "") continue;
      const kind =
        typeof rec.kind === "string" &&
        ["chat", "image", "video"].includes(rec.kind)
          ? (rec.kind as RemoteModelKind)
          : null;
      if (!isChatModel(kind)) continue;
      names.push(name);
    }
  }
  return names;
}

export interface LLMConfigController {
  /** 当前生效配置（已做 hasApiKey 收窄）；首次加载完成前为 null。 */
  config: LLMConfigView | null;
  /** 静态配置下的本地候选模型名（本地 Ollama，无 apiKey）。 */
  localModels: string[];
  /** 静态配置下的远端独立模型名（存 remoteModel 表，仅 chat 文本生成类型）。 */
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
       工坊下拉据此把「本地 / 远端」两组静态分开。
       注意：远端候选仅取 chat 类型——图片/视频模型不能执行文本生成。 */
    const p = splitExtraModels(cfg.extraModels);
    /* 远端候选只收 chat（或 kind 缺省按 chat 处理）的模型。 */
    const remoteNames = p.remoteEntries
      .filter((e) => isChatModel(e.kind))
      .map((e) => e.name);
    /* 本地 Ollama 模型均通过 chat/completions 调用，天然可做文本任务。 */
    const local = p.localNames.slice();
    const remote = remoteNames.slice();
    const model = cfg.model?.trim() ?? "";
    /* 兜底：当前生效主模型不在候选里时，按 provider 归入对应组，保证下拉总能选它。
       明确是远端 image/video 类型的主模型不收入文本候选（避免误选到生成任务）。 */
    if (model && !local.includes(model) && !remote.includes(model)) {
      const entry = p.remoteEntries.find((e) => e.name === model);
      if (cfg.provider === "remote") {
        if (!entry || isChatModel(entry.kind)) remote.push(model);
      } else {
        local.push(model);
      }
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
