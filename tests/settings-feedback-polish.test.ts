/**
 * ISSUE #3495 本轮设置页整改的形态判据（防回潮）。四条都对应一条用户现场：
 * ① 设置页不再出现原生 `<input type="number">` —— Chromium 原生 spinner 的
 *    浅色按钮底压在字段上（「上下箭头还带白色背景」）；箭头改由
 *    `ui/stepper-input` 悬浮在框内。
 * ② 「添加模型」弹窗的高度上限把应用标题栏算进去 —— 弹窗相对视口居中，
 *    上限只留 4rem 时高内容会把上沿顶到视口 2rem 处，比标题栏还高
 *    （「上边框紧贴应用标题栏」）。
 * ③ 「重置」按钮带可见底色 —— ghost 透明底在暗色下没有按钮形状
 *    （「暗色的重置按钮背景看不清」）。
 * ④ 供应商分区的控件边界在暗色下走 ink 档 —— `border-border`（#26262e）
 *    对行底 #24242f 几乎同色（「供应商这里暗色还是有些看不清」）。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SETTINGS_DIR = path.join(ROOT, "src", "app", "(main)", "settings");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(abs, out);
      continue;
    }
    if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

describe("设置页反馈整改的形态判据（ISSUE #3495）", () => {
  it("设置页源码里不再出现原生 type=number 输入", () => {
    const offenders = collectSourceFiles(SETTINGS_DIR)
      .map((abs) => readFileSync(abs, "utf8"))
      .filter((text) => text.includes('type="number"'));
    expect(
      offenders,
      "原生 number spinner 的白底箭头是本轮要收掉的形态；数字步进走 ui/stepper-input",
    ).toEqual([]);
  });

  it("「添加模型」弹窗的高度上限给上沿留出空隙", () => {
    const text = read("src/app/(main)/settings/components/ProviderModelDialog.tsx");
    /* #3618 已把这一格落在 master（max-h 收到 100vh-12rem，上下各保底 5rem）；
     * 本分支解冲突时沿用同一解，这里钉住它不被改回小间距。 */
    expect(
      text,
      "弹窗 max-h 必须给上沿留出空隙：相对视口居中的弹窗，内容顶满时会压到标题栏",
    ).toContain("max-h-[calc(100vh-12rem)]");
  });

  it("「重置」按钮带可见底色（暗色下不再是透明 ghost）", () => {
    const text = read("src/app/(main)/settings/components/ProviderModelDialog.tsx");
    /* 浅色走 bg-surface-2；暗色下 surface-2 对弹窗底只有 1.35:1（用户现场：
     * 「暗色重置按钮背景还是看不见」），再叠 ink/25 的填充 + ink/30 描边
     * （填充约 2.1:1、边界 3:1 档）并把文字提到 ink 档保 AA。 */
    expect(text, "重置按钮要有 bg-surface-2 这一档可见底色").toContain("bg-surface-2");
    expect(text, "暗色下重置按钮的底要再提一档（ink/25），否则在弹窗深底上仍看不见").toContain(
      "dark:bg-ink/25",
    );
    expect(text, "暗色下重置按钮要有 ink 档描边（填充之外再给边界）").toContain(
      "dark:border-ink/30",
    );
  });

  it("供应商分区的控件边界在暗色下走 ink 档", () => {
    const section = read("src/app/(main)/settings/components/LlmRemoteSection.tsx");
    const fields = read("src/app/(main)/settings/components/ProviderConnectionFields.tsx");
    expect(section, "供应商列表 / 空态的边界在暗色下要升级到 ink 档").toContain(
      "dark:border-ink/40",
    );
    expect(fields, "连接参数分组框的边界在暗色下要升级到 ink 档").toContain("dark:border-ink/40");
  });
});
