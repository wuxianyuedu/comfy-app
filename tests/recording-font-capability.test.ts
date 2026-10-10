/**
 * 录制环境的**字体档**能力上报（§11.8）：判据本身 + 它不静默退化的守。
 *
 * 动因（ISSUE #1620 收尾时实测出来的一层）：基线文件名带**平台名**（`-linux.png`），
 * 于是「同一平台名 ⇒ 同一渲染」是个默认前提。而平台名担保不了**字体栈** —— 同一个
 * linux 平台名下，一个装了 CJK 字体的容器与一个没有的，跑同一份 spec / 基线 / 代码
 * 差 **1767 像素**，差的是整页中文的字形（中文全走缺字，「模型库」渲染成「模型」）。
 * 此前这一档一条判据都没有：`visual-baseline-pairing.test.ts` 只管仓库里那几套 PNG 的
 * 形态，`checkRecordingEnv` 只管 `CI` 的真假 ⇒ webServer 口径。
 *
 * 判据的形状（为什么不是「列一张字族清单」的三条实测理由）见
 * `scripts/recording-font-capability.mjs` 的文件头。本文件守两件事：
 *   1. **判决本身在两个方向上都对**：有 CJK 覆盖 ⇒ 放过；没有 ⇒ 报红且话术点名原因。
 *      反向对照用**实测到的真读数**（同一个 linux 容器上 `fc-list :lang=zh` 有/无两次
 *      实测的墨迹量），不是编出来的数字。
 *   2. **判据接在 `settle` 上**：判据存在与判据有执行者**是两件事**（§11.8 反复判过的
 *      那味药）—— 没接上时它一行都不跑，而像素档照样可能绿。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CJK_PROBE_SAMPLE,
  GLYPHLESS_PROBE_SAMPLE,
  checkRecordingFontCapability,
  extractCustomProperty,
  readSansStack,
  verdictForInk,
} from "../scripts/recording-font-capability.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASELINE_MODULE = path.join(
  ROOT,
  "e2e/visual/support/page-baseline.ts",
);

/**
 * 两个方向上**实测**出来的墨迹读数（同一个容器、同一串 `--font-sans`，只换字体配置）：
 *   · 有 CJK 覆盖（系统装了文泉驿）：中文 2602 / 私用区 1307 ⇒ 中文有真字形；
 *   · 无 CJK 覆盖（`FONTCONFIG_FILE` 指向只含 DejaVu 的一份配置）：1314 / 1314
 *     ⇒ 中文与「缺字形」画成了同一个东西。
 * 用真读数而不是编数字：编的数字只能证明「我的公式自洽」，证明不了「它能分开这两台机器」。
 */
const INK_WITH_CJK_COVERAGE = { cjk: 2602, glyphless: 1307 };
const INK_WITHOUT_CJK_COVERAGE = { cjk: 1314, glyphless: 1314 };

describe("字体档判据：有无 CJK 覆盖两个方向", () => {
  it("有 CJK 覆盖时放过（中文的墨与「缺字形」的墨不同）", () => {
    expect(verdictForInk(INK_WITH_CJK_COVERAGE)).toBeNull();
  });

  it("无 CJK 覆盖时报红，且话术点名原因与动作", () => {
    const verdict = verdictForInk(INK_WITHOUT_CJK_COVERAGE);
    expect(verdict, "无 CJK 覆盖的机器必须被判出来").not.toBeNull();
    /* 话术要能回答「红的是什么」——这是这条判据存在的全部理由（此前那种红
       只报一堆中文块的 diff，`classifyFailure` 认不出、会把人引去改业务代码）。 */
    expect(verdict).toContain("没有任何字体覆盖中文");
    expect(verdict).toContain("私用区");
    /* 动作：换机器 / 装字体，不是放宽判据。 */
    expect(verdict).toContain("不要用这台机器录");
    expect(verdict).toContain("fc-list :lang=zh");
  });

  it("探针一个墨点都没读到时不冒充「合格」（最容易退化成假绿的一格）", () => {
    const verdict = verdictForInk({ cjk: 0, glyphless: 0 });
    expect(verdict).not.toBeNull();
    expect(verdict).toContain("没读出任何墨迹");
    /* 与「没有 CJK 覆盖」分开报：0 === 0 也会走进「相同」那支，但原因完全不同
       （探针没跑起来 ≠ 这台机器没字体），混成一句话会把人引去装字体。 */
    expect(verdict).not.toContain("没有任何字体覆盖中文");
  });
});

