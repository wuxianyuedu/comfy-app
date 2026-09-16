// @vitest-environment jsdom
//
// 回归测试 ISSUE #202 问题1：从剧本「提取/导入」角色卡成功后，并入结果必须
// 经 onCharactersChange 回写到父级状态，否则卡片不出现在下方列表中。
// 根因：handleExtract / handleImportFile 调用了 mergeCharacterDrafts 却从未把
// 返回的 res.list 通过 onCharactersChange 上抛，导致提取"成功"但列表不刷新。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CharacterDesigner } from "~/components/workshop/CharacterDesigner";
import type { Character } from "~/lib/workshop/types";

vi.mock("~/components/workshop/LLMContext", () => ({
  useLLM: () => ({
    config: null,
    localModels: [],
    remoteModels: [],
    loading: false,
    settingsOpen: false,
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const SCRIPT = `# 剧本
人物:小满(女,25岁)——短黑发,清秀,白色连衣裙
`;

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => cleanup());

describe("CharacterDesigner 提取后回写角色列表", () => {
  it("工具通道提取成功后将并入的角色写入 onCharactersChange", async () => {
    const onCharactersChange = vi.fn();
    render(
      <CharacterDesigner
        characters={[]}
        styles={[]}
        onCharactersChange={onCharactersChange}
        scriptMarkdown={SCRIPT}
      />,
    );

    // 触发「从剧本提取角色」区块的「提取」按钮（工具通道，不调用模型）
    fireEvent.click(screen.getByRole("button", { name: "提取" }));

    // 提取为异步流程（setLog / parse 之后才合并），用 waitFor 等待
    await vi.waitFor(() => {
      expect(onCharactersChange).toHaveBeenCalled();
    });

    const listArg = onCharactersChange.mock.calls[0]?.[0] as
      Character[] | undefined;
    expect(listArg).toBeDefined();
    const first = listArg?.[0];
    expect(first).toBeDefined();
    expect(first!.name).toBe("小满");
    // 并入的角色携带重算好的正向提示词
    expect(first!.positivePrompt).toBeTruthy();
  });
});
