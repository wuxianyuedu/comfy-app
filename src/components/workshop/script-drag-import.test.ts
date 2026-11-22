/* 剧本拖拽导入的接线守卫（#4827，按源码读不做渲染；先例：workshop-stage-chunk-recovery）。
 * 判纯结构事实：① 剧本页挂的是共享漏斗 useDropZone（经 use-script-import 子 hook），
 * 不许再长第二套拖拽实现；② 「导入剧本」按钮与拖拽走**同一条**文件漏斗
 *（handleScriptFile）—— 语义分叉会让「拖进来」与「按钮导入」长成两种行为；
 * ③ 漏斗带扩展名守卫（非 .md/.txt 不覆盖）；④ 拖拽高亮沿工作流库投放区的
 * 既有形状（outline + 文档流内提示条，不造覆盖层）。#4834 后漏斗收进
 * hooks/use-script-import.ts（WorkshopStageBody 主函数长度硬闸），两份源一起判。 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../tests/helpers/strip-comments";

function readSource(rel: string): string {
  return stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
}

const stage = readSource("WorkshopStageBody.tsx");
const funnel = readSource("hooks/use-script-import.ts");

describe("剧本页的拖拽导入接线（#4827）", () => {
  it("投放区接的是共享漏斗 useDropZone，不是第二套拖拽实现", () => {
    expect(funnel).toContain('from "~/components/ui/use-drop-zone"');
    expect(funnel).toContain("useDropZone(handleScriptFile, showNotice)");
    expect(stage).toContain("useScriptImport(");
  });

  it("「导入剧本」按钮与拖拽走同一个文件漏斗（onPick 与 onFile 同源）", () => {
    expect(funnel).toContain("const handleScriptFile");
    expect(funnel).toContain("onPick: handleScriptFile");
    expect(stage).toContain("scriptPicker.open");
  });

  it("漏斗带扩展名守卫：非 .md/.txt 不覆盖剧本", () => {
    expect(funnel).toContain(String.raw`/\.(?:md|txt)$/i`);
    expect(funnel).toContain("已保留当前剧本");
  });

  it("拖拽高亮沿工作流库投放区的既有形状：outline 高亮 + 文档流内提示条，不造覆盖层", () => {
    expect(stage).toContain("outline-info/60 outline-2 -outline-offset-2");
    expect(stage).toContain("松开导入剧本");
    /* 绝对定位覆盖层在这里没有对象 —— overlay-z 刻度（§16.2.5）与空态卡判据
     *（P75：border-dashed + rounded 组合）都会把它当新增违规拦下（PR #4831
     * 的 CI 实测红过一次），既有投放区（WorkflowLibraryList）也是提示条形状。 */
    expect(stage).not.toContain("absolute inset-0");
    expect(stage).not.toContain("border-dashed");
  });
});
