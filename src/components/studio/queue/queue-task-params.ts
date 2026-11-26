// ── 队列任务 · 输入参数表的纯派生（第①层，规范 17 §17.1：删掉 JSX 仍能跑测试）──
// 「测试模型」页的生成队列总览里，展开一条任务看它提交时的输入参数。
// 数据源是 tRPC `task.detail`（全量行，含 params JSON 列）；这里只做
// 「unknown 形状 → 可渲染的键值行」，不发请求、不碰 React。

import { asRecord } from "~/lib/is-record";
import type { RouterOutputs } from "~/trpc/react";

/** task.detail 的返回形状（含 params JSON 列与 modelName 派生列）。 */
export type QueueTaskDetail = RouterOutputs["task"]["detail"];

/** 派生的入参形状：只声明本模块真正读取的字段（task.detail 结构可赋值给它），
 * 测试夹具不必拼出整行任务。 */
export type QueueTaskParamsSource = {
  modelName?: string | null;
  params: unknown;
  prompt?: string | null;
  workflowName?: string | null;
};

/** 参数表的一行：label 是给用户看的名字，value 已收成可显示的字符串。 */
export type QueueTaskParamRow = { label: string; value: string };

/** 认得的键给中文名；不认识的键原样回显（与 taskStatusLabel 同一口径）。 */
const PARAM_LABELS: Record<string, string> = {
  aspectRatio: "比例",
  checkpoint: "检查点",
  duration: "时长",
  firstFrame: "首帧",
  fps: "帧率",
  frames: "帧数",
  image: "图片",
  inputImage: "输入图",
  lastFrame: "尾帧",
  megapixels: "百万像素",
  model: "模型",
  multiple: "倍数",
  negative: "负向提示词",
  negativePrompt: "负向提示词",
  prompt: "提示词",
  referenceImages: "参考图",
  resolution: "分辨率",
  seed: "种子",
  size: "尺寸",
};

/**
 * 这些键不进参数表：内部归属 / 落点配置 / 调试面，不是「用户提交了什么」。
 * `workflow`（模板 id）由「工作流」一行用名字表达；`paramMap` 是作者画的
 * 落点映射（配置，不是值）；`workflowInputs` 在下面逐条展开成行。
 */
const INTERNAL_PARAM_KEYS: ReadonlySet<string> = new Set([
  "debug",
  "outputNodeIds",
  "paramMap",
  "parentId",
  "projectId",
  "referenceLoaderPlan",
  "shotId",
  "workflow",
  "workflowInputs",
]);

/** 值 → 显示文本；`null` = 这一格不摆（空串 / 空数组不假装有内容）。 */
function paramValueText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") {
      return null;
    }
    /* 参数表是核对「提交了什么」的出口，长提示词 / 工坊参数原样保留，交给
     * 视图换行展示（#5074：截断后用户看不见完整内容）。 */
    return text;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return null;
    }
    return paramValueText(value.join("、"));
  }
  if (typeof value === "object") {
    return paramValueText(JSON.stringify(value));
  }
  return null;
}

function paramLabel(key: string): string {
  return PARAM_LABELS[key] ?? key;
}

/**
 * 一条任务的「输入参数」行序：
 *  1. 身份三行 —— 提示词 / 模型 / 工作流（来自行字段与派生列，模型名以
 *     工作流上挂的模型标签为权威，缺失时回落 params.checkpoint）；
 *  2. `params.workflowInputs` 逐条（执行期真正下发的对外参数值）；
 *  3. params 其余标量键（不同通道的顶层字段，如 frames / referenceImages）。
 * 同名只留首行（workflowInputs 里的 prompt 与顶层 prompt 是同一个值）。
 */
export function queueTaskParamRows(detail: QueueTaskParamsSource): Array<QueueTaskParamRow> {
  const rows: Array<QueueTaskParamRow> = [];
  const seen = new Set<string>();
  const push = (label: string, value: unknown) => {
    const text = paramValueText(value);
    if (text === null || seen.has(label)) {
      return;
    }
    seen.add(label);
    rows.push({ label, value: text });
  };

  const params = asRecord(detail.params) ?? {};
  push("提示词", detail.prompt);
  push("模型", detail.modelName ?? params.checkpoint);
  push("工作流", detail.workflowName);

  const inputs = Array.isArray(params.workflowInputs) ? params.workflowInputs : [];
  for (const entry of inputs) {
    const record = asRecord(entry);
    if (record === null || typeof record.name !== "string" || record.name === "") {
      continue;
    }
    push(paramLabel(record.name), record.value);
  }
  for (const [key, value] of Object.entries(params)) {
    if (INTERNAL_PARAM_KEYS.has(key)) {
      continue;
    }
    push(paramLabel(key), value);
  }
  return rows;
}
