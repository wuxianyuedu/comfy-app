#!/usr/bin/env node
/**
 * `ci-log.mjs` — 门禁脚本与 CI 跑批**唯一的一行判决出口**（ISSUE #2506）。
 *
 * ## 它治的形态
 *
 * 同一个「跑批」里并排放着的判据，说同一件事时长得完全不一样（ISSUE #2506 的当场读数）：
 *
 *   ✓ 无零消费导出(§12.16;扫描 214 个模块)
 *   [cp936-glyph] 扫描面 1517 个文件：没有「CP936 编不出来且没登记」的字符
 *   [format] OK
 *   [重档] … ok 地基层零消费导出(硬闸)（162ms）
 *
 * 四种形状说一件事。更坏的是**跳过与判过在标签上逐字同形**：判据打印
 * 「暂存区是空的 ⇒ 这一批没有要判的东西」并退 0，跑批那边只能看见 `ok`——
 * 「我判了，是干净的」与「我没有判」于是不可区分。
 *
 * ## 三态（不是两态）
 *
 *   · **green** —— 判过了，且干净。`detail` 是那一句读数（扫了多少、命中 0 条）。
 *   · **skip**  —— **没有判**（暂存区空 / 改动面不适用）。`why` 是原因。
 *   · **red**   —— 判出来了，items 是逐条事实，`hint` 是下一动作。
 *
 * 口径与仓库既有的三态（`0` 绿 / `1` 红 / `2` 没跑起来，见 `premerge-check.mjs`）同族：
 * **「没判」不许读成「判过了」**。所以这里单独的 `skip` 一档，而不是让调用方自己
 * 在 detail 里塞一句中文再指望读者注意到。
 *
 * ## 判据为什么不必自己记「这一轮跳没跳过」
 *
 * `SKIP_MARKERS` 是一张**形状词表**：判据的 detail 里出现「暂存区是空的 / 没有要判的
 * 东西 / 按面未触及」这类句子时，`gatePass()` 自动降级成 `skip`。这不是猜语义 ——
 * 这几个句子在本仓是**同一个意思的固定说法**（判据自己在那一支里就是这么写的），
 * 而让人人有记着「这一轮该打 skip」正是下一个漂移的来源。
 *
 * ## 渲染（可读性最强的那一形）
 *
 * 一行一条判决，前缀 4 格给花括号路径，三态共用同一列结构：
 *
 *   [ok]   脚本名 · 对象（读数）
 *   [skip] 脚本名 · 对象（原因）
 *   [红]   脚本名 · 对象（命中 N 条）+「下一动作：…」+ 逐条证据
 *
 * 前缀**只用 ASCII**（「」【】是 CP936 能编的，但 `[ok] → [红]` 两格宽度不一致时
 * 小屏与等宽终端都会错位；更关键的是红色那一档要能被读者的眼睛第一时间抓住，
 * 而 `red` 这个英文词在中文句子中间并不比「红」更难认）。字面量里的 `·`（U+00B7）
 * 与 `→`（U+2192）都在 CP936 里，见 `scripts/ci-cp936-glyphs.mjs`。
 *
 * ## 第二层：颜色（ISSUE #2506 的后半句「提高可读性，还有什么手段都用上」）
 *
 * 三态靠前缀分得开，但**同一屏上十几条判决全是同一种灰**时，眼睛仍然要先读字才知道
 * 哪一条是红的。所以这一层还管颜色 —— 而且只有一处口径：`paint()` / `bandLine()`。
 *
 * 颜色的三条边界（缺一条就会变成「本地好看、平台一堆乱码」）：
 *
 *   · **色号只取 CP936 编得出来的 ASCII 那一段**（SGR 序列本身全是 `\x1b[0;32m` 这种
 *     纯 ASCII）。`ci-cp936-exit.mjs` 那一跳把每个字节按 936 重发，纯 ASCII 字节在 936
 *     里**逐字节等价** ⇒ 颜色码原样穿过转码、不会被改写成问号。这条也由
 *     `tests/ci-log.test.ts` 判：**着色后的字符串去掉色号必须逐字等于不着色的那一份**
 *     （着色不许动内容）。
 *   · **`NO_COLOR` / 非 TTY 一律不着色**（no-color.org 的通行约定）。判据是
 *     `colorEnabled()` —— 它**不在这里被调用**：本文件是纯排版，编排层（`gatePass` /
 *     `gateSkip` / `gateFail` 的默认 `out`）才决定「这一轮要不要上色」。
 *     重定向到文件 / 被别的脚本抓输出时不着色，抓出来的仍是那行干净文本
 *     （`ci-heavy-gates.mjs` 就靠这个读回绿步的结论句）。
 *   · **颜色是附加，不是判决**：删掉所有色号，三态仍然分得开（前缀 + 结构）。
 *     「看不清红」这件事不许只能靠颜色解决。
 *
 * ## 边界
 *
 *   · **不判任何东西**：它只负责把调用方已经得出的结论排版。判据、退出码、账本
 *     一件都没变 —— 这一层改的是「读得出来」，不是「判得对」；
 *   · **不写 `log/`**：这是一层 stdout 排版，落盘是日志系统（`src/lib/log/**`）的事。
 */

