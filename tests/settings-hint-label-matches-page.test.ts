/**
 * 提示语里的「设置 → <分区> → <字段>」必须真是设置页上的那两个名字（ISSUE #1239）。
 *
 * 背景：解释器找不到时的「建议」要告诉用户去哪一项填路径。本刀第一版写的是
 * 「设置 → ComfyUI → comfy-cli 解释器」，而在打包界面里那张卡的标题是
 * 「创作后端（ComfyUI）」、导航项叫「创作后端」—— 名字对不上时提示本身就是一条
 * 走不通的出口（比不给建议更糟：用户会照着去找一个不存在的地方）。
 * 分区改名不会让任何用例变红，所以把「指的路在页面上存在」钉成判据。
 *
 * 两层判据：
 *   ① 提示/建议里出现 `设置 → X → Y` 时，X 必须是 `SETTINGS_SECTIONS` 里真实的 label；
 *   ② Y 必须能在创作后端那张卡的源码里找到（字段 label 与卡标题同在一个组件，
 *      改名时这条会一起提醒）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SETTINGS_SECTIONS } from "../src/app/(main)/settings/hooks/use-settings-page-types";
import { adviseOnError } from "~/lib/comfyui/error-advice";
import { comfyCliMissingHint } from "~/lib/comfyui/comfy-cli-python";

/** 抓 `「设置 → X → Y」` 里那两段（两处文案都用中文引号把整条路径包住）。 */
const POINTER_RE = /设置 → ([^ →]+) → ([^」]+)」/;

function pointerOf(text: string): { section: string; field: string } {
  const match = POINTER_RE.exec(text);
  return { section: match?.[1] ?? "", field: (match?.[2] ?? "").trim() };
}

const SECTION_LABELS = SETTINGS_SECTIONS.map((s) => s.label);
const DESKTOP_HINT = comfyCliMissingHint({ inCheckout: false });

describe("解释器提示指向的设置页位置", () => {
  it("桌包「建议」指向的分区名在设置页导航里真实存在", () => {
    const pointer = pointerOf(DESKTOP_HINT);
    /* 抓不到形态 = 文案被改成不指向任何地方了，先让这一条红，别让它静默通过。 */
    expect(
      pointer.section,
      `提示里没找到「设置 → X → Y」形态：${DESKTOP_HINT}`,
    ).not.toBe("");
    expect(SECTION_LABELS).toContain(pointer.section);
  });

  it("失败建议表里那条指向同一个分区", () => {
    /* 空串 = 建议表压根没命中这条报错（那一层由 error-advice.test.ts 管）；
     * 这里让它以「抓不到路径形态」红出来，而不是把 null 传下去。 */
    const advice =
      adviseOnError(
        "未找到 comfy-cli Python 解释器：C:\\Users\\x\\python.exe",
      ) ?? "";
    const pointer = pointerOf(advice);
    expect(
      pointer.section,
      `建议里没找到「设置 → X → Y」形态：${advice}`,
    ).not.toBe("");
    expect(SECTION_LABELS).toContain(pointer.section);
    /* 两处必须给同一个分区名：同一句报错在两处指到不同地方，就是 #1239 之前那两份
     * 互相漏项的建议表犯过的同一种错。 */
    expect(pointer.section).toBe(pointerOf(DESKTOP_HINT).section);
  });

  it("指向的字段名在创作后端那张卡里渲染得出来", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "src/app/(main)/settings/components/ComfyuiSection.tsx",
      ),
      "utf8",
    );
    const field = pointerOf(DESKTOP_HINT).field;
    expect(field).not.toBe("");
    expect(src).toContain(`label="${field}`);
    /* 导航项与卡标题同前缀（导航「创作后端」/ 卡「创作后端（ComfyUI）」）：
     * 用户按导航找得到卡。两张名字毫无关系时这条就该红。 */
    const comfyLabel =
      SETTINGS_SECTIONS.find((s) => s.id === "comfyui")?.label ?? "";
    expect(src).toContain(`title="${comfyLabel}`);
  });
});
