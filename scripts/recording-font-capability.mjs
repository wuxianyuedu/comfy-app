#!/usr/bin/env node
/**
 * recording-font-capability.mjs — 「这台机器录得出来吗」的**字体档**能力上报（§11.8）。
 *
 * ## 它在治什么
 *
 * 基线文件名带**平台名**（`-linux.png` / `-win32.png`），于是「同一平台名 ⇒ 同一渲染」
 * 是个默认前提。实测这个前提不成立（ISSUE #1620）：同一个 linux 平台名下面，一个装了
 * CJK 字体的容器与另一个容器，跑**同一份 spec、同一份基线、同一份代码**差 1767 像素 ——
 * 差的是整页中文的**字形**（中文全走兜底，「模型库」渲染成「模型」，缺字形那一位不出墨）。
 * 而 `visual-baseline-pairing.test.ts` 只管仓库里那几套 PNG 的形态，`checkRecordingEnv`
 * 只管 `CI` 的真假 ⇒ webServer 口径。「这台机器能不能渲染出那一档基线记的那种字」
 * 此前**一条判据都没有**。
 *
 * ## 判据的形状：**不认字族名**，只问「这台机器给中文出墨吗」
 *
 * 上一版把这件事想成「列出基线需要哪几族字体、逐族判在不在」，而那条路走不通 ——
 * 三条都被实测堵死了：
 *
 *   ① **字族清单本身会静默失效**（§12.18 第二条）：「要哪几族」是与人手抄的、
 *      与 `globals.css` 各说各话的一份副本，改字体栈的人改不到它，红了最省事的
 *      动作是把名字删掉。
 *   ② **「声明的那几族」在健康机器上也常常不在**：`--font-sans` 里写着 `PingFang SC`
 *      （macOS）与 `Microsoft YaHei`（Windows），而**录 linux 档的那个容器永远不会有
 *      这两族** —— 它靠的是容器里装着的**别的** CJK 字体。所以「声明族不在 ⇒ 红」
 *      会把健康的录制环境判红。
 *   ③ **按族名量宽度分不出 CJK 覆盖**：实测同一串中文在 `PingFang SC` / `Noto Sans SC` /
 *      `WenQuanYi Zen Hei`（本机**真装了**）下宽度**全都是 120** —— CJK 的字宽是均匀的，
 *      量不出「这一族有没有这些字形」。同理 `document.fonts.check()` 对一个不存在的结果
 *      也返 `true`（它只回答「有没有还在加载的 webfont」）。
 *
 * 所以判据改问一个**不需要知道任何字族名**的问题：
 *
 *   「**同一串中文**在这台机器上出的墨，与**一串保证没有字形的码位**（Unicode 私用区
 *   `U+E000` 起）出的墨，一样吗？」
 *
 * 一样 ⇒ 中文与「缺字形」渲染成了同一个东西（都是豆腐块 / 都不出墨）⇒ **这台机器没有
 * CJK 覆盖**，中文全靠「缺字」在画。不一样 ⇒ 这台机器真有字给中文用。
 *
 * 这条判据**不含任何字族名、不含任何具体字体、也不含码位清单**（对照的私用区码位是
 * Unicode 语义上「不分配给任何字符」的一段，不是维护的名单）—— 改字体栈、换发行版、
 * 装不装某族，都不需要动它。两侧都从 `--font-sans` **现读**（那是栈的唯一定义处），
 * 所以它判的正是「这台机器配不配渲染这个项目的界面」。
 *
 * ⚠️ **它判的是「有没有 CJK 覆盖」，不是「与录制那台同不同字体」**：一个装了**任意**
 * CJK 字体（如文泉驿）的容器能出墨，9/10 张基线照样绿，唯独中文面积大的那张差 1767
 * 像素 —— 那种机器是本条**判不出来**的（它确实有 CJK 覆盖），本模块的文件尾「这一档
 * 不做」写清了这一点与它的归属。本条治的是更硬的那一档：**一个 CJK 字体都没有**的
 * 容器上，中文全靠缺字在画，而它跑出来的 diff 同样指不出是字体。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** 字体栈的唯一定义处（`--font-sans` / `--font-mono` / `--font-title` 都在这里）。 */
export const FONT_STACK_SOURCE = "src/app/globals.css";

/**
 * 探针用的**中文**样本 —— 界面真会渲染的那种长度。
 *
 * 用界面文案而不是人造罕见字：探针要回答的是「这一档的中文有没有字形」，一串精心
 * 挑的罕见字会红在用户永远看不到的地方。三个字也够长到让「缺字形」与「有字形」的
 * 墨迹量分得开（实测 2602 vs 1314）。
 */
export const CJK_PROBE_SAMPLE = "模型库";

