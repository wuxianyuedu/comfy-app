/**
 * PR 正文那一格的组成：碎片清单 + **碎片正文原文** + 改动量摘要（ISSUE #2248 / #3360）。
 *
 * 拆的是职责，不是行数凑数：这一格只回答「发给平台的正文长什么样」，它零依赖
 * `ship-core`，反向由 `ship-platform` 取用（`buildPullBody` 与那几个数只在
 * 这一条链上被消费）。首行与正文的读法仍只有一处 —— `fragmentHead` / `fragmentBody`
 * 来自 `ship-ticket.mjs`，PR 正文与「单子」那一行读数共用同一个实现。
 *
 * 为什么把碎片正文照录进来（ISSUE #3360）：`changelog.d/` 那份碎片里写着的才是
 * 「这次具体改了什么」（根因、改动、代价、用例），而 PR 正文此前只搬了**文件名 +
 * 段落标题**，读者在 PR 概览里看到的只有「哪个文件、属于 Added 还是 Fixed」，细节
 * 得点进「文件」那一格自己翻。正文是盘上已有的字，不是脚本生成的因果句 —— 照搬不
 * 违反「PR 正文只填它量到的」（`check-commit-claims.mjs` 复核的是推断句）。
 *
 * 承重数值入账：`PULL_BODY_LIMIT` / `DIFFSTAT_SAMPLE_MAX` / `FRAGMENT_BODY_BUDGET`
 * 登记在 `scripts/.gate-thresholds.json`（口径见规范 §13.5.26）。
 */
import { fragmentBody, fragmentHead, withCommentHeader } from "./ship-ticket.mjs";

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
 * 碎片正文原文整体占多少字节预算（占平台硬上限的一部分）。
 *
 * 碎片是随 PR 一起写的发布说明：单份几百到几千字节常见，历史最大的一份 33KB。
 * 留 3/4 上限给它，diffstat 摘要、清单、署名与尾巴用剩下的 1/4；超预算时不是「建不出
 * PR」，而是**降级**：按字节预算逐份贴满、装不下的整份省略，并把省了什么**念出来**
 * （与 `capDiffstat` 同一条纪律：静默截断就是量具说谎）；预算减到 0 就退回「只留标题清单」。
 * 正文按 `Buffer.byteLength(…, "utf8")` 量：平台拒的是字节数，中文按 `.length` 会低估。
 */
export const FRAGMENT_BODY_BUDGET = 48_000;

/**
 * `--pr-body-file` 在 `--dry-run` 计划里的那一组命令（复用已有 PR 时才会发生）。
 *
 * 与 `post-pull` 成组出现：写后回读是这一格的**一半**，只写「更新」会把
 * 「回执即结论」教给读计划的人。放在这里而不是 `ship-core`：`planCommands` 那一段
 * 已经贴着 900 行硬闸，而这一组命令的描述属于「PR 正文」这一格。
 *
 * @param {string} slug `owner/repo`
 * @returns {string[]} 计划行
 */
export function prBodyPlanLines(slug) {
  return [
    `cnb pulls patch-pull --repo ${slug} --number <n> --body-file <git目录>/comfy-ship-tmp/ship-pr-body-<pid>.tmp -v`,
    `cnb pulls get-pull --repo ${slug} --number <n> -v`,
  ];
}

/**
 * 把一份 diffstat 裁成「样本 + 总计数行 + 一句省略说明」。
 *
 * @param {string} diffstat `git diff --stat` 的原文
 * @param {number} [sampleMax] 逐行明细最多留几条
 * @returns {{text: string, listed: number, omitted: number, total: number, note: string}}
 *   `total` 是逐行明细一共有几条（不含总计数行），`listed + omitted === total` 恒成立
 */
