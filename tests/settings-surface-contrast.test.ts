/**
 * 设置页「卡片内的一行」与卡片底色的可分辨性（ISSUE #3510）。
 *
 * 现场：设置页各分区卡片里的列表行 / 状态行 / 说明行，此前要么透明、要么写
 * `bg-surface-1`（= 卡片同色）—— 于是子项与卡片逐像素同底（深色主题下两者都是
 * `#16161c`），一屏里读不出「一格一格」（ISSUE #3495 的第二条评论）。
 *
 * 根因不是某一行写错了 class，而是**色板里没有「卡片内的那一层」**：唯一高于
 * 卡片的 `--color-surface-2` 与 `--color-surface-1` 只差 1.07:1（深色 1.04:1），
 * 低于「看得见」的门槛（`tests/sidebar-state-contrast.test.ts` 把 1.10 定为下限，
 * 并记着「修复前深色 1.04:1 ⇒ 看不出变化」）。本 ISSUE 补上这颗 token
 * `--color-surface-row`，并把「卡片内的一行」收成一处出口
 * `SETTINGS_ROW_CLASS`（`~/components/ui/settings-card`）。
 *
 * 取值用 `tests/helpers/theme-tokens.ts` 从**编译产物**真解析 —— 别改回
 * `getComputedStyle`（jsdom 不解析 `var()`，别名会返回字面量，断言全误报）。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { contrast } from "./helpers/contrast";
import { loadThemeTokens, type ThemeTokens } from "./helpers/theme-tokens";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SETTINGS_DIR = path.join(ROOT, "src", "app", "(main)", "settings");
const SETTINGS_CARD = path.join(ROOT, "src", "components", "ui", "settings-card.tsx");

let light: ThemeTokens;
let dark: ThemeTokens;

beforeAll(async () => {
  ({ light, dark } = await loadThemeTokens());
});

/** 某态下某 token 的解析值；未定义即用例失败（比 `!` 断言给出更好的报错）。 */
function token(t: ThemeTokens, name: string): string {
  const v = t.get(name);
  expect(v, `${name} 未解析出值（未声明 / 被 tree-shake / var 链断裂）`).toBeTruthy();
  return v!;
}

/**
 * 行表面与卡片表面的**最低可分辨下限**（两态不同档，理由见各自注释）。
 *
 * 深色档：1.15 —— 取值 `#24242f` 对卡片 `#16161c` 实测 1.17:1，留一点余量。
 * 浅色档：1.08 —— 取值 `#eceef4` 对卡片 `#f7f8fa` 实测 1.09:1，**上限是被 AA
 * 压住的**：行底再深一档，行上的弱文字（`--color-ink-muted` `#6b6b76`）就跌到
 * 4.5:1 以下（`#e9ebf1` 已是 4.42:1）。浅色主题的卡片本身离页面底也只有 1.06:1，
 * 这一档的压缩是色板本身的形状，不是本 token 取错。
 */
const MIN_ROW_VS_CARD_DARK = 1.15;
const MIN_ROW_VS_CARD_LIGHT = 1.08;

/** 行上的弱文字仍要过 WCAG AA（普通字号 4.5:1）。 */
const MIN_MUTED_INK_VS_ROW = 4.5;

/** 递归收集目录下的源码文件（相对仓库根的路径 + 源码文本）。 */
function collectSourceFiles(dir: string, out: Array<{ rel: string; text: string }> = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(abs, out);
      continue;
    }
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      continue;
    }
    out.push({
      rel: path.relative(ROOT, abs).split(path.sep).join("/"),
      text: readFileSync(abs, "utf8"),
    });
  }
  return out;
}

describe("设置页「卡片内的一行」在真编译产物里分得开（ISSUE #3510）", () => {
  /* SAFETY: 类型断言已复核 */
  it.for([
    ["浅色", () => light, MIN_ROW_VS_CARD_LIGHT],
    ["深色", () => dark, MIN_ROW_VS_CARD_DARK],
  ] as const)("%s：行表面明显区别于卡片表面", ([, get, min]) => {
    const t = get();
    const card = token(t, "--color-surface-1");
    const row = token(t, "--color-surface-row");

    expect(
      contrast(row, card),
      `行表面 ${row} 对卡片表面 ${card} 太弱（改之前行与卡片同色，等于 1.00:1）`,
    ).toBeGreaterThanOrEqual(min);
  });

  it("行表面不是任何一档现成表面的复制品（它是新的一档）", () => {
    for (const t of [light, dark]) {
      const row = token(t, "--color-surface-row");
      expect(row, "行表面与卡片表面同值 ⇒ 这一档等于没加").not.toBe(token(t, "--color-surface-1"));
      expect(row, "行表面与控件表面同值 ⇒ 行与输入框糊在一起").not.toBe(
        token(t, "--color-surface-2"),
      );
    }
  });

  it("两态各自取值（不是一个值复印两份）", () => {
    expect(token(light, "--color-surface-row")).not.toBe(token(dark, "--color-surface-row"));
  });

  /* SAFETY: 类型断言已复核 */
  it.for([
    ["浅色", () => light],
    ["深色", () => dark],
  ] as const)("%s：行上的弱文字仍过 AA", ([, get]) => {
    const t = get();
    const row = token(t, "--color-surface-row");
    expect(
      contrast(token(t, "--color-ink-muted"), row),
      "行上的弱文字对比度不足 4.5:1 —— 行底压得太深，浅色档尤甚",
    ).toBeGreaterThanOrEqual(MIN_MUTED_INK_VS_ROW);
    expect(
      contrast(token(t, "--color-ink"), row),
      "行上的正文对比度不足 4.5:1",
    ).toBeGreaterThanOrEqual(MIN_MUTED_INK_VS_ROW);
  });
});

describe("「卡片内的一行」只有一处出口（ISSUE #3510）", () => {
  it("共享 class 带的是行表面这一档", () => {
    const text = readFileSync(SETTINGS_CARD, "utf8");
    expect(
      text,
      "「卡片内的一行」的唯一出口应是 `SETTINGS_ROW_CLASS`，且它带着行表面这一档",
    ).toContain("SETTINGS_ROW_CLASS");
    expect(text, "`SETTINGS_ROW_CLASS` 没有指向 `--color-surface-row`").toContain("bg-surface-row");
  });

  it("设置页分区里不再出现第二处卡片同色（`bg-surface-1` 是卡片自己的底色）", () => {
    const offenders = collectSourceFiles(SETTINGS_DIR)
      .filter((file) => file.text.includes("bg-surface-1"))
      .map((file) => file.rel);
    expect(
      offenders,
      "设置页分区里出现了与卡片同色的行 —— 那正是本 ISSUE 的根因形态：行与卡片逐像素同底",
    ).toEqual([]);
  });
});
