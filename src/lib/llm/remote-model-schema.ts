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
// 返回结构刻意是「字段 → 第一条错误文案」，与规范 16 §16.2.4.26 的
// 表单校验同口径（视图只渲染文案，不参与判定）。

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

/**
 * 远端模型的**线上 / 存储条目**形状：`extraModels` 数组里那一枚对象。
 *
 * 它是 `src/server/api/routers/llm.ts` 的 `configSave` 入参的一部分（服务端只是消费方），
 * 也是 `~/lib/llm/types.ts` 里 `RemoteModelEntry` 的写侧形状 —— 此前这两件事在路由里
 * 各写一遍，其中 `kind` 是一条**行内字面量枚举** `["chat","image","video"]`，与本模块
 * 从 `REMOTE_MODEL_KINDS` 派生的那一份是两个独立真相：往词表里加一种用途（如 `audio`）
 * 之后，弹窗能选、条目能存，而服务端入参那一条 zod 直接拒 —— 表现是设置页保存时一句
 * 英文 zod 原文，且 tsc / eslint / 单测全绿（两份枚举在类型上各自自洽）。
 * 现在两边取同一个 `z.enum(REMOTE_MODEL_KINDS)`。
 *
 * `hasApiKey` **不在这里**：它是 `getConfigForClient` 下发的只读视图字段（明文密钥
 * 一律不落客户端，台账 A4），条目回写时带着它也只是被 zod 剥掉 —— 把它写进入参形状
 * 等于允许客户端替服务端宣布「这条存过密钥」。
 */
export const remoteModelEntrySchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().nullish(),
  /** 三态由调用点决定「省略键」还是「写 null」（口径见 `~/lib/llm/types` 的 A11 那段）。 */
  apiKey: z.string().nullish(),
  kind: z.enum(REMOTE_MODEL_KINDS).nullish(),
});

/**
 * 弹窗草稿 → 条目字段。`model` → `name` 这一跳**只在这里**。
 *
 * 为什么值得抽出来：这一跳过去在 `submitDialog()` 里写了两遍（新增与编辑各一遍），
 * 而它连的是两个各有名字的形状 —— 草稿叫 `model`（历史上也叫 `name`），条目叫 `name`；
 * 改名或加字段时两边各改各的，中间没有任何东西知道它们该是同一枚模型。
 *
 * 留空的两条既有口径都在返回值里说清，调用点不再各自拼：
 *   · `baseUrl` 空白 → `null`：新增与编辑在这一条上**本来就同形**（写入侧都折成
 *     「跟随已保存的全局配置」），过去一边写 `undefined`、一边写 `null` 只是写法不同；
 *   · `apiKey` 空白 → 这一项**不给意见**（`undefined`，于是写入侧保留库里既有值）。
 *     它不能折成 `null`：两态写法会让「没动过」被读成「清空密钥」，而设置页每次保存
 *     都是整份覆盖（三态的理由见 `~/lib/llm/types` 里 `RemoteModelEntry` 那段，台账 A11）。
 *     显式清空由编辑侧的 `clearApiKey` 表达，它不在这里 —— 那是勾选框的意图，
 *     不是草稿字段能算出来的事。
 */
export interface RemoteModelDraftEntry {
  /** `undefined` = 这次不给意见（保留库里既有），不是「清空」。 */
  apiKey?: string;
  baseUrl?: string | null;
  /** 仅编辑侧有意义：清掉这条的独立密钥。 */
  clearApiKey?: boolean;
  /** `null` 只在编辑侧有意义：清掉用途这一档（草稿桥接出来的一定是具体值）。 */
  kind?: RemoteModelKind | null;
  name: string;
}

export function remoteModelEntryFromDraft(draft: RemoteModelFieldValues): RemoteModelDraftEntry {
  const baseUrl = draft.baseUrl.trim();
  const apiKey = draft.apiKey.trim();
  return {
    name: draft.model.trim(),
    baseUrl: baseUrl === "" ? null : baseUrl,
    apiKey: apiKey === "" ? undefined : apiKey,
    kind: draft.kind,
  };
}

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
  if (parsed.success) {
    return {};
  }
  const out: Partial<Record<keyof RemoteModelFieldValues, string>> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string") {
      continue;
    }
    if (out[/* SAFETY: 类型断言已复核 */ key as keyof RemoteModelFieldValues]) {
      continue;
    }
    out[/* SAFETY: 类型断言已复核 */ key as keyof RemoteModelFieldValues] = issue.message;
  }
  return out;
}

function isKind(value: unknown): value is RemoteModelKind {
  return (
    typeof value === "string" &&
    /* SAFETY: 类型断言已复核 */ (REMOTE_MODEL_KINDS as ReadonlyArray<string>).includes(value)
  );
}
