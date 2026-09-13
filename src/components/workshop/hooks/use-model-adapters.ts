"use client";

// ── 工坊「模型适配」：逻辑层（规范 17 §17.2 第②层）────────────────────────
// 列出设置页配置的远端模型（image / video 类），按模型读取/保存「工坊模式
// 适配器」——每种模式一份：统一输入类型 → 请求体字段名 + 产物字段路径。
// 视图（WorkshopModelAdapterModal）只渲染 + 上抛，不直接出现 api.*。

import React, { useCallback, useState } from "react";

import {
  defaultEndpointPathForMode,
  defaultInputsForMode,
  parseRemoteModeAdapters,
  type RemoteModeAdapter,
} from "@/lib/workshop/model-mode-contract";
import { api } from "~/trpc/react";

export interface AdapterCandidate {
  name: string;
  kind: "image" | "video" | "chat";
  baseUrl: string | null;
}

export interface ModelAdaptersController {
  /** 可配置适配器的远端模型（kind=image / video）。 */
  candidates: AdapterCandidate[];
  loading: boolean;
  /** 当前选中模型的适配器草稿（选中变化时自动播种）。 */
  draft: RemoteModeAdapter[];
  setDraft: React.Dispatch<React.SetStateAction<RemoteModeAdapter[]>>;
  selectModel: (name: string) => void;
  selectedModel: string;
  /** 给选中模型追加一个模式的适配器草稿（预填该模式的默认输入清单）。 */
  addMode: (mode: string) => void;
  save: () => Promise<void>;
  saving: boolean;
  message: { kind: "ok" | "err"; text: string } | null;
}

export function useModelAdapters(): ModelAdaptersController {
  const configQ = api.llm.configGet.useQuery();
  const [selectedModel, setSelectedModel] = useState("");
  const [draft, setDraft] = useState<RemoteModeAdapter[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);

  const candidates: AdapterCandidate[] = React.useMemo(() => {
    const raw: unknown = configQ.data?.config;
    if (typeof raw !== "object" || raw === null) return [];
    const extra = (raw as Record<string, unknown>).extraModels;
    if (!Array.isArray(extra)) return [];
    const out: AdapterCandidate[] = [];
    for (const item of extra) {
      if (typeof item !== "object" || item === null) continue;
      const rec = item as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name : "";
      const kind =
        rec.kind === "video" ? "video" : rec.kind === "image" ? "image" : "chat";
      const baseUrl = typeof rec.baseUrl === "string" ? rec.baseUrl : null;
      if (!name || kind === "chat") continue; // 文本模型不参与工坊生图/视频
      out.push({ name, kind, baseUrl });
    }
    return out;
  }, [configQ.data]);

  const adaptersQ = api.llm.workshopAdaptersGet.useQuery(
    { name: selectedModel },
    { enabled: selectedModel !== "" },
  );

  // 适配器查询结果 → 本地草稿（渲染期播种，React 19 模式，见 §17.2）。
  const fetched = adaptersQ.data?.adapters;
  const [prevKey, setPrevKey] = useState<string | null>(null);
  if (selectedModel && prevKey !== selectedModel) {
    setPrevKey(selectedModel);
    setDraft(
      parseRemoteModeAdapters(
        fetched ?? [],
      ),
    );
  } else if (
    selectedModel &&
    prevKey === selectedModel &&
    fetched &&
    draft.length === 0 &&
    parseRemoteModeAdapters(fetched).length > 0
  ) {
    // 查询晚于选中：结果到达时草稿仍为空则播种（不覆盖已编辑内容）。
    setDraft(parseRemoteModeAdapters(fetched));
  }

  const saveMutation = api.llm.workshopAdaptersSave.useMutation();

  const selectModel = useCallback((name: string) => {
    setSelectedModel(name);
    setDraft([]);
    setMessage(null);
  }, []);

  const addMode = useCallback((mode: string) => {
    setDraft((prev) =>
      prev.some((a) => a.mode === mode)
        ? prev
        : [
            ...prev,
            {
              mode,
              endpointPath: defaultEndpointPathForMode(mode),
              inputs: defaultInputsForMode(mode),
              outputField: "",
            },
          ],
    );
  }, []);

  const save = useCallback(async () => {
    if (!selectedModel) return;
    setSaving(true);
    setMessage(null);
    try {
      const data = await saveMutation.mutateAsync({
        name: selectedModel,
        adapters: draft,
      });
      setDraft(parseRemoteModeAdapters(data.adapters));
      setMessage({ kind: "ok", text: `已保存 ${selectedModel} 的模式适配器。` });
    } catch (e) {
      setMessage({
        kind: "err",
        text: e instanceof Error ? e.message : "保存失败",
      });
    } finally {
      setSaving(false);
    }
  }, [selectedModel, draft, saveMutation]);

  return {
    candidates,
    loading: configQ.isLoading,
    draft,
    setDraft,
    selectModel,
    selectedModel,
    addMode,
    save,
    saving,
    message,
  };
}
