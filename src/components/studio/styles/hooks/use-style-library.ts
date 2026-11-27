"use client";

/**
 * 风格库的逻辑层（规范 17 §17.2 ②）：取数 / 画风新建 / 生图编排都在这里，
 * 视图组件只收 props。生图不新造链路：本地工作流走 `buildLibraryWorkflowInput`
 * → `startLocalGenerate` → `observeTaskUntilSettled`，远端模型走 `apiGenerateImage`；
 * 模型候选由 `useModelCatalog("image", "T2I")` 收窄（只给支持文生图的）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { vanillaApi } from "~/trpc/vanilla";
import {
  buildLibraryWorkflowInput,
  startLocalGenerate,
  WORKSHOP_BATCH_CONCURRENCY,
} from "~/lib/workshop/generation-client";
import { apiGenerateImage } from "~/lib/workshop/generation-api-client";
import { runAsyncAction } from "~/lib/async-action";
import { runWithConcurrency } from "~/lib/async-pool";
import { isRecord } from "~/lib/is-record";
import { cancelTask } from "~/lib/task-cancel-client";

import {
  LibraryTaskCancelledError,
  observeLibraryImageTask,
} from "~/components/studio/hooks/library-image-task";
import { useLibrarySelection } from "~/components/studio/hooks/use-library-selection";
import type { ModelSelection } from "~/components/workshop/ModelCascadeSelect";
import { useModelCatalog } from "~/components/workshop/hooks/use-model-catalog";
import { workflowIdFromCandidateValue } from "~/components/workshop/model-test-config";

import {
  ANIME_CHARACTER_PRESETS,
  applyStyleTemplate,
  composeBasePrompt,
  composeNegativePrompt,
  findPreset,
  SCENE_PRESETS,
} from "../style-presets";

/** 一条可用画风（skill 行的 UI 视图；tags 从 JSON 字符串解回）。 */
export type StyleItem = {
  description: string;
  name: string;
  negativePrompt?: string;
  promptTemplate: string;
  slug: string;
  tags: Array<string>;
};

/** 一格对比结果。taskId 只在本地工作流通道产生，远端通道没有可取消的任务行；
 *  远端通道把 url / 提示词 / 模型名留在结果里，供「加入资产库」复用（#5114）。 */
export type StyleResult = {
  error?: string;
  modelName?: string;
  negativePrompt?: string;
  prompt?: string;
  status: "pending" | "cancelling" | "cancelled" | "done" | "failed";
  taskId?: string;
  url?: string;
};

/** 新建画风表单的字段。 */
export type NewStyleDraft = {
  description: string;
  name: string;
  negativePrompt: string;
  promptTemplate: string;
  slug: string;
  tags: string;
};

const EMPTY_DRAFT: NewStyleDraft = {
  description: "",
  name: "",
  negativePrompt: "",
  promptTemplate: "",
  slug: "",
  tags: "",
};

/** 基础负向底线（与 prompt-builder 的负向基底同词表，不另立一套）。 */
const BASE_NEGATIVE = "ugly, deformed, bad anatomy, blurry, low quality, watermark, text";