describe("判据的输入面从 globals.css 现读（不维护字族清单）", () => {
  it("`--font-sans` 读得到，且就是项目声明的那串栈", () => {
    const stack = readSansStack(ROOT);
    expect(stack, "读不到 --font-sans ⇒ 判据没有输入面").toBeTruthy();
    /* 判的是「它来自那份 CSS 的正文」，不是某个具体字族名 —— 换字族不该让本用例红。 */
    const css = readFileSync(
      path.join(ROOT, "src/app/globals.css"),
      "utf8",
    );
    expect(stack).toBe(extractCustomProperty(css, "--font-sans"));
  });

  it("缺 `--font-sans` 时报「判不了」而不是「这台机器不行」", () => {
    /* 用一次性夹具把「输入面坏了」这一支执行出来：它与「机器没字体」是两种故障，
       混成一句话会让人去装字体、而真正该修的是 CSS。 */
    const broken = path.join(ROOT, "tests/__fixtures__/no-font-stack");
    const verdict = checkRecordingFontCapability({
      root: broken,
      ink: INK_WITH_CJK_COVERAGE,
    });
    expect(verdict.error, "缺输入面必须报 error").not.toBeNull();
    expect(verdict.error).toContain("判据无法下结论");
  });

  it("判据里不出现任何具体字族名（出现就是把清单挪了个地方）", () => {
    const source = readFileSync(
      path.join(ROOT, "scripts/recording-font-capability.mjs"),
      "utf8",
    );
    /* 剥掉注释再判：文件头正在解释「为什么不用字族清单」，那里当然会提到族名。 */
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    for (const family of [
      "PingFang",
      "Microsoft YaHei",
      "Noto Sans SC",
      "Sarasa",
      "SF Mono",
      "Cascadia",
    ]) {
      expect(
        code,
        `判据代码里出现了字族名 ${family} —— 那正是会静默失效的那份清单`,
      ).not.toContain(family);
    }
  });
});

describe("探针样本的形状", () => {
  it("中文样本是中文、对照样本是私用区码位", () => {
    expect(CJK_PROBE_SAMPLE).toMatch(/^[\u4e00-\u9fff]+$/);
    /* 私用区（U+E000–U+F8FF）的定义就是「不分配给任何字符」，所以它是「保证没有字形的墨」
       这条基准线的天然形状，而不是一份要人维护的缺字表。 */
    for (const ch of GLYPHLESS_PROBE_SAMPLE) {
      const cp = ch.codePointAt(0) ?? 0;
      expect(
        cp >= 0xe000 && cp <= 0xf8ff,
        `对照码位 U+${cp.toString(16).toUpperCase()} 不在私用区`,
      ).toBe(true);
    }
    expect(GLYPHLESS_PROBE_SAMPLE.length).toBe(CJK_PROBE_SAMPLE.length);
  });
});

describe("判据接在 settle 上（判据存在 ≠ 判据有执行者）", () => {
  const source = () => readFileSync(BASELINE_MODULE, "utf8");

  it("settle 里调了字体档自检，且那是一次**真调用**不是注释 / 文档引用", () => {
    const settle = /export async function settle\([\s\S]*?\n\}/.exec(source());
    expect(settle, "settle 不见了 —— 本用例的前提没了").not.toBeNull();
    /* 判「真的被调用」而不是「出现过这个名字」：`settle` 里那段解释它的注释也含这个名字，
       按包含判会在**把调用注释掉之后照样绿**（实测过 —— 第一版就是这么写的）。
       所以剥掉注释再要求有一行以 `await expectRecordingFontCapability(` 开头。 */
    const code = (settle?.[0] ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("*") && !l.startsWith("//"));
    expect(
      code.some((l) => l.startsWith("await expectRecordingFontCapability(")),
      "settle 没**真的**调 expectRecordingFontCapability ⇒ 判据一行都不跑，像素档照样可能绿",
    ).toBe(true);
  });

  it("样本串与判据同源（不从 page-baseline 里另抄一份）", () => {
    const src = source();
    expect(src).toContain("CJK_PROBE_SAMPLE");
    expect(src).toContain("GLYPHLESS_PROBE_SAMPLE");
    /* 反向：源码里不该再出现一份字面量的中文样本 —— 抄一份就是 §12.12 的孪生对，
       而两侧漂了以后「判的样本」与「报出来的样本」会是两串不同的字。 */
    expect(
      /CJK_PROBE_SAMPLE\s*=\s*"/.test(src),
      "page-baseline.ts 里又定义了一份样本串",
    ).toBe(false);
  });
});
