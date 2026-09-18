import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  STATUS_ACTIONS_CLASS,
  STATUS_BUTTON_BASE,
  STATUS_ROW_CLASS,
  STATUS_TEXT_CLASS,
  statusButtonClass,
} from "./settings-status-row-config";

/** class 串按空格切词，便于断言「含有某个工具类」而不受顺序影响。 */
function tokens(cls: string): string[] {
  return cls.split(/\s+/).filter(Boolean);
}

describe("设置页状态行按钮：不许换行变高（ISSUE #423）", () => {
  it("基础类带全三条硬规则", () => {
    for (const rule of ["whitespace-nowrap", "shrink-0", "leading-none"]) {
      expect(tokens(STATUS_BUTTON_BASE)).toContain(rule);
    }
  });

  it("补了额外类（ml-auto / 配色覆盖）后仍不许换行、不许被压扁", () => {
    const cls = tokens(statusButtonClass("ml-auto bg-emerald-600"));
    expect(cls).toContain("whitespace-nowrap");
    expect(cls).toContain("shrink-0");
    expect(cls).toContain("ml-auto");
    expect(cls).toContain("bg-emerald-600");
  });

  it("不传额外类也不会拼出多余空格", () => {
    const cls = statusButtonClass();
    expect(cls.startsWith(" ")).toBe(false);
    expect(cls.includes("  ")).toBe(false);
  });
});

describe("设置页状态行：窄了整排换行，不压扁控件", () => {
  it("根容器允许换行，宽度不足时按钮整排落到第二行", () => {
    expect(tokens(STATUS_ROW_CLASS)).toContain("flex-wrap");
  });

  it("按钮组整体不许被压扁", () => {
    expect(tokens(STATUS_ACTIONS_CLASS)).toContain("shrink-0");
  });

  it("状态文字可截断，且有下限以触发换行", () => {
    // min-w-0：flex 项默认 min-width:auto，长文案会把整行顶宽、按钮组等不到换行
    expect(tokens(STATUS_TEXT_CLASS)).toContain("min-w-0");
    expect(tokens(STATUS_TEXT_CLASS)).toContain("truncate");
  });
});

describe("设置页视图：三条状态行都接上了这套判据", () => {
  /* 视图已按分区拆到 components/（ISSUE #535 拆 SettingsPageView），三条状态行
   * 分别在 LlmLocalSection（Ollama）/ ComfyuiSection / DatabaseSection 里，判据
   * 扫这三份源码；主按钮原语 `StatusButton` 在 SettingsPrimitives
   * （statusButtonClass 的唯一落点）。取 import 段之后的部分：否则「用了几次」
   * 会把 import 名本身也算进去。 */
  const readViewBody = (rel: string) =>
    readFileSync(new URL(rel, import.meta.url), "utf8").split(
      '} from "../settings-status-row-config";',
    )[1] ?? "";
  const viewBody = [
    readViewBody("./components/LlmLocalSection.tsx"),
    readViewBody("./components/ComfyuiSection.tsx"),
    readViewBody("./components/DatabaseSection.tsx"),
  ].join("\n");
  /* StatusButton 原语单独取：只留 `StatusButton` 的函数体，避免把文档注释里
   * 「这里此前是第二个 `<button>` 实现」这类**说明**当成实现（判据自身的
   * 注释剥离教训见 check-ui-primitives.cjs 的 stripComments）。 */
  const primitivesSrc = readFileSync(
    new URL("./components/SettingsPrimitives.tsx", import.meta.url),
    "utf8",
  );
  const primitivesBody =
    primitivesSrc.split("export function StatusButton(")[1] ?? "";

  it("StatusButton 走 statusButtonClass，且底子是 ui/button 基元", () => {
    /* 排布契约（不许换行 / 不许被压扁）只有 statusButtonClass 一个来源 ——
     * 视图里再手拼一遍尺寸类就会绕过它（ISSUE #423 的回归点）。 */
    expect(primitivesBody).toContain("statusButtonClass(");
    /* 底子必须是 ui/button 的 Button 而不是又一个 `<button>`（ISSUE #672 P1）。 */
    expect(primitivesBody).toContain("<Button");
    expect(primitivesBody).not.toContain("<button");
    expect(viewBody).not.toContain(
      "className={`bg-primary hover:bg-primary-hover rounded-lg px-4 py-2",
    );
  });

  it("ComfyUI / Drizzle Studio / Ollama 三行都用状态行容器", () => {
    const rows = viewBody.match(/STATUS_ROW_CLASS/g) ?? [];
    expect(rows.length).toBe(3);
  });

  it("三行的按钮组都用 STATUS_ACTIONS_CLASS 或带 shrink-0", () => {
    const groups = viewBody.match(/STATUS_ACTIONS_CLASS/g) ?? [];
    // ComfyUI 与 Drizzle Studio 两行是按钮组；Ollama 行单个按钮带 shrink-0
    expect(groups.length).toBe(2);
    /* Ollama 行只有一个动作按钮，它走 StatusButton —— 排布契约（含
     * `shrink-0`）由 statusButtonClass 提供，不再是视图里手写的一串类。 */
    expect(viewBody).toContain('className="ml-auto"');
  });
});
