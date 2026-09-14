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
   * 扫这三份源码；本地 Btn 原语在 SettingsPrimitives（statusButtonClass 的唯一
   * 落点）。取 import 段之后的部分：否则「用了几次」会把 import 名本身也算进去。 */
  const readViewBody = (rel: string) =>
    readFileSync(new URL(rel, import.meta.url), "utf8").split(
      '} from "../settings-status-row-config";',
    )[1] ?? "";
  const viewBody = [
    readViewBody("./components/LlmLocalSection.tsx"),
    readViewBody("./components/ComfyuiSection.tsx"),
    readViewBody("./components/DatabaseSection.tsx"),
  ].join("\n");
  /* Btn 原语单独取：它 import 路径是 "./settings-status-row-config"。 */
  const primitivesBody =
    readFileSync(
      new URL("./components/SettingsPrimitives.tsx", import.meta.url),
      "utf8",
    ).split('} from "../settings-status-row-config";')[1] ?? "";

  it("本地 Btn 走 statusButtonClass，不再自己拼尺寸类", () => {
    expect(primitivesBody).toContain("statusButtonClass(");
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
    expect(viewBody).toContain('className="ml-auto shrink-0"');
  });
});
