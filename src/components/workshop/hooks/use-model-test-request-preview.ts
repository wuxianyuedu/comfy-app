"use client";

// ── 测试模型 · 生成前的「准备请求」读数子 hook（#3949 需求 8）──────────
// 按当前 模式 / 模型 / 输入 走服务端 dry-run 现算**实际上游请求**（端点 +
// 适配器翻译后的请求体）。工作流候选（#4080 评论 4）跳过 —— dry-run 是
// API 中继的预演，本地通道没有这一步。从 useModelTest 拆出（§12.13：主
// hook 越过文件长度硬闸，按职责拆子 hook；600ms 去抖 + 序号守卫与
// 卸载判活的口径随实现整体搬走，一字未改）。

/** 生成前的「准备请求」读数子 hook（#3949 需求 8）：按当前 模式 / 模型 / 输入
 *  走服务端 dry-run 现算**实际上游请求**（端点 + 适配器翻译后的请求体）。
 *  工作流候选（#4080 评论 4）跳过 —— dry-run 是 API 中继的预演，本地通道
 *  没有这一步。600ms 去抖 + 序号守卫：慢响应不覆盖新一轮的读数。
 *  实际请求行落在**当前格**的会话里；生成中不清空、不重算 —— 该格的
 *  「实际请求」在请求中与生成后都保持可见（#4080 评论 20）。 */
import { useEffect, useRef } from "react";

import { runAsyncAction } from "~/lib/async-action";
import { apiPreviewRequest } from "~/lib/workshop/generation-client";

import type { buildRequestBodies, ModelTestKind, ModelTestValues } from "../model-test-config";
import type { ModelTestSession } from "./use-model-test-generate";

export function useRequestPreview(args: {
  buildBodies: (values: ModelTestValues) => ReturnType<typeof buildRequestBodies>;
  busy: boolean;
  kind: ModelTestKind;
  onError: (text: string) => void;
  patchSession: (key: string, patch: Partial<ModelTestSession>) => void;
  selectedModel: string;
  sessionKey: string;
  skip: boolean;
  values: ModelTestValues;
}): void {
  const {
    busy,
    buildBodies,
    kind,
    onError,
    patchSession,
    selectedModel,
    sessionKey,
    skip,
    values,
  } = args;
  const seqRef = useRef(0);
  /* 卸载判活（ISSUE #4288）：防抖窗口过后组件可能已卸载，在途请求回来
   * 不再写父级 state（seq 只防连发竞态，不防「卸载后写」）。 */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (kind === "chat" || skip || selectedModel === "") {
        patchSession(sessionKey, { previewRows: [] });
        return;
      }
      if (busy) {
        /* 生成中保留该格已算出的「实际请求」行：不清空、不重算 —— 此时的
         * 表单改动属于下一次测试（#4080 评论 20）。 */
        return;
      }
      const seq = ++seqRef.current;
      const { imageBody, videoBody } = buildBodies(values);
      const relayBody = imageBody ?? videoBody ?? {};
      void runAsyncAction(
        async () => {
          const rows = await apiPreviewRequest(relayBody, kind);
          if (!Array.isArray(rows)) {
            return { ok: true as const };
          }
          if (aliveRef.current && seqRef.current === seq) {
            patchSession(sessionKey, { previewRows: rows });
          }
          return { ok: true as const };
        },
        {
          report: (kind, text) => {
            if (kind === "err") {
              onError(text);
            }
          },
          failureText: "请求预览失败",
        },
      );
    }, 600);
    return () => {
      clearTimeout(timer);
    };
  }, [busy, buildBodies, onError, selectedModel, kind, skip, sessionKey, patchSession, values]);
}
