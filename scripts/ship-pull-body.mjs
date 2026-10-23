/**
 * PR 正文那一格的组成：碎片清单 + 改动量摘要（ISSUE #2248）。
 *
 * 拆的是职责，不是行数凑数：这一格只回答「发给平台的正文长什么样」，它零依赖
 * `ship-core`，反向由 `ship-platform` 取用（`buildPullBody` 与那两个数只在
 * 这一条链上被消费）。首行的读法仍只有一处 —— `fragmentHead` 来自
 * `ship-ticket.mjs`，PR 正文与「单子」那一行读数共用同一个实现。
 *
 * 承重数值入账：`PULL_BODY_LIMIT` / `DIFFSTAT_SAMPLE_MAX` 登记在
 * `scripts/.gate-thresholds.json`（口径见规范 §13.5.26）。
 */
import { commentHeader, fragmentHead } from "./ship-ticket.mjs";

/**
 * 平台对 PR 正文的硬上限。取自平台自己的那句拒绝（实测 `errcode 2000003` ·
 * `body length exceeded the limit 65,535`，ISSUE #2248）—— 它是**外部的量纲**，
 * 不是可调松紧的阈值：正文超过它，PR 就建不出来。
 */
export const PULL_BODY_LIMIT = 65_535;

/**
 * `git diff --stat` 的逐行明细最多留几条。
 *
 * 正文是**摘要**、不是**清单**：diffstat 的行数与改动面成正比（#2231 那次 2673 行 /
 * 166324 字节），而正文有上面那个硬上限 —— 不封顶时「改动面大」这一件事本身就足以让
 * PR 建不出来，且红的形态是「建不出 PR」而不是「这次改动有问题」。
 * 总计数行一定留下；被省略的条数在正文里**说出来**（不许静默截断）。
 */
export const DIFFSTAT_SAMPLE_MAX = 40;

/**
 * 把一份 diffstat 裁成「样本 + 总计数行 + 一句省略说明」。
 *
 * @param {string} diffstat `git diff --stat` 的原文
 * @param {number} [sampleMax] 逐行明细最多留几条
 * @returns {{text: string, listed: number, omitted: number, total: number, note: string}}
 *   `total` 是逐行明细一共有几条（不含总计数行），`listed + omitted === total` 恒成立
 */
export function capDiffstat(diffstat, sampleMax = DIFFSTAT_SAMPLE_MAX) {
  const lines = String(diffstat ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  /* 末行是总数那一行（` 2673 files changed, 1 insertion(+), …`）。它必须留下：
   * 被裁之后，「这次到底动了多少」是读者唯一还能直接拿到的量。 */
  const last = lines[lines.length - 1] ?? "";
  const hasTotal =
    lines.length > 0 && /\b\d[\d,]* files? changed\b/.test(last);
  const totalLine = hasTotal ? last : "";
  const fileLines = hasTotal ? lines.slice(0, -1) : lines;
  const listed = Math.max(0, Math.min(fileLines.length, sampleMax));
  const kept = fileLines.slice(0, listed);
  const omitted = fileLines.length - kept.length;
  const text = (totalLine ? [...kept, totalLine] : [...kept]).join("\n");
  return {
    text: text || "(空)",
    listed: kept.length,
    omitted,
    total: fileLines.length,
    note:
      omitted > 0
        ? `> 上面只列了逐行明细的**前 ${kept.length} 条**（共 ${fileLines.length} 条）：另有 ${omitted} 条未列出，因为 PR 正文有长度上限、而 diffstat 的行数与改动面成正比 —— 这一格必须是摘要。逐行清单在平台的「文件」那格看得到，总计数行在上面。`
        : "",
  };
}

/**
 * 把 `changelog.d/` 里的碎片标题拼成 PR 正文的**事实部分**。
 *
 * 只搬「盘上已有的字」：段落标题 + 碎片文件名。不写因果、不写「已验证」那类声明
 * （`check-commit-claims.mjs` 会拿提交树复核句式，而 PR 正文迟早会被抄进合并信息）。
 *
 * ⚠️ diffstat 那一段**必须经过 `capDiffstat`**：原样贴进去会让「改动面一大」直接
 * 变成「PR 建不出来」（ISSUE #2248）。装不下时样本数继续减半，所以
 * 「正文长度与改动面无关」是**做出来的**，不是「40 条大概够用」的乐观假设。
 *
 * @param {{root:string,fragments:string[],diffstat:string,handle?:string|null}} input 量到的事实
 *   与这一跑的留痕短名（ISSUE #2204：正文开头一行 `**[评论人：<短名>]**`，未配写「未配」）
 * @returns {string} 正文
 */
export function buildPullBody({ root, fragments, diffstat, handle = null }) {
  const head = [
    commentHeader(handle),
    "",
    "## 本 PR 带的变更碎片（`changelog.d/`）",
    "",
  ];
  for (const f of fragments) {
    // 首行的读法只有一处（`fragmentHead`）：两处各读各的，就会开始对同一份碎片给两种答案。
    head.push(`- \`${f}\` → ${fragmentHead(root, f) || "(读不到)"}`);
  }
  head.push("");
  const tail = [
    "> 本段由 `pnpm ship` 拼装，内容全部是它当场量到的事实（碎片标题与 diffstat）。",
    "> 判断、读数与因果请写在下面的正文里 —— 脚本不代写；开头那行「评论人」只是" +
      "这一跑的留痕，不是对正文的判断背书。",
  ];
  let sampleMax = DIFFSTAT_SAMPLE_MAX;
  for (;;) {
    const capped = capDiffstat(diffstat, sampleMax);
    const body = [
      ...head,
      "## 改动量（`git diff --stat` 对上游）",
      "",
      "```",
      capped.text,
      "```",
      "",
      ...(capped.note ? [capped.note, ""] : []),
      ...tail,
    ].join("\n");
    if (body.length <= PULL_BODY_LIMIT || sampleMax === 0) return body;
    sampleMax = Math.floor(sampleMax / 2);
  }
}
