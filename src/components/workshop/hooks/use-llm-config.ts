"use client";

// ── LLM 配置：逻辑层（规范 17 §17.2 第②层）─────────────────────────────────
// 集中承载 LLMProvider 的 configGet 查询与设置弹窗的 configSave 提交。
// LLMContext.tsx（provider + 弹窗视图）不再直接出现 `api.llm.*`。

import { useCallback, useMemo } from "react";

import {
  effectiveProviderType,
  splitExtraModels,
  type LLMConfigView,
  type RemoteModelKind,
} from "~/lib/llm/types";
import { api } from "~/trpc/react";
import { useBusyAction } from "~/components/ui/use-busy-action";

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
  /** 静态配置下的远端生图模型名（kind=image，供定妆照等远端生图通道挑选）。 */
  remoteImageModels: string[];
  loading: boolean;
  refresh: () => void;
}

/** 候选模型分组：本地（Ollama）/ 远端文本（chat）/ 远端生图（image）。 */
type ModelSplit = {
  local: string[];
  remote: string[];
  remoteImage: string[];
};

const EMPTY_SPLIT: ModelSplit = { local: [], remote: [], remoteImage: [] };

export function useLLMConfig(): LLMConfigController {
  const configQ = api.llm.configGet.useQuery();

  const refresh = useCallback(() => {
    void configQ.refetch();
  }, [configQ]);

  /* query 结果 → 分组候选 + 收窄后的配置视图：两者都是 `cfg` 的**纯函数**
   * （不含用户输入），故直接 useMemo 派生（P2：去掉「prev 引用对比 + 渲染期
   * setState」的记账 state，也免掉首帧命中 tRPC 缓存时不播种的坑）。 */
  const { config, split } = useMemo((): {
    config: LLMConfigView | null;
    split: ModelSplit;
  } => {
    const cfg = configQ.data?.config;
    if (!cfg) return { config: null, split: EMPTY_SPLIT };
    /* 服务端的候选列表已条目化（本地=字符串、远端=带独立连接参数的对象），
       工坊下拉据此把「本地 / 远端」两组静态分开。
       注意：远端候选仅取 chat 类型——图片/视频模型不能执行文本生成。 */
    const p = splitExtraModels(cfg.extraModels);
    /* 远端候选只收 chat（或 kind 缺省按 chat 处理）的模型。 */
    const remoteNames = p.remoteEntries
      .filter((e) => isChatModel(e.kind))
      .map((e) => e.name);
    /* 远端生图模型（kind=image）单独一组，给定妆照等远端生图通道挑选。 */
    const remoteImageNames = p.remoteEntries
      .filter((e) => e.kind === "image")
      .map((e) => e.name);
    /* 本地 Ollama 模型均通过 chat/completions 调用，天然可做文本任务。 */
    const local = p.localNames.slice();
    const remote = remoteNames.slice();
    const model = cfg.model?.trim() ?? "";
    /* 生效提供方：本机 Ollama 被存成「远端 API」（baseUrl 回环 + 无密钥）时按
       本地分组与展示——否则 ollama 模型在下拉/徽标里被挂成「远端」，可用性
       探测也走错通道（§1.1 口径与 describeFetchFailure / foldRemoteToLocal 一致）。 */
    const effectiveProvider = effectiveProviderType(
      cfg.provider,
      cfg.baseUrl,
      !!cfg.apiKey,
    );
    /* 兜底：当前生效主模型不在候选里时，按生效提供方归入对应组，保证下拉总能选它。
       明确是远端 image/video 类型的主模型不收入文本候选（避免误选到生成任务）。 */
    if (model && !local.includes(model) && !remote.includes(model)) {
      const entry = p.remoteEntries.find((e) => e.name === model);
      if (effectiveProvider === "remote") {
        if (!entry || isChatModel(entry.kind)) remote.push(model);
      } else {
        local.push(model);
      }
    }
    return {
      split: { local, remote, remoteImage: remoteImageNames },
      config: {
        ...cfg,
        provider: effectiveProvider,
        extraModels: toModelNames(cfg.extraModels),
        hasApiKey: !!cfg.apiKey,
      },
    };
  }, [configQ.data]);

  return {
    config,
    localModels: split.local,
    remoteModels: split.remote,
    remoteImageModels: split.remoteImage,
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
  /* 忙碌位走唯一出口（规范 16 §16.2.4.71）。 */
  const saveBusy = useBusyAction();

  const save = useCallback(
    async (input: LLMConfigSaveInput): Promise<LLMConfigView> => {
      const data = await saveBusy.run(() => saveCfg.mutateAsync(input));
      const cfg = data.config;
      const rawExtra: unknown = (cfg as Record<string, unknown>).extraModels;
      return {
        ...cfg,
        hasApiKey: !!cfg.apiKey,
        // 与 useLLMConfig 同口径：本机 ollama 误存成「远端」时，保存后的
        // 视图配置也要按生效提供方展示，否则徽标/页脚闪回「远端」。
        provider: effectiveProviderType(
          cfg.provider as "local" | "remote",
          cfg.baseUrl,
          !!cfg.apiKey,
        ),
        extraModels: toModelNames(rawExtra),
        temperatureByTask:
          (cfg.temperatureByTask as
            Record<string, number> | null | undefined) ?? undefined,
      };
    },
    [saveCfg, saveBusy],
  );

  return { saving: saveBusy.busy, save };
}