/** 前缀：三态共用一列，宽度固定到 6 格（`[skip]` 最长）。 */
export const TAGS = {
  ok: "[ok]",
  skip: "[skip]",
  red: "[红]",
};

/**
 * 三态各自的颜色（SGR 参数）——**只有一处口径**，`paint()` 与 `bandLine()` 都读它。
 *
 * 选用 16 色而不是 256 色 / RGB：平台日志页与本地终端对扩展色的支持参差，而
 * 基本 8 色在这两类宿主上都稳定。红用**亮红加粗**（`1;31`）而不是普通红 ——
 * 这一屏上「红」是唯一的下一动作信号，它必须有重量上的差别，不只靠色相。
 *
 * 键与 `TAGS` 逐一同名：判决行的前缀认得出是哪一态，就用同一格颜色，
 * 「前缀 ⇄ 颜色」不存在第二张表。
 */
export const COLORS = {
  ok: "32",
  skip: "90",
  red: "1;31",
};

/**
 * 三态。`@typedef` 是给 `tsc --noEmit`（含 `checkJs`）看的：三个动词的回值、
 * `stateOfLine()` 的回值、`renderTally()` 的 `color` 都只能取这三个字面量。
 *
 * @typedef {"ok" | "skip" | "red"} State
 */

/** 判据自己的那类标签（不是判决）——`[info]` 用青，`[warn]` 用黄。 */
const COLOR_LABEL = "36";

/**
 * 三态前缀 ⇄ 色号。`bandLine()` 靠它在**任意一行**上认出「这是哪一态」——
 * 判据自己的结论行（`[cp936] OK` / `[docs-api] √ …`）与跑批转述的判决行都能认。
 */
/** @type {Record<string, string>} */
const TAG_COLORS = {
  [TAGS.ok]: COLORS.ok,
  [TAGS.skip]: COLORS.skip,
  [TAGS.red]: COLORS.red,
  "[warn]": "33",
  "[info]": COLOR_LABEL,
};

/**
 * 带内容的 `[标签]` 与「空标签」`[ ]`（色带里的无标签行留白用）。
 *
 * 中括号里可以是空的：色带每一行都有一格标签位，没有标签的行留空 —— 这样
 * 「标签列」在整块日志里是**一条竖线**，读者的眼睛能顺着它往下扫。
 */
const TAG_RE = /\[([^\[\]\s]{1,12})\]/g;

/** 色带外层的空白与竖线色。 */
const COLOR_BAND = "90";

