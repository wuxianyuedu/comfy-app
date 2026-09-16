// Agent prompts 与 JSON 指令解析单测。
import { describe, expect, it } from "vitest";
import { parseJsonInstruction, formatDraftContext } from "./prompts";
import { workshopOpenAITools, workshopToolNames } from "./tools";

describe("parseJsonInstruction", () => {
  it("解析纯 JSON 对象", () => {
    const result = parseJsonInstruction('{"action": "get_project_state"}');
    expect(result).toEqual({ action: "get_project_state" });
  });

  it("解析被代码围栏包裹的 JSON", () => {
    const result = parseJsonInstruction(
      '```json\n{"action": "generate_script", "idea": "海边重逢"}\n```',
    );
    expect(result).toEqual({
      action: "generate_script",
      idea: "海边重逢",
    });
  });

  it("从包含前后缀文字的文本中提取 JSON", () => {
    const result = parseJsonInstruction(
      '好的，我将帮你生成剧本。\n{"action": "generate_script", "idea": "测试"}\n这是我拟定的方案。',
    );
    expect(result).toEqual({
      action: "generate_script",
      idea: "测试",
    });
  });

  it("无法解析时返回 null", () => {
    expect(parseJsonInstruction("这不是 JSON")).toBeNull();
    expect(parseJsonInstruction("")).toBeNull();
    expect(parseJsonInstruction("[]")).toBeNull();
  });
});

describe("formatDraftContext", () => {
  it("格式化项目快照供模型阅读", () => {
    const ctx = formatDraftContext({
      meta: {
        title: "海边故事",
        type: "short_video",
        tone: "温暖治愈",
        logline: "重逢",
      },
      scriptMarkdown: "## 场景1",
      scenes: [],
      characters: [],
      shots: [],
    });
    expect(ctx).toContain("海边故事");
    expect(ctx).toContain("温暖治愈");
    expect(ctx).toContain("剧本");
  });
});

describe("workshopOpenAITools", () => {
  it("返回合法的 OpenAI tools 格式", () => {
    const tools = workshopOpenAITools();
    expect(tools.length).toBeGreaterThan(5);
    for (const tool of tools) {
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBeTruthy();
      expect(tool.function.description).toBeTruthy();
    }
    const names = new Set(tools.map((t) => t.function.name));
    expect(names.has("get_project_state")).toBe(true);
    expect(names.has("generate_script")).toBe(true);
    expect(names.has("extract_characters")).toBe(true);
    expect(names.has("plan_storyboard")).toBe(true);
    expect(names.has("generate_shot_images")).toBe(true);
  });

  it("workshopToolNames 覆盖全部工具", () => {
    const toolNames = workshopToolNames();
    const tools = workshopOpenAITools();
    for (const t of tools) {
      expect(toolNames.has(t.function.name)).toBe(true);
    }
  });
});