/** skill.list 的返回是 `{...record, tags: unknown}`；按 record 逐字段收窄，畸形行跳过。 */
function parseStyles(raw: unknown): Array<StyleItem> {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const { description, name, negativePrompt, promptTemplate, slug, tags } = item;
    if (
      typeof description !== "string" ||
      typeof name !== "string" ||
      typeof promptTemplate !== "string" ||
      typeof slug !== "string"
    ) {
      return [];
    }
    const parsedTags = Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === "string")
      : [];
    return [
      {
        description,
        name,
        promptTemplate,
        slug,
        tags: parsedTags,
        ...(typeof negativePrompt === "string" && negativePrompt !== "" ? { negativePrompt } : {}),
      },
    ];
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useStyleLibrary() {
  const [search, setSearch] = useState("");
  const [styles, setStyles] = useState<Array<StyleItem>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const selection = useLibrarySelection<string>();
  const [userPrompt, setUserPrompt] = useState("");
  const [characterId, setCharacterId] = useState<string>("silver-mage");
  const [sceneId, setSceneId] = useState<string>("sakura-tree");
  const [modelSelection, setModelSelection] = useState<ModelSelection>({ mode: "T2I", model: "" });
  const [results, setResults] = useState<Record<string, StyleResult>>({});
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState<NewStyleDraft>(EMPTY_DRAFT);
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  /** 退订口按 taskId 登记，单条取消只需退订对应那一条 SSE。 */
  const disposers = useRef<Map<string, () => void>>(new Map());
  /** 已发起取消的画风：在途观察即便回报失败也不许把「已取消」改写掉。 */
  const cancelled = useRef<Set<string>>(new Set());

  const catalog = useModelCatalog("image", "T2I");

  /** 画风列表随搜索词刷新；卸载时把旧轮次的结果丢掉（竞态防护）。 */
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const data = await vanillaApi.skill.list.query({ category: "style", q: search.trim() });
          if (alive) {
            setStyles(parseStyles(data.skills));
            setLoadError("");
          }
        } catch {
          if (alive) {
            setLoadError("画风列表读取失败，稍后重试");
          }
        } finally {
          if (alive) {
            setLoading(false);
          }
        }
      })();
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [search]);

  /* 卸载时退订仍挂着的 SSE（有界：只收这一页起的观察器）。 */
  useEffect(
    () => () => {
      for (const dispose of disposers.current.values()) {
        dispose();
      }
      disposers.current.clear();
    },
    [],
  );

  const preview = useMemo(
    () =>
      composeBasePrompt({
        character: findPreset(ANIME_CHARACTER_PRESETS, characterId)?.description,
        scene: findPreset(SCENE_PRESETS, sceneId)?.description,
        userPrompt,
      }),
    [characterId, sceneId, userPrompt],
  );

  const patchResult = useCallback((slug: string, next: StyleResult) => {
    setResults((prev) => ({ ...prev, [slug]: next }));
  }, []);

  const toggleStyle = selection.toggle;
  const clearAll = selection.clear;
  const selectAll = useCallback(() => {
    selection.selectAll(styles.map((style) => style.slug));
  }, [selection, styles]);

  const createStyle = useCallback(async (): Promise<boolean> => {
    const name = draft.name.trim();
    const slug = draft.slug.trim();
    const promptTemplate = draft.promptTemplate.trim();
    if (name === "" || slug === "" || promptTemplate === "") {
      setCreateError("名字、标识与画风提示词描述都要填");
      return false;
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setCreateError("标识只允许小写字母、数字与连字符");
      return false;
    }
    setCreating(true);
    setCreateError("");
    try {
      await vanillaApi.skill.create.mutate({
        category: "style",
        description: draft.description.trim() || name,
        icon: "sparkles",
        name,
        negativePrompt: draft.negativePrompt.trim() || undefined,
        promptTemplate,
        slug,
        tags: draft.tags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter((tag) => tag !== ""),
      });
      setDraft(EMPTY_DRAFT);
      setDraftOpen(false);
      setSearch("");
      selection.add(slug);
      return true;
    } catch (error) {
      setCreateError(errorMessage(error));
      return false;
    } finally {
      setCreating(false);
    }
  }, [draft, selection]);

  /** 生成多画风对比：每格独立失败，不影响其他画风；有界并发沿用工坊档位。 */
  const generate = useCallback(async (): Promise<void> => {
    if (preview.trim() === "") {
      setNotice("先写提示词，或选一个角色 / 场景");
      return;
    }
    const chosen = styles.filter((style) => selection.selected.includes(style.slug));
    if (chosen.length === 0) {
      setNotice("先勾选至少一个画风");
      return;
    }
    const candidate = catalog.resolveCandidate(modelSelection.model);
    if (candidate === null) {
      setNotice("先选一个支持文生图（T2I）的模型");
      return;
    }
    setNotice("");
    setGenerating(true);
    cancelled.current.clear();
    for (const dispose of disposers.current.values()) {
      dispose();
    }
    disposers.current.clear();
    const workflowId = workflowIdFromCandidateValue(modelSelection.model);
    const nextResults: Record<string, StyleResult> = {};
    for (const style of chosen) {
      nextResults[style.slug] = { status: "pending" };
    }
    setResults(nextResults);
    try {
      await runWithConcurrency(chosen, WORKSHOP_BATCH_CONCURRENCY, async (style) => {
        try {
          const prompt = applyStyleTemplate(preview, style.promptTemplate);
          const negative = composeNegativePrompt(BASE_NEGATIVE, style.negativePrompt);
          let url: string;
          let taskId: string | undefined;
          if (workflowId === "") {
            url = await apiGenerateImage({
              mode: "T2I",
              model: candidate.name,
              negative,
              prompt,
            });
          } else {
            const built = await buildLibraryWorkflowInput(workflowId, {
              negativePrompt: negative,
              prompt,
            });
            taskId = await startLocalGenerate(built.input);
            if (cancelled.current.has(style.slug)) {
              return;
            }
            patchResult(style.slug, { status: "pending", taskId });
            url = await observeLibraryImageTask(taskId, (id, dispose) => {
              disposers.current.set(id, dispose);
            });
          }
          if (cancelled.current.has(style.slug)) {
            return;
          }
          patchResult(style.slug, {
            ...(taskId === undefined
              ? { modelName: candidate.name, negativePrompt: negative, prompt }
              : { taskId }),
            status: "done",
            url,
          });
        } catch (error) {
          if (cancelled.current.has(style.slug) || error instanceof LibraryTaskCancelledError) {
            return;
          }
          patchResult(style.slug, { error: errorMessage(error), status: "failed" });
        }
      });
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setGenerating(false);
    }
  }, [catalog, modelSelection.model, patchResult, preview, selection, styles]);

  /** 单条取消：只对本地工作流通道生效（远端通道没有 task 行）。 */
  const cancelOne = useCallback(
    async (slug: string): Promise<void> => {
      const current = results[slug];
      if (current?.status !== "pending" || current.taskId === undefined || current.taskId === "") {
        return;
      }
      const taskId = current.taskId;
      const name = styles.find((style) => style.slug === slug)?.name ?? slug;
      cancelled.current.add(slug);
      patchResult(slug, { status: "cancelling", taskId });
      const outcome = await runAsyncAction(() => cancelTask(taskId), {
        report: (kind, detail) => {
          if (kind === "err") {
            setNotice(detail);
          }
        },
        failureText: `取消「${name}」失败，请稍后重试`,
        successText: `已取消「${name}」的生成`,
      });
      if (outcome.ok) {
        disposers.current.get(taskId)?.();
        disposers.current.delete(taskId);
        patchResult(slug, { status: "cancelled", taskId });
        return;
      }
      cancelled.current.delete(slug);
      patchResult(slug, { status: "pending", taskId });
    },
    [patchResult, results, styles],
  );

  return {
    cancelOne,
    catalog,
    characterId,
    clearAll,
    createError,
    createStyle,
    creating,
    draft,
    draftOpen,
    generate,
    generating,
    loadError,
    loading,
    modelSelection,
    notice,
    preview,
    results,
    sceneId,
    search,
    selectAll,
    selectedSlugs: selection.selected,
    setCharacterId,
    setDraft,
    setDraftOpen,
    setModelSelection,
    setSceneId,
    setSearch,
    setUserPrompt,
    styles,
    toggleStyle,
    userPrompt,
  };
}