/**
 * 对照码位：Unicode **私用区**起点的三个码位。
 *
 * 私用区的定义就是「不分配给任何字符、留给私用」，所以**任何**正常字体都不该有它们的
 * 字形 —— 它们是「保证没有字形的墨」这条基准线的天然形状，而不是一份要人维护的清单
 * （这正是它比「列一张缺字表」好的地方）。
 */
export const GLYPHLESS_PROBE_SAMPLE = "\u{E000}\u{E001}\u{E002}";

/**
 * 从 `globals.css` 抽出某个自定义属性的声明体（第一条匹配）。
 *
 * 只认自定义属性声明，不做完整 CSS 解析 —— 本模块只需要「这串栈长什么样」，
 * 而它是项目自己写的、形态稳定的一行。取不到时返回 `null`（调用方按「判不了」处理，
 * **不**静默当成空串 —— 空串会让探针判出假绿）。
 *
 * @param {string} css
 * @param {string} varName 形如 `--font-sans`
 * @returns {string | null}
 */
export function extractCustomProperty(css, varName) {
  const m = new RegExp(`${varName.replace(/[-]/g, "\\-")}\\s*:([^;]+);`).exec(
    css,
  );
  const body = m?.[1];
  if (!body) return null;
  const value = body.replace(/\s+/g, " ").trim();
  return value || null;
}

/**
 * 本模块要判的那串栈 —— **从 `globals.css` 现读**，不在别处另写一份（§12.12）。
 *
 * 只取 `--font-sans`：界面上的中文（标题、正文、按钮、筛选 chip）走的基本都是它
 * （`--font-title` 是 Few 处标题专用的增强档，缺它不影响「中文有没有字形」这个问题的
 * 答案 —— 而多判一档只多一处会漂的输入面）。
 *
 * @param {string} root
 * @returns {string | null}
 */
export function readSansStack(root) {
  const css = readFileSync(path.join(root, FONT_STACK_SOURCE), "utf8");
  return extractCustomProperty(css, "--font-sans");
}

/**
 * 判据本体：给定浏览器侧的两条墨迹读数，这台机器有没有 CJK 覆盖。
 *
 * @param {{cjk: number, glyphless: number}} ink
 *   `cjk` = 中文样本在同一串栈下的非透明像素数；
 *   `glyphless` = 私用区对照样本在同一串栈下的非透明像素数。
 * @returns {string | null} 无 CJK 覆盖时的话术，有覆盖返回 null
 */
export function verdictForInk({ cjk, glyphless }) {
  /* 空读数不当成「合格」—— 那是最容易退化成假绿的一格（探针没跑起来时
     两个数都是 0、而 0 === 0 会走进「相同」那支，报的却是「没有 CJK 覆盖」，
     话术对不上真实原因）。分开报，让人一眼看出是探针的问题。 */
  if (!(cjk > 0) && !(glyphless > 0)) {
    return (
      `字体探针没读出任何墨迹（cjk=${cjk} / glyphless=${glyphless}）—— 判据无法下结论。\n` +
      "      这通常意味着探针在字体就绪之前跑了，或 canvas 被跨域污染读不到像素。"
    );
  }
  /* 墨迹量相同 ⇒ 中文与「缺字形」画成了同一个东西。这是本条唯一的判据，
     且它不需要知道任何一个字族名。 */
  if (cjk !== glyphless) return null;
  return (
    "这台机器**没有任何字体覆盖中文** —— 界面上的中文全靠「缺字形」在画：\n" +
    `      同一串中文（「${CJK_PROBE_SAMPLE}」）与一串保证没有字形的码位` +
    `（Unicode 私用区 U+E000 起）在这串栈下出的墨**完全一样**（都是 ${cjk} 像素）——\n` +
    "      也就是说中文那几个字渲染出来的是「缺字」的形状，不是汉字的形状。\n" +
    "      ⇒ **不要用这台机器录 / 校验这一档的基线**：录出来的 PNG 里中文是缺字形，\n" +
    "      而它对外的名字是 `-<平台>.png`（平台名担保不了字体栈）。换一台与录制环境\n" +
    "      字体栈一致的机器，或先给这台装上能覆盖中文的字体（`fc-list :lang=zh` 是零代价的一问）。"
  );
}

/**
 * 一次性算完「读栈 + 判读数」的判决（`page-baseline.ts` 与用例共用）。
 *
 * @param {{root: string, ink: {cjk: number, glyphless: number}}} args
 * @returns {{verdict: string | null, error: string | null}}
 */
export function checkRecordingFontCapability({ root, ink }) {
  const stack = readSansStack(root);
  if (!stack) {
    return {
      verdict: null,
      error:
        `读不到字体栈（${FONT_STACK_SOURCE} 里缺 \`--font-sans\`）——\n` +
        "      判据无法下结论。它是字体栈的唯一定义处，缺它不是「这台机器不行」，\n" +
        "      而是判据的输入面坏了。",
    };
  }
  return { verdict: verdictForInk(ink), error: null };
}
