//
// 回归测试 ISSUE #202 问题1：从剧本「提取/导入」角色卡成功后，并入结果必须
// 经 onCharactersChange 回写到父级状态，否则卡片不出现在下方列表中（根因：
// handleExtract / handleImportFile 从未把 mergeCharacterDrafts 的 res.list 上抛）。
// mock `~/lib/llm/browser` 的 streamChat 返回一段角色卡 JSON，验证并入回写。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CharacterDesigner } from "~/components/workshop/CharacterDesigner";
import type { Character } from "~/lib/workshop/types";

/* 本用例不测 LoRA 绑定：mock 掉候选 hook，视图就不需要 TRPCProvider。 */
vi.mock("~/components/workshop/hooks/use-character-lora-options", () => ({
  useCharacterLoraOptions: () => ({ options: [], loading: false }),
}));

vi.mock("~/components/workshop/LLMContext", () => ({
  useLLM: () => ({
    config: {
      provider: "local",
      baseUrl: "http://localhost:11434",
      model: "llama3",
      temperature: 0.7,
      maxTokens: 2048,
      hasApiKey: false,
    },
    localModels: ["llama3"],
    remoteModels: [],
    loading: false,
    settingsOpen: false,
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("~/lib/llm/browser", () => ({
  streamChat: vi.fn(() => {
    return JSON.stringify([{ name: "小满", appearance: "短黑发,清秀,白色连衣裙" }]);
  }),
}));

const SCRIPT = `# 剧本
人物:小满(女,25岁)——短黑发,清秀,白色连衣裙
`;

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
});

describe("CharacterDesigner 提取后回写角色列表", () => {
  it("模型通道提取成功后将并入的角色写入 onCharactersChange", async () => {
    const onCharactersChange = vi.fn();
    render(
      <CharacterDesigner
        characters={[]}
        onCharactersChange={onCharactersChange}
        scriptMarkdown={SCRIPT}
        styles={[]}
      />,
    );

    // 触发「从剧本提取角色」区块的「提取」按钮（默认本地模型通道）
    fireEvent.click(screen.getByRole("button", { name: "提取" }));

    /* 提取为异步流程（streamChat → parse → merge 之后才合并）。
       用 `expect.poll` 等它落地：失败时它打出每次读到的实际值
       （这里就是「回调被调用了几次」），而不是 `vi.waitFor` 那句
       「断言一直不成立，超时了」——后者在「根本没调」与「调得太晚」之间
       给不出区分。 */
    await expect.poll(() => onCharactersChange.mock.calls.length).toBe(1);

    /* SAFETY: 类型断言已复核 */
    const listArg = onCharactersChange.mock.calls[0]?.[0] as Array<Character> | undefined;
    expect(listArg).toBeDefined();
    const first = listArg?.[0];
    expect(first).toBeDefined();
    expect(first!.name).toBe("小满");
  });
});
