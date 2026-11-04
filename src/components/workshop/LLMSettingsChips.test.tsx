import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { LLMConfigController } from "./hooks/use-llm-config";
import type { LLMConfigView } from "~/lib/llm/types";

afterEach(cleanup);

/**
 * LLM 设置弹窗里两排「一排里选一个」的形态回归（ISSUE #1925 第三批收口）：手搓的 `Button variant="outline"` 选中档没钉悬停值，而 `outline` 变体自带
 * `hover:bg-muted hover:text-foreground` —— 划过**已选中**的那枚时悬停档胜出，紫色选中翻成白字灰底（ISSUE #1423 那一族）。现整排交给 `ui/select-chip`。
 * 这里钉两件事：① 单选语义（`radiogroup` + `aria-checked`）；② 选中档自带与常态同值的悬停值。
 */
const cfg: LLMConfigView = {
  provider: "local",
  baseUrl: "http://127.0.0.1:11434",
  model: "qwen2.5:7b",
  extraModels: ["llama3.2", "qwen2.5:7b"],
  temperature: 0.7,
  maxTokens: 1024,
  hasApiKey: false,
};

vi.mock("./hooks/use-llm-config", () => ({
  useLLMConfig: (): LLMConfigController => ({
    config: cfg,
    localModels: [],
    remoteModels: [],
    remoteImageModels: [],
    loading: false,
    refresh: vi.fn(),
  }),
  useLLMConfigSave: () => ({ saving: false, save: vi.fn() }),
}));

const { LLMProvider, LLMSettingsButton } = await import("./LLMContext");

async function openSettings() {
  const user = userEvent.setup();
  render(
    <LLMProvider>
      <LLMSettingsButton />
    </LLMProvider>,
  );
  await user.click(screen.getByRole("button", { name: /LLM 设置/ }));
  return user;
}

describe("LLM 设置的提供方 / 模型清单 chip（ISSUE #1925）", () => {
  it("提供方是单选语义的 radiogroup", async () => {
    await openSettings();
    expect(screen.getByRole("radiogroup", { name: "提供方" })).toBeTruthy();
    const providerChips = screen
      .getAllByRole("radio")
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- DOM textContent 运行期是 string|null（lib.dom 声明），规则未建模，保留空值兜底
      .filter((c) => /Ollama|OpenAI/.test(c.textContent ?? ""));
    expect(providerChips).toHaveLength(2);
    expect(providerChips.map((c) => c.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  });

  it("模型清单也是单选 radiogroup，且选中档四层俱在、悬停回钉常态", async () => {
    await openSettings();
    const group = screen.getByRole("radiogroup", { name: "选择模型" });
    expect(group).toBeTruthy();
    const checked = screen
      .getAllByRole("radio")
      .find((c) => c.getAttribute("aria-checked") === "true")!;
    for (const layer of [
      "aria-checked:bg-primary-soft",
      "aria-checked:text-primary-strong",
      "aria-checked:border-primary",
      "aria-checked:font-semibold",
      "aria-checked:hover:bg-primary-soft",
    ]) {
      expect(checked.className).toContain(layer);
    }
  });
});
