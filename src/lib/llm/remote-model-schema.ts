// ── 远端模型表单的字段规则（规范 16 §16.2.4.6 第二档的落地口径）──
//
// 为什么规则住在这里、而不是住在弹窗视图或 `ui/form` 的 RHF 里：
//
//   1. §16.2.1 规定 controller hook 是**唯一数据出入口**。`ui/form` 是 RHF 的
//      `FormProvider`，用上它就等于同一个草稿有了两个持有者（hook 的 state
//      与 RHF 的 store），提交前还得对账。所以 RHF 不进业务表单，见 §16.2.4.8。
//   2. 字段级规则是**纯函数**（只依赖该字段自己的值），可以放这里单测；
//      跨条目规则（重名查重）依赖 `extraModels` 列表 —— 那是**集合级**规则，
//      留在 controller 里，与列表同生共死。
//
// 返回结构刻意是「字段 → 第一条错误文案」，与既有的 `validateTrainForm`
// 同口径（视图只渲染文案，不参与判定）。

import { z } from "zod";

import { REMOTE_MODEL_KINDS, type RemoteModelKind } from "./types";

/** 弹窗草稿的字段级 schema。`model` 是模型名（历史上也叫 name），
 *  `kind` 回落 `chat`（对话）—— 与「未选 = 对话」的既有行为一致。 */
export const remoteModelFieldSchema = z.object({
  model: z.string().trim().min(1, "请填写模型名称"),
  /* 接口地址与 API Key 都是「可留空回落全局」，所以默认空串而不是必填 ——
     把它们留成 `z.string()` 会让「只给 model」的调用方直接抛错，
     那正是字段级规则与表单形态脱节的信号。 */
  baseUrl: z.string().default(""),
  apiKey: z.string().default(""),
  kind: z.enum(REMOTE_MODEL_KINDS).default("chat"),
});

export type RemoteModelFieldValues = z.infer<typeof remoteModelFieldSchema>;

/** 逐字段的第一条错误（键 = 字段名）。空对象 = 字段级全通过。
 *
 *  只做字段级判定：`model` 是否与既有条目重名、编辑态条目是否还存在 ——
 *  那两条要看列表，由 controller 的 `addRemoteModel` / `updateRemoteModel`
 *  负责（它们本来就在那里返回 `{ ok, error }`）。 */
export function validateRemoteModelFields(
  values: Partial<Record<keyof RemoteModelFieldValues, unknown>>,
): Partial<Record<keyof RemoteModelFieldValues, string>> {
  const parsed = remoteModelFieldSchema.safeParse({
    model: typeof values.model === "string" ? values.model : "",
    baseUrl: typeof values.baseUrl === "string" ? values.baseUrl : "",
    apiKey: typeof values.apiKey === "string" ? values.apiKey : "",
    kind: isKind(values.kind) ? values.kind : "chat",
  });
  if (parsed.success) return {};
  const out: Partial<Record<keyof RemoteModelFieldValues, string>> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string") continue;
    if (out[key as keyof RemoteModelFieldValues]) continue;
    out[key as keyof RemoteModelFieldValues] = issue.message;
  }
  return out;
}

function isKind(value: unknown): value is RemoteModelKind {
  return (
    typeof value === "string" &&
    (REMOTE_MODEL_KINDS as readonly string[]).includes(value)
  );
}
