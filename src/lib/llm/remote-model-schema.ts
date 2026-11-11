// ── 远端模型**条目**的线上契约形状（`configSave` 入参与写侧类型共用）──
//
// 这份形状的守护方式是 `tests/remote-model-entry-wire-contract.test.ts`：真草稿经
// 真桥（`remoteModelEntryFromDraft`）产出条目，被真 router 的 zod 收下并原样回读 ——
// 「草稿叫 model / 条目叫 name / 服务端 kind 枚举」三处名字由同一份派生钉住。
//
// 字段级**表单校验规则**不在这里：供应商级重构（#3514）后它们住在
// `~/lib/llm/provider-form`（`validateProviderForm` / `validateModelForm`），
// 归属判据见 `tests/ui-primitives-coverage.test.ts` 与规范 16 §16.2.4.8（#3566）。

import { z } from "zod";

import { REMOTE_MODEL_KINDS, type RemoteModelKind } from "./types";

/** 弹窗草稿的字段形状（`remoteModelEntryFromDraft` 的入参）。`model` 是模型名
 *  （历史上也叫 name），`kind` 由调用方回落 `chat` —— 与「未选 = 对话」的既有
 *  行为一致；`baseUrl` / `apiKey` 可留空（回落全局配置）。
 *
 *  只剩**类型**职责：字段级**校验规则**已随供应商级重构迁往 `~/lib/llm/provider-form`
 *  （`validateProviderForm` / `validateModelForm`，#3514），本模块不再做运行期判定；
 *  旧的 `remoteModelFieldSchema`（zod 对象）与 `validateRemoteModelFields` 随之摘除
 *  —— 生产与测试都零消费，留在历史里即可考古（#3566）。 */
export type RemoteModelDraft = {
  apiKey: string;
  baseUrl: string;
  kind: RemoteModelKind;
  model: string;
};

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
export type RemoteModelDraftEntry = {
  /** `undefined` = 这次不给意见（保留库里既有），不是「清空」。 */
  apiKey?: string;
  baseUrl?: string | null;
  /** 仅编辑侧有意义：清掉这条的独立密钥。 */
  clearApiKey?: boolean;
  /** `null` 只在编辑侧有意义：清掉用途这一档（草稿桥接出来的一定是具体值）。 */
  kind?: RemoteModelKind | null;
  name: string;
};

export function remoteModelEntryFromDraft(draft: RemoteModelDraft): RemoteModelDraftEntry {
  const baseUrl = draft.baseUrl.trim();
  const apiKey = draft.apiKey.trim();
  return {
    name: draft.model.trim(),
    baseUrl: baseUrl === "" ? null : baseUrl,
    apiKey: apiKey === "" ? undefined : apiKey,
    kind: draft.kind,
  };
}
