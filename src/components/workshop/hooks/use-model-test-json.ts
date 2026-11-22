"use client";

// ── 测试模型 · JSON 输入模式的解析与应用（ISSUE #4769）─────────────────────
// 历史页「复制去重投」复制的载荷（{ mode, inputs }）在这里解析并写回当前格
// 表单值；错误文案走 errorMessage 的 fallback 档（动作名作兜底，不手拼前缀）。
// 从 useModelTest 拆出（§12.13：主 hook 越过函数长度硬闸）。

import { useCallback } from "react";

import { isRecord } from "~/lib/is-record";
import { errorMessage } from "~/lib/error-message";
import { isWorkshopInputType } from "~/lib/workshop/remote-model-adapter";

import type { ModelTestValues } from "../model-test-config";

/** applyJsonValues 对会话的写入面（只碰表单值与错误反馈位）。 */
type JsonApplyPatch = {
  error?: string | null;
  values?: ModelTestValues;
};

export function useApplyJsonValues(args: {
  /** 当前格的键（ref 转发，保持回调身份稳定）。 */
  activeKeyRef: { current: string };
  patchSession: (key: string, patch: JsonApplyPatch) => void;
  /** 当前格的表单值（合并基底）。 */
  values: ModelTestValues;
}): {
  applyJsonValues: (
    json: string,
  ) => { ok: true; values: ModelTestValues } | { error: string; ok: false };
} {
  const { values, activeKeyRef, patchSession } = args;
  const applyJsonValues = useCallback(
    (json: string): { ok: true; values: ModelTestValues } | { error: string; ok: false } => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json) as unknown;
      } catch (error) {
        const text = errorMessage(error, "JSON 解析失败");
        patchSession(activeKeyRef.current, { error: text });
        return { ok: false, error: text };
      }
      if (!isRecord(parsed)) {
        const text = "JSON 需要是对象（历史「复制去重投」的载荷形状是 { mode, inputs }）";
        patchSession(activeKeyRef.current, { error: text });
        return { ok: false, error: text };
      }
      const rawInputs: unknown = parsed.inputs;
      if (!isRecord(rawInputs)) {
        const text = "JSON 缺少 inputs 对象（历史「复制去重投」的载荷形状是 { mode, inputs }）";
        patchSession(activeKeyRef.current, { error: text });
        return { ok: false, error: text };
      }
      const patch: Partial<ModelTestValues> = {};
      for (const [key, value] of Object.entries(rawInputs)) {
        if (!isWorkshopInputType(key) || typeof value !== "string" || value.trim() === "") {
          continue;
        }
        patch[key] = value;
      }
      if (Object.keys(patch).length === 0) {
        const text = "JSON 的 inputs 里没有测试页认得的参数键";
        patchSession(activeKeyRef.current, { error: text });
        return { ok: false, error: text };
      }
      const nextValues: ModelTestValues = { ...values, ...patch };
      patchSession(activeKeyRef.current, { values: nextValues, error: null });
      return { ok: true, values: nextValues };
    },
    [activeKeyRef, patchSession, values],
  );
  return { applyJsonValues };
}
