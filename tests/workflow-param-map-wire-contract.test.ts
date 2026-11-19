/**
 * `paramMap` 那一列的线上契约（台账 E4 第六格，ISSUE #2171 第二档）：写边界与读边界对同一枚合法条目必须同读数，而「该不同的那一半」要钉住分界；形状与 #2160（远端模型条目「读边界 ⇄ 入参判据同读数」）同族。
 * ① 同读数：合法条目（两键空间 + 一枚历史命名空间）过 `workflowParamMapInputSchema` 再经 `parseWorkflowParamMap`，字段一层都不许变。② 该不同的那一半：库里一行脏值（表里嵌对象）时写边界原样透传（剥键 = 静默删作者数据），读边界把整列折成 `null` —— 并成一份时红在这里。
 * 这里不测库往返（由 `workflow.update` 仓储用例管），只把两侧真判据串起来跑，判两份声明是不是同一件事的两面。
 */
import { describe, expect, it } from "vitest";

import {
  parseWorkflowParamMap,
  workflowParamMapInputSchema,
} from "~/lib/workflow/workflow-param-map";

/** 过**写边界**（tRPC 入参那一半）：真判据，不是我以为它收成什么样。 */
function throughInput(value: unknown): unknown {
  const parsed = workflowParamMapInputSchema.safeParse(value);
  expect(parsed.success, `入参判据当场拒了：${String(parsed.error)}`).toBe(true);
  return parsed.success ? parsed.data : undefined;
}

describe("paramMap 写边界 ⇄ 读边界：同一枚合法条目同读数（§E4）", () => {
  it("两个键空间 + 一枚历史命名空间，过完两侧字段一个不多一个不少", () => {
    const authorEntry = {
      source: { "mode:T2I": { prompt: "1::widget::text", negative: null } },
      output: { "mode:T2I": { images: "5::output::IMAGE" } },
      positiveNode: "4",
    };
    const written = throughInput(authorEntry);
    const read = parseWorkflowParamMap(written);
    /* 直接比**同一枚对象**：写侧原样透传、读侧 `.loose()` 留住不认识的键，
     * 于是两侧对「合法」的认法必须一致。少一根字段、多剥一枚键，都在这里红 ——
     * 而不是等到运行期派不出值才发现（那才是用户看得见的故障）。 */
    expect(read).toEqual(authorEntry);
    /* 「整列折成 null」与「收下了」是两种世界：这条必须是后者，否则上面那句
     * 会被 `null` 之外的任何东西巧合满足（`toEqual` 对 `null` 不会绿，这一行是把话说明白）。 */
    expect(read).not.toBeNull();
  });

  it("顶层不是对象（数组 / 数字）⇒ 两侧都落「这次没有内容」，且都不抛", () => {
    /* 写侧不许抛：那会把「客户端多传了一个字段」升级成整次保存失败（文件头那条理由）；
     * 读侧给 `null`：调用方据此区分「这一列是空的」与「压根没有」。两侧结论同形。 */
    for (const value of [["mode:T2I"], 42, "source"]) {
      expect(throughInput(value), `写侧对 ${JSON.stringify(value)} 抛了`).toBeNull();
      expect(parseWorkflowParamMap(value)).toBeNull();
    }
  });

  it("`undefined` / `null` 两侧各自的意义：不写这一列 ⇄ 这一列没有内容", () => {
    /* 这一格看着细，但它是「同读数」定义的一部分：写侧 `undefined` = 这次不动这一列，
     * 读侧 `null` = 库里没有。两者**不该**相等 —— 判反了就会把「不动」写成「清空」。 */
    for (const value of [undefined, null]) {
      expect(throughInput(value), `写侧该把 ${String(value)} 当「不写」`).toBeUndefined();
      expect(parseWorkflowParamMap(value)).toBeNull();
    }
  });

  it("库里一行脏值（表里嵌对象）⇒ 写侧原样透传、读侧整列 null（这是分界，不是漏判）", () => {
    const dirty = {
      source: { "mode:T2I": { prompt: { nested: "不是 string 也不是 null" } } },
      positiveNode: "4",
    };
    /* 写侧**不收窄**：这一列是多命名空间共用的扩展点，剥键 = 静默删作者数据，
     * 所以脏值也要原样传下去（历史写坏的那一行不能由写入路径替作者决定删什么）。 */
    expect(throughInput(dirty)).toEqual(dirty);
    /* 读侧**整列折 null**：不是空表、也不是只丢那一枚键 —— 界面据此显示「未配置」，
     * 这比「看得见却派不出值」的那种半态可观测得多。 */
    expect(parseWorkflowParamMap(dirty)).toBeNull();
    /* 反证「并成一份」会坏在哪：两侧对同一枚脏值的回答**必须相反**（上面那两行）。
     * 哪天把它并成一份判据，那两行里必有一行站不住 —— 这里的差异是设计，不是没对齐的漏。 */
  });
});
