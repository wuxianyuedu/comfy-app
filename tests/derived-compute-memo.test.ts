/**
 * 渲染期派生计算记忆化守卫（ISSUE #5225 B 档）：35 条广谱扫描里真正属于
 * 「渲染期裸算」的条目已按文件收进 useMemo / useCallback，3 处与 C 档重叠的
 * O(n²) `includes` 同时换成 Set。这里钉住写法，防止后来者顺手改回裸算。
 *
 * 另有一批扫描命中实际不是渲染期裸算（事件回调 / 纯函数 / 普通 DOM 后处理 /
 * 已在 useMemo 内的纯函数），它们不进本守卫，理由写在 PR 描述里。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

/** 断言 `const <name> = useMemo(` / `React.useMemo(` 形态出现。 */
function expectMemo(src: string, names: Array<string>): void {
  for (const name of names) {
    expect(src, `${name} 必须记忆化`).toMatch(
      new RegExp(`const ${name}(?::[^=]+)? = (?:React\\.)?useMemo\\(`),
    );
  }
}

describe("ISSUE #5225 B 档：渲染期派生计算记忆化", () => {
  it("设置面板：供应商读数与分组导航走 useMemo", () => {
    expectMemo(source("src/app/(main)/settings/components/LlmRemoteSection.tsx"), [
      "providerStats",
    ]);
    expectMemo(source("src/app/(main)/settings/components/AppearanceSection.tsx"), [
      "groups",
      "visibleGroups",
    ]);
    expectMemo(source("src/components/settings/SettingsShell.tsx"), [
      "groupSections",
      "itemsByGroup",
    ]);
  });

  it("画布锚点与端口：filter 派生走 useMemo 或 useCallback", () => {
    expectMemo(source("src/components/studio/canvas/FlowNodeCollapsedAnchors.tsx"), [
      "rawByName",
      "connectedInputs",
      "connectedOutputs",
    ]);
    expectMemo(source("src/components/studio/canvas/SubgraphCollapsedAnchors.tsx"), [
      "wiredInputs",
      "wiredOutputs",
    ]);
    const pinRows = source("src/components/studio/canvas/FlowNodePinRows.tsx");
    expect(pinRows).toMatch(/const toneOf = useCallback\(/);
  });

  it("工坊计数：逐镜头 filter 派生走 useMemo，无 O(n²) includes", () => {
    expectMemo(source("src/components/workshop/VideoStudio.tsx"), ["doneCount", "pending"]);
    expectMemo(source("src/components/workshop/ShotStudio.tsx"), [
      "busyCount",
      "doneCount",
      "pending",
    ]);
    expectMemo(source("src/components/workshop/ShotFilmStrip.tsx"), [
      "doneCount",
      "failedCount",
      "reviewedCount",
    ]);
    expectMemo(source("src/components/workshop/WorkshopHeader.tsx"), [
      "pendingRows",
      "pendingLabels",
    ]);
    expectMemo(source("src/components/workshop/ModelAdaptersView.tsx"), [
      "groups",
      "availableModes",
    ]);
    expectMemo(source("src/components/workshop/StoryboardPlanner.tsx"), ["idleCount"]);
  });

  it("C 档重叠的三处 includes 换成 Set 查表", () => {
    const shotStudio = source("src/components/workshop/ShotStudio.tsx");
    expect(shotStudio).toContain("const charIds = new Set(shot.characterIds)");
    expect(shotStudio).not.toContain("characters.filter((c) => shot.characterIds.includes(c.id))");

    const shotRow = source("src/components/workshop/StoryboardPlanner.parts.tsx");
    expect(shotRow).toContain("const ids = new Set(shot.characterIds)");
    expect(shotRow).not.toContain(
      "characters.filter((character) => shot.characterIds.includes(character.id))",
    );

    const shell = source("src/components/settings/SettingsShell.tsx");
    expect(shell).toContain("new Set(group.sections)");
    expect(shell).not.toContain("group.sections.includes(item.id)");
  });

  it("其余渲染期派生（核心壳 / 弹窗 / 调试条 / 表单）走 useMemo", () => {
    expectMemo(source("src/components/studio/AppShell.tsx"), ["iframeTabs"]);
    expectMemo(source("src/components/studio/VideoQueueModal.tsx"), ["runningCount"]);
    expectMemo(source("src/components/studio/debug/DebugChainFooter.tsx"), [
      "canvasModules",
      "nodeModules",
    ]);
    expectMemo(source("src/components/studio/workflow-form/DimensionControlParts.tsx"), ["live"]);
    expectMemo(
      source("src/components/studio/workflow-library/CustomNodesSettings/NodePreviewCard.tsx"),
      ["inputs", "outputs", "typed", "widgets"],
    );
    expectMemo(source("src/components/studio/workflow-form/VideoControl.tsx"), [
      "entries",
      "sections",
      "summary",
    ]);
  });
});
