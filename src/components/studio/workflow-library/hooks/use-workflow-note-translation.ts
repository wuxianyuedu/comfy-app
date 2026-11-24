"use client";

// 工作流 note 说明的翻译（ISSUE #4963）：网络调用只住在这层，组件保持纯展示（规范 17）。
// 复用现有 /api/llm 链路（completeChat），不另起基础设施。按 note 的 id+text 缓存，
// 切页签 / 重渲染不重译；同一段正文改了（text 变）才失效。

import { useCallback, useMemo, useRef, useState } from "react";

import { completeChat } from "~/lib/llm/browser";
import { buildWorkflowNoteTranslateMessages } from "~/lib/llm/prompts";

export type NoteTranslationState = {
  /** 失败原因（可读），成功或空闲时为空串。 */
  error: string;
  /** 正在翻译中。 */
  loading: boolean;
  /** 译文（已翻译成中文的正文），未翻译或不成功时为空串。 */
  text: string;
};

const EMPTY_STATE: NoteTranslationState = { text: "", loading: false, error: "" };

/** 缓存键：id + 正文 —— 同一 note 的正文没变就不重译。
 *  分隔符用可打印形式（noteId 是 ComfyUI 数字 id，不会含 `::`）。 */
function noteKey(noteId: string, text: string): string {
  return `${noteId}::${text}`;
}

export function useWorkflowNoteTranslation() {
  /* 缓存的是"已完成"的结果；in-flight 用另一个 ref 防同一 note 并发重复发请求。 */
  const cacheRef = useRef<Map<string, NoteTranslationState>>(new Map());
  const inflightRef = useRef<Set<string>>(new Set());
  const [, forceRender] = useState(0);

  const translate = useCallback(async (noteId: string, text: string): Promise<void> => {
    const key = noteKey(noteId, text);
    if (cacheRef.current.has(key) || inflightRef.current.has(key)) {
      return;
    }
    inflightRef.current.add(key);
    cacheRef.current.set(key, { text: "", loading: true, error: "" });
    forceRender((n) => n + 1);
    try {
      const result = await completeChat({
        messages: buildWorkflowNoteTranslateMessages(text),
        opts: { taskType: "chat" },
      });
      cacheRef.current.set(key, {
        text: result.trim() === "" ? "（译文为空）" : result,
        loading: false,
        error: "",
      });
    } catch (error) {
      cacheRef.current.set(key, {
        text: "",
        loading: false,
        error: error instanceof Error ? error.message : "翻译失败",
      });
    } finally {
      inflightRef.current.delete(key);
      forceRender((n) => n + 1);
    }
  }, []);

  const stateFor = useCallback(
    (noteId: string, text: string): NoteTranslationState =>
      cacheRef.current.get(noteKey(noteId, text)) ?? EMPTY_STATE,
    [],
  );

  return useMemo(() => ({ stateFor, translate }), [stateFor, translate]);
}
