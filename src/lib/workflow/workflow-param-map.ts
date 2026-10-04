/* ── `paramMap` JSON 列的**权威形状**（类型 + zod schema，纯模块）──
 *
 * 这一列此前只有一份**猜测**：视图侧 `WorkflowRow.paramMap` 声明成
 * `Record<string, string> | null`（「一层 key → string」），而库里真实落的是
 * 按模式归拢的三层结构；没有一处消费点按那个声明读，于是「声明与运行时不符」
 * 一直靠双跳断言（`as unknown as …`）抹平 —— 兼容性检查一并被丢掉，字段改名
 * 不会红、只会渲染成 `undefined`。
 *
 * 本模块是这一列的**唯一权威类型**：路由入参（`workflow.list` / `workflow.update`
 * / `generate`）与视图声明（`WorkflowRow.paramMap`）都 import 它，不再各写一份。
 *
 * 形状（键空间分开、互不干扰）：
 *   · `source`  —— **运行期**载荷覆盖表（作者画的「对外参数 → 节点端口」连线）。
 *     键 `mode:<模式>` → `{ <entryId>: ioKey | null }`；`null` = 作者显式断开。
 *   · `output`  —— **视图层**输出取值行的选取。与 `source` 同构，但键空间分开：
 *     混在同一张表里，运行期会把一个输出 ioKey 当成输入覆盖去查（见
 *     `workflow-output-binding` 的文件头）。
 *   · 其余键（`positiveNode` 等历史命名空间）**原样保留**：本轮只给已经确定的
 *     两处键空间定档，不认识的键一律 `.loose()` 放过 —— 收窄它们会静默剥键。
 *
 * 为什么 schema 用 `.loose()` 而不是逐字穷举：这个列是**多命名空间共用**的扩展点，
 * 穷举会让「新增一个命名空间」变成「别处先改 schema」的顺序依赖；而这里要挡的
 * 是**形状**（不是对象 / 数组 / 值不是 string|null），不是「认不认识这个键」。
 */

import { z } from "zod";

import { isPlainRecord } from "~/lib/is-record";

/** 一个命名空间内、某个模式下的覆盖表：`{ <键>: <落点> | null }`。
 *  有一个值不是 `string` / `null` 就整表不收（`z.record` 判的是整份值，
 *  不是逐键丢）—— 脏数据落到 `null`，由调用方按「这一列没有内容」处理。 */
const modeTableSchema = z.record(z.string(), z.union([z.string(), z.null()]));

/** `source` / `output` 两个键空间共用的形状：`{ <mode:<模式>>: { … } }`。
 *
 *  键形如 `mode:T2I`；其余键（无 `mode:` 前缀的历史通用线）由
 *  `parseParamMapping` 在读边界丢弃 —— 它们在当前模型里没有生效语境。
 *  这里只判「值是不是一张 键 → 落点 的表」，不判键前缀（那是读边界的职责，
 *  两处各写一份判据正是要消掉的东西）。 */
const modeTableNamespaceSchema = z.record(z.string(), modeTableSchema);

export const workflowParamMapSchema = z.looseObject({
  /** 作者画的输入落点线（运行期据此派值）。 */
  source: modeTableNamespaceSchema.optional(),
  /** 作者改过的输出取值行（纯视图层选取，无运行期语义）。 */
  output: modeTableNamespaceSchema.optional(),
});

/** `paramMap` JSON 列的权威类型。
 *
 *  `source` / `output` 之外允许任意键：那是历史命名空间（`positiveNode`…），
 *  本轮不定它们的档，也不许把它们剥掉（写入路径一律原样透传）。 */
export type WorkflowParamMap = z.infer<typeof workflowParamMapSchema> &
  Record<string, unknown>;

/** `paramMap` 列的**读边界**：解析成权威类型；不是对象 / 形状不符 → `null`。
 *
 *  为什么读边界给 `null` 而不是 `{}`：调用方（视图声明 `paramMap?: T | null`）
 *  区分「这一列是空的」与「这一列压根没有」，落库写入路径也据此决定写不写。
 *  与 `parseWorkflowIOMap` 的「畸形 → 空表」刻意不同 —— 那一处下游按空表
 *  渲染，这一处下游要把空值原样传回去。 */
export function parseWorkflowParamMap(value: unknown): WorkflowParamMap | null {
  if (value === null || value === undefined) return null;
  const parsed = workflowParamMapSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}

/** 给 tRPC 入参用的 schema（三条路由共用；`undefined` / `null` = 这次不写这一列）。
 *
 *  **刻意比读边界宽**：入参只要「是对象或空」，**不按认得的键空间收窄** ——
 *  写入路径的判据是「原样透传」，把不认识的命名空间剥掉就等于静默删作者数据。
 *  这一列是多命名空间共用的扩展点，收窄它的时机在读（`parseWorkflowParamMap`
 *  与 `parseParamMapping`），不在写。
 *
 *  顶层不是对象（数字 / 字符串 / 数组）仍按 `null` 收，不抛：那在**写**这一侧
 *  等于「这次没有内容可写」，而不是让一次 PATCH 直接 400 —— 后者会把
 *  「客户端多传了一个字段」升级成「整次保存失败」，而用户看到的是保存按钮
 *  没反应。真正的形状判据在读边界，那里失效是可观测的（界面显示「未配置」）。 */
export const workflowParamMapInputSchema = z
  .unknown()
  .optional()
  .transform((value) => {
    if (value === undefined || value === null) return undefined;
    /* 顶层形状复用 `~/lib/is-record`（P48 硬闸：`unknown` → 宽松对象视图只有
     *  那一处口径），不再写第二份 `typeof === "object" && !Array.isArray`。 */
    return isPlainRecord(value) ? value : null;
  });