/**
 * 这一轮要不要上色。
 *
 * 两条都成立才上色，缺一条就不上：`NO_COLOR`（no-color.org 的通行约定，值不论）
 * 与**非 TTY**（被重定向 / 被别的脚本抓输出 / 平台抓 stage 输出）。
 * 后者是这一层能安全存在的前提 —— `ci-heavy-gates.mjs` 就是**抓输出读回**判据结论的，
 * 那一路拿到的必须是干净文本，否则它的 90 字压缩与「截断报数」都会把色号算进字数。
 *
 * @param {{env?: Record<string, string | undefined>, isTTY?: boolean}} [io]
 * @returns {boolean}
 */
export function colorEnabled({ env = process.env, isTTY } = {}) {
  if (env.NO_COLOR !== undefined) return false;
  if (env.FORCE_COLOR !== undefined) return true;
  return isTTY ?? Boolean(process.stdout.isTTY);
}

/**
 * 给一行上色。`enabled` 为假时**原样返回**（一个字节都不多）。
 *
 * @param {string} text
 * @param {string} code SGR 参数（`"32"` / `"1;31"` / `"90"`）
 * @param {boolean} enabled
 * @returns {string}
 */
export function paint(text, code, enabled) {
  if (!enabled || !text) return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

/**
 * 色带：给**整行**加一条与三态同色的背景竖线（`▌`，U+258C，CP936 有字形）。
 *
 * 为什么是竖线而不是整行背景色：整行着色会把**缩进结构**（证据缩 4 格、下一动作缩 6 格）
 * 压平 —— 那是上一条判决用结构换来的可读性，不能被颜色吃掉。左侧一条竖线既让「红的那
 * 一块」在滚动时一眼定位，又不碰行内任何一格。
 *
 * 颜色取自**三态**（`[ok]` 绿 / `[skip]` 灰 / `[红]` 亮红）或那一行自己的标签色；
 * 两者都认不出 ⇒ 中性灰。刻意**不让上一行的颜色延续到下一行**：混进日志里的第三方
 * 输出（vitest / prettier / PowerShell）本来就不该被染成上一条判决的颜色 ——
 * 那会让人以为它是那段证据的一部分。
 *
 * @param {string} line 已定稿的一行（可以已上过色）
 * @param {{enabled?: boolean, color?: string}} [options]  `color` 不给时按标签自认
 * @returns {{line: string, color: string}}
 */
export function bandLine(line, { enabled = true, color } = {}) {
  const own = color ?? tagColorOf(line) ?? COLOR_BAND;
  if (!enabled) return { line, color: own };
  return { line: `${paint("▌", own, true)} ${line}`, color: own };
}

/**
 * 一行里第一个认得出的标签决定了这一行的色带颜色（认不出 ⇒ `null`）。
 *
 * @param {string} line 原文（**未上色**）
 * @returns {string | null}
 */
export function tagColorOf(line) {
  for (const m of String(line ?? "").matchAll(TAG_RE)) {
    const key = `[${m[1]}]`;
    if (TAG_COLORS[key]) return TAG_COLORS[key];
  }
  return null;
}

/**
 * 给**一行已有文本**上色：认得出三态前缀的整行按那一态着色，认不出的只给标签上色。
 *
 * 这一条治的是「判据自己写的那几行」：它们不走 `gatePass` / `gateSkip` / `gateFail`
 * （过程读数、中间进度、`[docs-api] 命中输入面 3 个文件`），从前整片同一种灰。
 * 现在它们的标签带色、结论行按三态带色，读者不必逐字读就知道这一行是什么。
 *
 * @param {string} line
 * @param {boolean} [enabled]
 * @returns {string}
 */
export function colorizeLine(line, enabled = true) {
  const text = String(line ?? "");
  if (!enabled || text === "") return text;
  const state = stateOfLine(text);
  if (state) return paintByState(text, state);
  return text.replace(TAG_RE, (whole, word) => {
    const code = TAG_COLORS[whole];
    return code && word ? paint(whole, code, true) : whole;
  });
}

/**
 * 整行按三态着色、只染标签 —— 两档颜色出口的唯一实现。
 *
 * @param {string} text 原文
 * @param {("ok" | "skip" | "red") | null} state
 * @returns {string}
 */
function paintByState(text, state) {
  if (!state) return text;
  return paint(text, COLORS[state], true);
}

/**
 * 这一行是哪一态？（认不出 ⇒ `null`）
 *
 * @param {string} line
 * @returns {State | null}
 */
export function stateOfLine(line) {
  const text = String(line ?? "").trimStart();
  if (text.startsWith(TAGS.ok)) return "ok";
  if (text.startsWith(TAGS.skip)) return "skip";
  if (text.startsWith(TAGS.red)) return "red";
  /* 判据自己的话：`✓`（CP936 有字形的是 `√`，`ci-cp936-glyphs.mjs` 会换）
   * 与 `OK` 结尾的结论行按绿算，`×` / `✗` / 「失败」「不合规」按红算。
   * 这一档只影响颜色，**不产生判决** —— 认错了最多是颜色不明显。 */
  if (/^\[warn\]/.test(text)) return null;
  if (/^[√✓]|\bOK\b/.test(text)) return "ok";
  if (/^[×✗]|失败|不合规|违规/.test(text)) return "red";
  return null;
}

/**
 * 收尾清单 —— 一次跑批在**最后**把自己这一轮的账念成一块。
 *
 * ## 它治的是哪一件事
 *
 * 三态解决了「一条一行」，但一屏几十条之后，读者仍要**逐行扫**才知道「这一轮到底
 * 有没有事」。判据的账（红几条 / 跳过几条）此前只在编排层的一句「合计」里出现过，
 * 而那句话长得和别的读数一样。
 *
 * ## 形状（三条都编码了判断）
 *
 *   · **末行必念总账**：`合计 12 条：判过 9、没判 2、红 1` —— 一句话回答「这一轮要不要
 *     停下来看」，而三个数就是上面三态的数量。红在里面时整行按红处理；
 *   · **红逐条点名**：只点名字（不点证据 —— 证据在上面各自那一块里），一条一行。
 *     红的那一块是读者要回滚回去看的地方，名单让他知道要回滚几次；
 *   · **没判也逐条点名**：跳过**不是**判过。它不出现在红名单里，也绝不可以被折叠进
 *     「判过」那一格里数掉 —— 那正是 ISSUE #2506 要治的病在汇总层的最后一站。
 *
 * @param {{ok?: string[], skip?: string[], red?: string[]}} tally 三态各自的对象名
 * @param {{enabled?: boolean}} [options]
 * @returns {{line: string, color: string}}  `color` = 这一块该用的色带色（供调用方沿用）
 */
export function renderTally(tally, { enabled = true } = {}) {
  const ok = (tally?.ok ?? []).filter((x) => String(x ?? "").trim());
  const skip = (tally?.skip ?? []).filter((x) => String(x ?? "").trim());
  const red = (tally?.red ?? []).filter((x) => String(x ?? "").trim());
  const total = ok.length + skip.length + red.length;
  const state = red.length > 0 ? "red" : skip.length > 0 ? "skip" : "ok";
  const head =
    `${TAGS[state]} 合计 ${total} 条：判过 ${ok.length}、` +
    `没判 ${skip.length}、红 ${red.length}`;
  const lines = [head];
  for (const name of red)
    lines.push(`      ${paint("红", COLORS.red, enabled)}  ${name}`);
  /* 跳过的那几条用「没判」而不是「跳过」念：词要说明后果（它没有结论），
   * 而「跳过」在中文里读起来像「故意不做」，容易被当成放行。 */
  for (const name of skip) {
    lines.push(`      没判  ${name}`);
  }
  return { line: lines.join("\n"), color: COLORS[state] };
}

/**
 * 「这一轮没有判」的固定说法（`gatePass()` 据此把 green 降级成 skip）。
 *
 * 每一条都摘自判据自己那一支的原话 —— 新增说法时**先改那些判据的措辞**，
 * 再把新说法加进来：这张表的价值是「同一件事只有一种说法」。
 */
export const SKIP_MARKERS = [
  "暂存区是空的",
  "没有要判的东西",
  "按面未触及",
  "没有要判的",
  "本次没有命中扫描面",
  "跳过（未触及",
];

/**
 * `detail` 是不是一句「这一轮没判」的话。
 *
 * @param {string} [detail]
 * @returns {boolean}
 */
export function looksSkipped(detail) {
  const s = String(detail ?? "");
  return SKIP_MARKERS.some((m) => s.includes(m));
}

/**
 * 把逐条证据排成缩进行。
 *
 * 证据的每一行都缩 4 格（与上面那条判决的前缀列对齐）：这样一份红在里面
 * 一眼能看出「哪一行是判决、哪几行是证据」。空项与纯空白行丢掉 —— 它们是排版
 * 噪声，而红的那一屏最怕噪声。
 *
 * @param {Array<string | number>} items
 * @param {number} [width] 缩进格数
 * @returns {string[]}
 */
export function indentItems(items, width = 4) {
  const pad = " ".repeat(width);
  return (items ?? [])
    .map((item) => String(item ?? ""))
    .filter((line) => line.trim() !== "")
    .map((line) => pad + line);
}

/**
 * 渲染一条判决（纯函数，不碰 stdout —— 这样它才能被单测逐字判）。
 *
 * @param {object} verdict
 * @param {"ok"|"skip"|"red"} [verdict.state] 不给时按 `items` / `detail` 推
 * @param {string} [verdict.gate] 判据名（人读的那一个，例如「函数长度」）
 * @param {string} [verdict.subject] 对象 / 范围（例如「src/**」），可省
 * @param {string} [verdict.detail] 绿那一档的读数，或 skip 那一档的原因
 * @param {string} [verdict.hint] 红的下一动作（可多行，逐行缩进）
 * @param {Array<string | number>} [verdict.items] 红的逐条证据
 * @param {number} [verdict.max] 证据最多打几条（超出写「另有 N 条」）
 * @returns {string[]} 要打印的行（第一行是判决本身）
 */
export function renderVerdict({
  state,
  gate,
  subject,
  detail,
  hint,
  items,
  max = 40,
}) {
  const list = (items ?? [])
    .map((x) => String(x ?? ""))
    .filter((x) => x.trim());
  const resolved =
    state ?? (list.length > 0 ? "red" : looksSkipped(detail) ? "skip" : "ok");
  /* 红的默认读数是**条数**（`命中 N 条`）：读者第一眼要的是「有几处」，
   * 逐条证据在下面几行。调用方给了自己的读数就用它的（例如「超过 400 行 2 个」）。 */
  const resolvedDetail =
    resolved === "red" && !String(detail ?? "").trim()
      ? summarize(list)
      : detail;
  const head = [gate, subject].filter((s) => s && String(s).trim()).join(" · ");
  const tail = String(resolvedDetail ?? "").trim();
  const out = [`${TAGS[resolved]} ${head}${tail ? `（${tail}）` : ""}`];

  if (resolved === "red") {
    if (hint && String(hint).trim()) {
      for (const line of String(hint).split("\n")) {
        out.push(`      → ${line.trim()}`);
      }
    }
    const shown = max > 0 ? list.slice(0, max) : list;
    out.push(...indentItems(shown));
    if (max > 0 && list.length > max) {
      out.push(
        `    …另有 ${list.length - max} 条未展开（共 ${list.length} 条）`,
      );
    }
  }
  return out;
}

/**
 * 打一条判过且干净的判决。
 *
 * `detail` 里带「这一轮没判」的说法时**自动降级成 skip**（见 `SKIP_MARKERS`）：
 * 判据不必自己记着该打哪一档。
 *
 * @param {string} gate 判据名
 * @param {string} [detail] 读数（扫了多少 / 命中 0 条）
 * @param {{subject?: string, out?: (line: string) => void}} [options]
 * @returns {"ok" | "skip"} 实际打出来的那一档
 */
export function gatePass(gate, detail, options = {}) {
  const state = looksSkipped(detail) ? "skip" : "ok";
  emit(
    renderVerdict({ state, gate, subject: options.subject, detail }),
    options,
  );
  return state;
}

/**
 * 打一条「这一轮没有判」的判决（暂存区空 / 改动面不适用）。
 *
 * @param {string} gate 判据名
 * @param {string} why 没判的原因
 * @param {{subject?: string, out?: (line: string) => void}} [options]
 * @returns {"skip"}
 */
export function gateSkip(gate, why, options = {}) {
  emit(
    renderVerdict({
      state: "skip",
      gate,
      subject: options.subject,
      detail: why,
    }),
    options,
  );
  return "skip";
}

/**
 * 打一条判出问题的判决。
 *
 * @param {string} gate 判据名
 * @param {Array<string | number>} items 逐条事实（文件:行 / 名字 / 读数）
 * @param {{subject?: string, detail?: string, hint?: string, max?: number, out?: (line: string) => void}} [options]
 * @returns {"red" | "ok"} `ok` = 清单是空的 ⇒ 一条都没打（见下面那段）
 */
export function gateFail(gate, items, options = {}) {
  /* 没有证据就不打判决：反过来就是屏幕上出现一条「命中 0 条」的红，读的人第一动作
   * 是去找那 0 条在哪。调用点该做的是「先判，再打」。 */
  if ((items ?? []).filter((x) => String(x ?? "").trim()).length === 0) {
    return "ok";
  }
  emit(
    renderVerdict({
      state: "red",
      gate,
      subject: options.subject,
      detail: options.detail ?? summarize(items),
      hint: options.hint,
      items,
      max: options.max,
    }),
    options,
  );
  return "red";
}

/**
 * 红的默认读数：`命中 N 条`（调用方给了自己的 `detail` 就用它的）。
 *
 * @param {Array<unknown>} [items]
 * @returns {string}
 */
export function summarize(items) {
  const n = (items ?? []).filter((x) => String(x ?? "").trim()).length;
  return n === 1 ? "命中 1 条" : `命中 ${n} 条`;
}

/**
 * 把渲染好的几行交给 `out`。
 *
 * **上色与色带只在这一处发生**：`renderVerdict()` 等是纯函数（判据与测试都逐字比它），
 * 而「要不要上色」是一个关于宿主的判断（TTY / `NO_COLOR`），两者不能混在一起。
 * 调用方给了自己的 `out`（测试、以及 `ci-heavy-gates.mjs` 那种要抓回文本的场景）⇒
 * **整行原样交出去，不着色、不加色带** —— 抓回去的仍是那一行干净文本。
 *
 * @param {string[]} lines
 * @param {{out?: (line: string) => void, color?: boolean, band?: boolean}} [options]
 *   `color` 省略 ⇒ 按 `colorEnabled()` 判；`band` 省略 ⇒ 与 `color` 同值。
 */
function emit(lines, options = {}) {
  const write = options.out;
  if (write) {
    for (const line of lines) write(line);
    return;
  }
  const enabled = options.color ?? colorEnabled();
  const band = options.band ?? enabled;
  for (const line of lines) {
    /* 多行内容（`renderTally()` 的那一块）按 `\n` 拆成行重新上色 —— 一行一条，
     * 每一行都要有自己的竖线，否则那一块会在中间「断掉」。 */
    for (const one of String(line).split("\n")) {
      const colored = colorizeLine(one, enabled);
      const banded = bandLine(colored, { enabled: band });
      process.stdout.write(`${banded.line}\n`);
    }
  }
}
