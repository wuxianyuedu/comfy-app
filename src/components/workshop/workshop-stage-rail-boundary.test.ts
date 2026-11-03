// 竖向阶段轨道的两条边界（按源码读，不需要 DOM）。
//  1. **懒加载不能被打穿**：六段互斥懒加载而轨道常驻，轨道一旦静态 import 任何一段
//     的实现组件，六段就全进首屏 chunk，等于整体作废。
//  2. **工坊只留一个阶段切换入口**：横条与竖轨同时挂载会让同一组判据出现两遍。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 六段各自的实现组件名：轨道源文件里出现任何一个，都等于把懒加载打穿。 */
const STAGE_MODULES = [
  "ScriptGenerator",
  "CharacterDesigner",
  "StoryboardPlanner",
  "ShotStudio",
  "VideoStudio",
  "FinalComposer",
];

function readSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
}

describe("WorkshopStageRail 的边界", () => {
  it("轨道只依赖阶段元数据与共用单件，不静态引用任何一段的实现组件", () => {
    const railSource = readSource("WorkshopStageRail.tsx");
    const offenders = STAGE_MODULES.filter((name) => railSource.includes(name));
    expect(offenders).toEqual([]);
    expect(railSource).toContain("stage-config");
    expect(railSource).toContain("WorkshopStageItem");
  });

  it("工坊只留一个阶段切换入口：横条已从容器摘干净", () => {
    const pipelineSource = readSource("WorkshopPipeline.tsx");
    expect(pipelineSource).toContain("WorkshopStageRail");
    expect(pipelineSource).not.toContain("WorkshopStageNav");
  });
});
