"use client";

// ── 工坊「模型适配」：逻辑层（规范 17 §17.2 第②层）────────────────────────
// 列出设置页配置的远端模型（image / video 类），按模型读取/保存「工坊模式
// 适配器存档」—— 每模式一份字段映射（统一输入 → 请求体字段名 + 产物字段
// 路径）。端点是模型级配置，与模式无关：#3656 起在「设置 → 远程模型」的
// 接口端点下拉配置，#3631 起本页不再读、不再写、也不显示它（保存入参省略
// 这格，服务端保住既有值）。
// 视图（ModelAdaptersView）只渲染 + 上抛，不直接出现 api.*。

import React, { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "~/lib/error-message";

import { adapterInputsFromContract } from "~/lib/workshop/model-mode-contract";
import { parseRemoteModeAdapters } from "~/lib/workshop/remote-model-adapter";
import type { RemoteModeAdapter } from "~/lib/workshop/remote-model-adapter";
import { effectiveModeContract } from "~/components/workshop/mode-contract/mode-contract-config";
import { useModeContracts } from "~/components/workshop/mode-contract/hooks/use-mode-contracts";
import { useTRPC } from "~/trpc/react";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { isRecord } from "~/lib/is-record";

export type AdapterCandidate = {
  baseUrl: string | null;
  kind: "image" | "video" | "chat";
  name: string;
};

/** 概览条目：哪些模型配了适配器、各配了哪些模式（清单「已配」标记用）。 */
export type AdapterSummary = {
  modes: Array<string>;
  name: string;
};

export type ModelAdaptersController = {
  /** 给选中模型追加一个模式的适配器草稿（预填该模式的默认输入清单）。 */
  addMode: (mode: string) => void;
  /** 可配置适配器的远端模型（kind=image / video）。 */
  candidates: Array<AdapterCandidate>;
  /** 当前选中模型的适配器草稿（选中变化时自动播种）。 */
  draft: Array<RemoteModeAdapter>;
  loading: boolean;
  message: { kind: "ok" | "err"; text: string } | null;
  /** 模式契约注册表（每种模式的统一输入 / 输出）。 */
  modeContracts: ReturnType<typeof useModeContracts>;
  save: () => Promise<void>;
  saving: boolean;
  selectedModel: string;
  selectModel: (name: string) => void;
  setDraft: React.Dispatch<React.SetStateAction<Array<RemoteModeAdapter>>>;
  /** 各模型已配置的适配器概览（「已配」标记；保存后自动刷新）。 */
  summary: Array<AdapterSummary>;
};

export function useModelAdapters(): ModelAdaptersController {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const configQ = useQuery(trpc.llm.configGet.queryOptions());
  const modeContracts = useModeContracts();
  /* 概览：哪些模型已经配了适配器（保存后失效重取，「已配」标记跟着亮）。 */
  const summaryQ = useQuery(trpc.llm.workshopAdaptersSummary.queryOptions());
  const [selectedModel, setSelectedModel] = useState("");
  const [draft, setDraft] = useState<Array<RemoteModeAdapter>>([]);
  /* 忙碌位走唯一出口（规范 16 §16.2.4.71）。 */
  const saveBusy = useBusyAction();
  const [message, setMessage] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const candidates: Array<AdapterCandidate> = React.useMemo(() => {
    const raw: unknown = configQ.data?.config;
    if (!isRecord(raw)) {
      return [];
    }
    const extra = raw.extraModels;
    if (!Array.isArray(extra)) {
      return [];
    }
    const out: Array<AdapterCandidate> = [];
    for (const item of extra) {
      if (!isRecord(item)) {
        continue;
      }
      const name = typeof item.name === "string" ? item.name : "";
      const kind = item.kind === "video" ? "video" : item.kind === "image" ? "image" : "chat";
      const baseUrl = typeof item.baseUrl === "string" ? item.baseUrl : null;
      if (!name || kind === "chat") {
        continue;
      } // 文本模型不参与工坊生图/视频
      out.push({ name, kind, baseUrl });
    }
    return out;
  }, [configQ.data]);

  const adaptersQ = useQuery(
    trpc.llm.workshopAdaptersGet.queryOptions(
      { name: selectedModel },
      { enabled: selectedModel !== "" },
    ),
  );

  /* 存档查询结果 → 本地草稿（渲染期播种，React 19 模式，见 §17.2）。
   * 记账用「本轮选中模型是否已播种过、播种时结果是否已到达」，而不是
   * `draft.length === 0`——后者在用户把适配器**删空**后恒真，会被反复灌回
   * （表现为删不掉）；只播种一次也保留了「不覆盖用户编辑」的原意。 */
  const fetchedDoc = adaptersQ.data;
  const fetchedTag = fetchedDoc ? JSON.stringify(fetchedDoc) : "";
  const [seeded, setSeeded] = useState<{ model: string; tag: string } | null>(null);
  if (selectedModel && seeded?.model !== selectedModel) {
    // 切换选中模型：用当前（可能还没回来的）结果播种一次。
    setSeeded({ model: selectedModel, tag: fetchedTag });
    setDraft(parseRemoteModeAdapters(fetchedDoc?.adapters ?? []));
  } else if (selectedModel && seeded?.tag === "" && fetchedTag) {
    // 查询晚于选中到达：首次结果落地时补种一次（之后不再覆盖用户编辑）。
    setSeeded({ model: selectedModel, tag: fetchedTag });
    setDraft(parseRemoteModeAdapters(fetchedDoc?.adapters ?? []));
  }

  const saveMutation = useMutation(trpc.llm.workshopAdaptersSave.mutationOptions());

  const selectModel = useCallback((name: string) => {
    setSelectedModel(name);
    setDraft([]);
    setMessage(null);
  }, []);

  const addMode = useCallback(
    (mode: string) => {
      setDraft((prev) =>
        prev.some((a) => a.mode === mode)
          ? prev
          : [
              ...prev,
              {
                mode,
                // 默认输入清单来自**生效的模式契约**（effectiveModeContract =
                // 成品配置〔项目默认〕→ 本机覆盖逐模式压过它，#3634）——
                // 统一口在这里先定义、适配器只做翻译；与契约编辑器的初值同源，
                // 不会出现「编辑器看到 A、适配器预填 B」。
                inputs: adapterInputsFromContract(
                  effectiveModeContract(mode, modeContracts.contracts, modeContracts.configured)
                    .contract,
                ),
                outputField: "",
              },
            ],
      );
    },
    [modeContracts.configured, modeContracts.contracts],
  );

  const save = useCallback(async () => {
    if (!selectedModel) {
      return;
    }
    setMessage(null);
    try {
      /* 保存入参不带端点路径（#3631）：本页不读不写它 —— 服务端在入参省略
       * 时保住既有值（设置页「接口端点」下拉写的那个），不会被这里冲掉。 */
      const saved = await saveBusy.run(() =>
        saveMutation.mutateAsync({
          name: selectedModel,
          adapters: draft,
        }),
      );
      /* 保存成功后**失效**相关查询（ISSUE #3622 评论 1 的根因）：存档查询的
       * 缓存还停在保存前，页签切走再切回来时草稿按旧缓存播种，刚配的模式
       * 「消失」一轮。失效让 react-query 重取，页签往返读到的就是已存档。 */
      await queryClient.invalidateQueries({
        queryKey: trpc.llm.workshopAdaptersGet.queryKey({ name: selectedModel }),
      });
      await queryClient.invalidateQueries({
        queryKey: trpc.llm.workshopAdaptersSummary.queryKey(),
      });
      setDraft(parseRemoteModeAdapters(saved.adapters));
      setMessage({
        kind: "ok",
        text: `已保存 ${selectedModel} 的模式适配器。`,
      });
    } catch (error) {
      setMessage({
        kind: "err",
        text: errorMessage(error, "保存失败"),
      });
    }
  }, [selectedModel, draft, saveMutation, saveBusy, queryClient, trpc]);

  return {
    candidates,
    loading: configQ.isLoading,
    modeContracts,
    draft,
    setDraft,
    selectModel,
    selectedModel,
    addMode,
    save,
    saving: saveBusy.busy,
    message,
    summary: summaryQ.data?.models ?? [],
  };
}
