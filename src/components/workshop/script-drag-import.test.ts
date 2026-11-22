/* 剧本拖拽导入的接线守卫（#4827，按源码读不做渲染；先例：workshop-stage-chunk-recovery）。
 * 判纯结构事实：① 投放区接共享漏斗 useDropZone，不许再长第二套拖拽实现；
 * ② 「导入剧本」按钮与拖拽走**同一条**文件漏斗（handleScriptFile）—— 语义分叉会让
 * 「拖进来」与「按钮导入」长成两种行为；③ 漏斗带扩展名守卫（非 .md/.txt 不覆盖）；
 * ④ 覆盖层不拦截事件（pointer-events-none），否则 drop 落不到漏斗上。 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../tests/helpers/strip-comments";

const code = stripComments(
  readFileSync(fileURLToPath(new URL("WorkshopStageBody.tsx", import.meta.url)), "utf8"),
);

describe("剧本页的拖拽导入接线（#4827）", () => {
  it("投放区接的是共享漏斗 useDropZone，不是第二套拖拽实现", () => {
    expect(code).toContain('from "~/components/ui/use-drop-zone"');
    expect(code).toContain("useDropZone(handleScriptFile, showNotice)");
  });

  it("「导入剧本」按钮与拖拽走同一个文件漏斗（onPick 与 onFile 同源）", () => {
    expect(code).toContain("const handleScriptFile");
    expect(code).toContain("onPick: handleScriptFile");
    expect(code).toContain("useDropZone(handleScriptFile");
  });

  it("漏斗带扩展名守卫：非 .md/.txt 不覆盖剧本", () => {
    expect(code).toContain(String.raw`/\.(?:md|txt)$/i`);
    expect(code).toContain("已保留当前剧本");
  });

  it("拖拽进行中的覆盖层不拦截事件（pointer-events-none）", () => {
    expect(code).toContain("pointer-events-none");
  });
});
