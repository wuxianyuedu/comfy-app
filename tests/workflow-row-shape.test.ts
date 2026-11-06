/**
 * 「工作流库行声明与服务端返回形状一致」——视图声明不许靠双跳断言抹平（ISSUE #1460）。`WorkflowRow` 与 `workflow.list`
 * payload 各自演化，漂移靠 `as unknown as WorkflowRow[]` 抹平，而双跳断言把「字段名与类型逐项对上」也一起丢掉
 * （改字段名不红，渲染时静默 `undefined`）。三判据：①类型层——`WorkflowListRow`（形状唯一出处）赋给 `WorkflowRow`，
 * 不兼容则**编译不过**；②事实层——`createdAt` 是 `Date`、`source` 三档联合、`paramMap` 可 `null`；③接线层——hook 落 state 无断言。 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "./helpers/strip-comments";

import type { WorkflowListRow } from "~/lib/workflow/workflow-list-types";
import type { WorkflowRow } from "~/components/studio/workflow-library/workflow-library-config";
import type { WorkflowParamMap } from "~/lib/workflow/workflow-param-map";

const ROOT = path.resolve(__dirname, "..");
const CONFIG = "src/components/studio/workflow-library/workflow-library-config.ts";
const LIST_HOOK = "src/components/studio/workflow-library/hooks/use-workflow-library.ts";
const ROUTE = "src/server/api/routers/workflow-list.ts";

function readSource(rel: string): string {
  return stripComments(readFileSync(path.join(ROOT, rel), "utf8"));
}

/* ── ① 类型层：视图声明必须接得住服务端行（编译期判据）──
 *
 * 这一句把「服务端行 → 视图行」的兼容性交回编译器：类型不兼容时**本文件编译不过**。写成赋给 `WorkflowRow`
 * 而不是反过来，是因为视图声明是**子集**：服务端多给的列（positions 等）视图不读允许，少给 / 类型错才拦。 */
function typeLevelSubsetCheck(row: WorkflowListRow): WorkflowRow {
  /* 不加任何断言：服务端行直接当视图行用。类型不兼容时**这里编译不过** ——
   * 这句就是判据① 本体，函数不需要被调用。 */
  return row;
}
void typeLevelSubsetCheck;

/** ② 的编译期半边：`paramMap` 的权威类型必须是三层结构 —— 视图声明的
 *  `paramMap` 能接住 `{ source: { "mode:T2I": { prompt: "1::text" } } }`。 */
const _paramMapShape: WorkflowParamMap = {
  source: { "mode:T2I": { prompt: "1::text", negative: null } },
  output: { "mode:T2I": { images: "5::output::IMAGE" } },
};
void _paramMapShape;

describe("工作流库行形状：视图声明与服务端一致（ISSUE #1460）", () => {
  it("视图 hook 落 state 时不再有双跳断言", () => {
    const code = readSource(LIST_HOOK);
    expect(code).toContain("setWorkflows(listQ.data.workflows ?? []);");
    /* `as unknown as WorkflowRow` / `as WorkflowRow[]`（及切泛形后的
     * `Array<WorkflowRow>` 写法）都不许出现 —— 单跳断言同样是「这里别查我」，
     * 只是少了一次 `unknown` 洗白。 */
    expect(code).not.toMatch(/as\s+(?:unknown\s+as\s+)?(?:WorkflowRow\[\]|Array<WorkflowRow>)/);
  });

  it("`createdAt` 声明为 Date（superjson 过线保真，不是 ISO 串）", () => {
    const code = readSource(CONFIG);
    expect(code).toMatch(/createdAt:\s*Date;/);
    expect(code).not.toMatch(/createdAt:\s*string;/);
    /* 服务端侧：占位行与已导入行**同一形状**，不许一处 Date 一处 ISO 串。 */
    const route = readSource(ROUTE);
    expect(route).not.toContain(".toISOString()");
  });

  it("`source` 是三档联合（占位行的 local-pending 在列）", () => {
    const code = readSource(CONFIG);
    expect(code).toMatch(/"local"\s*\|\s*"online"\s*\|\s*"local-pending"/);
  });

  it("`paramMap` 走权威类型，不再是一层 key → string", () => {
    const code = readSource(CONFIG);
    expect(code).toMatch(/paramMap\?:\s*WorkflowParamMap\s*\|\s*null;/);
    expect(code).not.toMatch(/paramMap\?:\s*Record<string,\s*string>/);
  });

  it("服务端出口按共用行类型声明，不靠对象字面量推宽", () => {
    const route = readSource(ROUTE);
    /* 泛形（`Array<WorkflowListRow>`）是 oxlint array-type 切 generic 后的仓内
       唯一口径（#2685 预设 default:"generic"）；旧 `WorkflowListRow[]` 形态
       反而不许回潮。 */
    expect(route).toContain("const enriched: Array<WorkflowListRow>");
    expect(route).not.toContain("WorkflowListRow[]");
  });
});
