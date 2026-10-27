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
 * ## 边界
 *
 *   · **不判任何东西**：它只负责把调用方已经得出的结论排版。判据、退出码、账本
 *     一件都没变 —— 这一层改的是「读得出来」，不是「判得对」；
 *   · **不做颜色**：平台日志页与本地终端对 ANSI 的处理并不一致，而 CP936 转码那一跳
 *     （`ci-cp936-exit.mjs`）会让颜色码变成乱码字节。可读性靠结构与措辞，不靠颜色；
 *   · **不写 `log/`**：这是一层 stdout 排版，落盘是日志系统（`src/lib/log/**`）的事。
 */

/** 前缀：三态共用一列，宽度固定到 6 格（`[skip]` 最长）。 */
export const TAGS = {
  ok: "[ok]",
  skip: "[skip]",
  red: "[红]",
};

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
 * @param {string[]} lines
 * @param {{out?: (line: string) => void}} options
 */
function emit(lines, options) {
  const out = options.out ?? ((line) => process.stdout.write(`${line}\n`));
  for (const line of lines) out(line);
}