export function capDiffstat(diffstat, sampleMax = DIFFSTAT_SAMPLE_MAX) {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- diffstat 是 git diff --stat 的原文（外部数据），string 只是声明
  const lines = String(diffstat ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  /* 末行是总数那一行（` 2673 files changed, 1 insertion(+), …`）。它必须留下：
   * 被裁之后，「这次到底动了多少」是读者唯一还能直接拿到的量。 */
  const last = lines.at(-1) ?? "";
  const hasTotal = lines.length > 0 && /\b\d[\d,]* files? changed\b/.test(last);
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
 * 一份碎片在 PR 正文里贴出来的原文小节（标题 + 引用块里的正文）。
 *
 * 贴的是**去掉首行段落标题之后的全部文字**：标题已经在上面「清单」那一行念过，
 * 这里再写一遍会让人以为有两份碎片。整段用引用块包起来，与脚本自己写的说明分开。
 *
 * @param {string} rel 碎片相对路径
 * @param {string} text `fragmentBody` 读到的正文（已 trim）
 * @returns {string[]} 正文行
 */
function fragmentSection(rel, text) {
  return [`### \`${rel}\``, "", ...text.split("\n").map((line) => (line ? `> ${line}` : ">")), ""];
}

/**
 * 把各份碎片的原文按字节预算裁成「能贴几份贴几份」。
 *
 * 与 `capDiffstat` 一样是**摘要**，但裁的单位是「整份碎片」而不是行：截断半份碎片
 * 会把一条改动的后半句截掉，读者拿到的比不贴还糟。超预算时保留前面的整份，
 * 省掉的份数在 note 里点名；预算减到 0 仍装不下 ⇒ 一份都不贴、整节退回旧形态。
 *
 * @param {{root:string,fragments:string[]}} input 碎片清单
 * @param {number} budget 字节预算
 * @returns {{lines:string[], listed:number, omitted:number, total:number, note:string}}
 */
export function capFragmentBodies({ root, fragments }, budget = FRAGMENT_BODY_BUDGET) {
  /** @type {{rel:string,lines:string[],bytes:number}[]} */
  const docs = [];
  for (const rel of fragments) {
    const text = fragmentBody(root, rel);
    if (text) {
      const lines = fragmentSection(rel, text);
      docs.push({ rel, lines, bytes: Buffer.byteLength(lines.join("\n"), "utf8") });
    }
  }
  const total = docs.length;
  let bytes = 0;
  let listed = 0;
  for (const doc of docs) {
    // 每份碎片自带一个空行结尾，相邻两份之间那一个空行不重复计；用 1 字节容差足够。
    const next = bytes + doc.bytes + 1;
    if (next > budget) {
      break;
    }
    bytes = next;
    listed += 1;
  }
  const omitted = total - listed;
  const note =
    omitted > 0
      ? `> 碎片原文只贴了**前 ${listed} 份**（共 ${total} 份）：另有 ${omitted} 份因 PR 正文有字节上限未贴，按整份省略。完整内容在平台的「文件」那格或 \`changelog.d/\` 里看得到。`
      : "";
  return { lines: docs.slice(0, listed).flatMap((d) => d.lines), listed, omitted, total, note };
}

/**
 * 用字节量一份 PR 正文（平台拒的是字节数，不是字符数）。
 *
 * `.length` 数的是 UTF-16 码元：中文一字算 1，而平台上算 3 字节 —— 拿它判
 * `PULL_BODY_LIMIT` 会在纯中文正文上低估到三分之一，发出的正文被平台拒而本地说「在上限内」。
 *
 * @param {string} text 正文
 * @returns {number} UTF-8 字节数
 */
function bodyBytes(text) {
  return Buffer.byteLength(text, "utf8");
}

/**
 * 注入正文里有没有「单条 PR 自己关单」的写法（`Closes …`）。
 *
 * 项目的关单是**统一动作**（合并验真之后由 `--close-issue` 收，§13.10.9），单条 PR
 * 不该在正文里顺带关单 —— 那一笔画在别的字段上，而 PR 正文里的 `Closes` 既没有
 * 执行者、又会让「谁关的、什么时候关的」对不上账。这里**只认、不改写**：原文照旧
 * 注入，人自己决定要不要删（脚本替人改正文，就是把判断换成了它的）。
 *
 * @param {string | null | undefined} text 正文原文
 * @returns {boolean} 出现 `Closes`（大小写不敏感、只认整词）
 */
export function mentionsCloses(text) {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- text 是文件原文（外部输入），string 只是声明
  return /\bcloses\b/i.test(String(text ?? ""));
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
 * **`userBody` 是 `--pr-body-file` 注进来的那一份**（给了就整篇更新：人写的正文在
 * 前、自动事实段在后，中间用一条分隔线 + 一句「以下由脚本拼装」隔开，不让两段
 * 混成一坨）。不给时输出与从前**逐字节相同** —— 「不给旗标 ⇒ 行为不变」是这一格
 * 的硬约束，回归用例钉住开头/结尾两种形态。
 *
 * @param {{root:string,fragments:string[],diffstat:string,handle?:string|null,userBody?:string|null}} input 量到的事实
 *   与这一跑的留痕短名（ISSUE #2204：正文开头一行 `**[评论人：<短名>]**`，未配写「未配」）
 * @returns {string} 正文
 */
export function buildPullBody({ root, fragments, diffstat, handle = null, userBody = null }) {
  /* 空串按「没给」处理：一份空文件注入进来只会把自动段顶到最上面，与不给旗标同形 ——
   * 而调用方已经先把「给了但为空」判成用法错，这里只是第二道兜底。 */
  const injected = String(userBody ?? "").replace(/\s+$/, "");
  const listLines = fragments.map((f) => {
    // 首行的读法只有一处（`fragmentHead`）：两处各读各的，就会开始对同一份碎片给两种答案。
    return `- \`${f}\` → ${fragmentHead(root, f) || "(读不到)"}`;
  });
  /** 贴出碎片原文时枚举三样，没贴就沿用旧文案 —— 「不给旗标 ⇒ 逐字节相同」由它守住。
   * @param {boolean} hasFrag 这一跑有没有贴出碎片原文
   * @returns {string} 说明行
   */
  const injectedNote = (hasFrag) =>
    hasFrag
      ? "> 以下为 `pnpm ship` 自动拼装的事实段（碎片清单 + 碎片原文 + diffstat），不是上面那份正文的一部分。"
      : "> 以下为 `pnpm ship` 自动拼装的事实段（碎片清单 + diffstat），不是上面那份正文的一部分。";
  /** @param {boolean} hasFrag @returns {string[]} 事实段末尾两句 */
  const tail = (hasFrag) => [
    hasFrag
      ? "> 本段由 `pnpm ship` 拼装，内容全部是它当场量到的事实（碎片标题、碎片原文与 diffstat）。"
      : "> 本段由 `pnpm ship` 拼装，内容全部是它当场量到的事实（碎片标题与 diffstat）。",
    injected
      ? "> 判断、读数与因果请写在**上面那份正文**里（`--pr-body-file` 注进来的）—— 脚本不代写；" +
        "开头那行「评论人」只是这一跑的留痕，不是对正文的判断背书。"
      : "> 判断、读数与因果请写在下面的正文里 —— 脚本不代写；开头那行「评论人」只是" +
        "这一跑的留痕，不是对正文的判断背书。",
  ];
  /** 给定字节预算拼「碎片原文」那一节；没有可贴的正文 ⇒ 空数组，整节不出现。
   * @param {number} budget 字节预算
   * @returns {string[]} 正文行
   */
  const fragmentLines = (budget) => {
    const frag = capFragmentBodies({ root, fragments }, budget);
    if (frag.listed === 0) {
      return frag.note ? [frag.note, ""] : [];
    }
    return [
      "## 碎片原文（照录 `changelog.d/`，具体改了什么在这里）",
      "",
      ...frag.lines,
      ...(frag.note ? [frag.note, ""] : []),
    ];
  };
  /* 两处摘要一起降级：diffstat 减半到 0、碎片原文预算减到 0 之后仍装不下时，
   * 才轮到「这次正文本身太大」那一条出口（调用方按 PULL_BODY_LIMIT 判，念「不建 PR」）。
   * 用字节量，不用 `.length`：平台拒的是 UTF-8 字节数。 */
  let sampleMax = DIFFSTAT_SAMPLE_MAX;
  let fragBudget = FRAGMENT_BODY_BUDGET;
  for (;;) {
    const capped = capDiffstat(diffstat, sampleMax);
    const fragLines = fragmentLines(fragBudget);
    const hasFrag = fragLines.some((l) => l.startsWith("## 碎片原文"));
    const body = withCommentHeader(
      [
        ...(injected ? [injected, "", "---", "", injectedNote(hasFrag), ""] : []),
        "## 本 PR 带的变更碎片（`changelog.d/`）",
        "",
        ...listLines,
        "",
        ...fragLines,
        "## 改动量（`git diff --stat` 对 PR 的目标分支）",
        "",
        "```",
        capped.text,
        "```",
        "",
        ...(capped.note ? [capped.note, ""] : []),
        ...tail(hasFrag),
      ].join("\n"),
      handle,
    );
    if (bodyBytes(body) <= PULL_BODY_LIMIT || (sampleMax === 0 && fragBudget === 0)) {
      return body;
    }
    if (sampleMax > 0) {
      sampleMax = Math.floor(sampleMax / 2);
    }
    if (fragBudget > 0) {
      fragBudget = Math.floor(fragBudget / 2);
    }
  }
}
