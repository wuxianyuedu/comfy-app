/**
 * 「工作流库行声明与服务端返回形状一致」——视图声明不许靠双跳断言抹平（ISSUE #1460）。
 *
 * 起因：`WorkflowRow`（视图声明）与服务端 `workflow.list` 的 payload 是**两份
 * 各自演化的声明**，漂移靠 `as unknown as WorkflowRow[]` 抹平。而双跳断言把
 * 「字段名与类型逐项对上」这项检查**也一起丢掉**：服务端改字段名不会红，只会
 * 在渲染时静默变 `undefined`。同族错配（`ModelRow.createdAt`）已在上一批修掉。
 *
 * 三条判据，缺一条那个症状就会回来：
 *   ① **类型层**：`WorkflowRow` 必须能无断言地接住服务端行 —— 由
 *      `WorkflowListRow`（`src/lib/workflow/workflow-list-types`，形状的唯一出处）
 *      赋给 `WorkflowRow` 的那句标注来判；类型不对这里**编译不过**，
 *      而不是「运行时才发现」。
 *   ② **事实层**：三处已实测的错配不许回潮 —— `createdAt` 是 `Date`（superjson
 *      过线保真，不是 ISO 串）、`source` 是**三档**联合（占位行的
 *      `"local-pending"` 在列）、`paramMap` 是 `WorkflowParamMap | null`
 *      （不是「一层 key → string」）。
 *   ③ **接线层**：视图 hook 落本地 state 时**不再有断言**；有断言 = 判据①
 *      被关掉了（那句 `as unknown as …` 就是「这里别查我」）。
 *
 * 已知边界：本判据管形状，不管语义 —— 「服务端是不是真的这么填值」由
 * `workflow.list` 自己的用例与渲染用例负责。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "./helpers/strip-comments";

import type { WorkflowListRow } from "~/lib/workflow/workflow-list-types";
import type { WorkflowRow } from "~/components/studio/workflow-library/workflow-library-config";
import type { WorkflowParamMap } from "~/lib/workflow/workflow-param-map";

const ROOT = path.resolve(__dirname, "..");
const CONFIG =
  "src/components/studio/workflow-library/workflow-library-config.ts";
const LIST_HOOK =
  "src/components/studio/workflow-library/hooks/use-workflow-library.ts";
const ROUTE = "src/server/api/routers/workflow-list.ts";

function readSource(rel: string): string {
  return stripComments(readFileSync(path.join(ROOT, rel), "utf-8"));
}

/* ── ① 类型层：视图声明必须接得住服务端行（编译期判据）──
 *
 * 这一句是整个判据的核心：它把「服务端行 → 视图行」这条兼容性交回给编译器。
 * 类型不兼容时**这个文件编译不过**，而不是等人去读代码时才发现。
 * 之所以写成赋给 `WorkflowRow`（而不是反过来），是因为视图声明是**子集**：
 * 服务端多给的列（positions 等）视图不读，那是允许的；服务端少给 / 给错类型
 * 才是要拦的。 */
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
    /* `as unknown as WorkflowRow` / `as WorkflowRow[]` 都不许出现 —— 单跳断言
     * 同样是「这里别查我」，只是少了一次 `unknown` 洗白。 */
    expect(code).not.toMatch(/as\s+(unknown\s+as\s+)?WorkflowRow\[\]/);
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
    expect(route).toContain("const enriched: WorkflowListRow[]");
  });
});
