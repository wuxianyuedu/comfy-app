#!/usr/bin/env node
/**
 * ship-ticket.mjs —— 「单子」那一格的判断：挂在哪个号上、谁提的、按什么优先级（规范 §13.10.9 / §13.10.10）。
 *
 * 从 `ship-core.mjs` 分出来只因为一件事：那四判（参数、阶段表、三态码、平台 JSON 里哪一格才是终态）
 * 与「读一份碎片的头一行」不是同一条变化方向 —— 前者跟着平台形状动，后者跟着**碎片与单子的口径**动，
 * 而两者叠在一份文件里已经越过 900 行那道硬闸（`check-infra-file-size.cjs`，AGENTS 硬规则 22）。
 * 拆的是职责，不是行数凑数：本文件**零依赖** `ship-core`，反向由它取 `fragmentHead`（一处实现，
 * PR 正文与「单子」读数共用，两处各读各的就会对同一份碎片给两种答案）。
 *
 * 三条口径与 `ship-core` 一致：只读数、不起进程、不抛异常。
 */
import fs from "node:fs";
import path from "node:path";

import { readEnvFileValue } from "./app-port.mjs";

/** 提单人这一格读的键名（`.env` 与进程环境同一名）。 */
export const DEV_HANDLE_ENV_KEY = "COMFYAPP_DEV_HANDLE";

/** 平台原生的优先级取值（`cnb issues create-issue --priority` 的词表，逐字抄自它的 `--help`）。 */
export const ISSUE_PRIORITIES = "P0|P1|P2|P3";

/**
 * 一份 `changelog.d/` 碎片的首行（按形态门禁的口径，就是段落标题那一行）。
 *
 * 读不到回**空串**：那是「没有读到」，不是「读到空段落」—— 调用方要按「判不了」
 * 处理，不许把它升级成一条否定（`0-x.md` 这类路径在工作树之外、或还没写）。
 *
 * @param {string} root 仓库根
 * @param {string} rel 碎片相对路径（`changelog.d/408-x.md`）
 * @returns {string}
 */
export function fragmentHead(root, rel) {
  try {
    return String(
      fs.readFileSync(path.join(root, rel), "utf8").split("\n", 1)[0],
    ).trim();
  } catch {
    return "";
  }
}

/**
 * 「这次变更挂在哪张单子上」—— **只读数，不拦**。
 *
 * 三条口径，方向都是「把没挂单念出来，而不是逼出一个号」：
 *   · **判的是段落，不是号**：`## Fixed` 意味着这次在改一个缺陷，而那张单子就是
 *     问题报告的本体（症状 / 读数 / 根因），所以它应当在动手**之前**存在；
 *     `## Added` / `## Changed` 这类本来没有诉求单可立的变更，`0-` 那条出口照旧可用
 *     （§13.10.8 第 2 条：「不写」是可核的，「写错」不可核 —— 挂错号会让两张单同时坏）。
 *   · **不是闸**：本函数一次也不参与退码。做成硬闸的必然后果是「为了让读数念出个号，
 *     随手挂一张最近开着的单子」，那正是 §13.10.8 记的那次事故，而这一格本来就
 *     **没有任何判据会红**（号只是个字符串，谁都能填）。
 *   · **读不到就不判**：首行取不到段落标题时按「判不了」处理 —— 宁可不念这一句，
 *     也不要凭一份读不到的文件指控人「没立案」。
 *
 * @param {{root: string, fragments?: string[]}} input 读数字段
 * @returns {{numbers: number[], anonymous: string[], anonymousFixed: string[], lines: string[]}}
 *   `numbers` 是去重后的单号（按出现顺序），`anonymousFixed` 是「段落 Fixed 而号是 0」的那几份
 */
export function ticketReading({ root, fragments = [] }) {
  /** @type {number[]} */
  const numbers = [];
  /** @type {string[]} */
  const anonymous = [];
  /** @type {string[]} */
  const anonymousFixed = [];
  for (const rel of fragments) {
    const name = path.basename(rel);
    const m = /^#?(\d+)-/.exec(name);
    // 不是 `<号>-<slug>.md` 形态的文件（目录说明 `README.md` 之类）没有号这一格可判。
    if (!m) continue;
    if (Number(m[1]) === 0) {
      anonymous.push(name);
      const section = /^#{1,6}\s*([A-Za-z]+)/.exec(fragmentHead(root, rel));
      if ((section?.[1] ?? "") === "Fixed") anonymousFixed.push(name);
    } else {
      numbers.push(Number(m[1]));
    }
  }
  const uniq = [...new Set(numbers)];
  const otherAnonymous = anonymous.length - anonymousFixed.length;
  const lines = [
    `[ship] 单子：${uniq.length ? uniq.map((n) => `#${n}`).join(" ") : "（无）"}` +
      ` · 无号碎片 ${anonymous.length} 份 —— 取自碎片的文件名与首行段落，` +
      "**这一格是读数，不改退码**",
  ];
  if (anonymousFixed.length > 0) {
    lines.push(
      `[ship] ${anonymousFixed.join("、")} 的段落是 \`## Fixed\` 而号是 \`0\` ⇒ ` +
        "**这次在改缺陷，却没有单子**。按 §13.10.9 先立案再动手：那张单就是问题报告的" +
        "本体（症状 / 读数 / 根因），不是给已经写完的改动凑一个编号。",
    );
    lines.push(
      "[ship] 建单的出口在下面那两行（`--priority` 与提单人标签都在那一格里，本脚本不替你按下去，" +
        "也不替你写正文 —— 那两行只在「缺单」或「没配提单留痕」时出现）。",
    );
  }
  if (otherAnonymous > 0) {
    lines.push(
      `[ship] 另 ${otherAnonymous} 份无号碎片的段落不是 \`Fixed\` ⇒ §13.10.8 第 2 条` +
        "那条 `0-` 出口照旧可用，这里不报违规。",
    );
  }
  return { numbers: uniq, anonymous, anonymousFixed, lines };
}

/**
 * 读「这份检出是谁」：先看进程环境（人临时 `COMFYAPP_DEV_HANDLE=… pnpm ship`），再回落到
 * 本检出的 `.env` —— 顺序与 `COMFYAPP_PORT` 那条一致，两份实现共用 `readEnvFileValue` 那一份
 * 最小解析器（§12.18：不在调用点重抄）。
 *
 * 读不到就回 `null`，**不拿 git 的 `user.name` 顶上**：issue 不走 git author（见
 * `issueAuthoring` 那段实测），把提交身份当成提单身份是一个看着像事实的假读数。
 *
 * @param {{root: string, env?: Record<string, string | undefined>}} input
 * @returns {string | null}
 */
export function readDevHandle({ root, env = {} }) {
  const fromEnv = env[DEV_HANDLE_ENV_KEY];
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
    return fromEnv.trim();
  }
  try {
    const value = readEnvFileValue(
      fs.readFileSync(path.join(root, ".env"), "utf8"),
      DEV_HANDLE_ENV_KEY,
    );
    return value && value.trim() !== "" ? value.trim() : null;
  } catch {
    // 没有 `.env`（CI / 干净检出）是常态 ⇒ 这不是「读不出来」，就是「没配」。
    return null;
  }
}

/**
 * 三枚角色标签的词表。**前缀说的是「这个人在这件事里是什么」，不是仓库名**：
 * 同一份检出在两个仓库里都是同一个短名，换仓库由 `--repo` 区分；把仓库名叠进
 * 前缀会让「谁提的 / 谁在做 / 谁做过」这几维不再可枚举。
 *
 * `handler` 与 `participant` 是**两种生命周期**，不能合并成同一枚：
 *   · `处理人:` 是**当前状态**（谁此刻在做），领取时打、结束即撤 —— 它是领取判据
 *     唯一认的那一枚（`decideClaim`），留着不撤等于把这张单永久锁死；
 *   · `参与人:` 是**历史集合**（谁做过），领取时补打、结束与关单都不撤 ——
 *     只增不删，列表页能直接扫出这张单经手过哪些人。
 */
export const ISSUE_LABEL_ROLES = Object.freeze({
  author: "提单人",
  handler: "处理人",
  participant: "参与人",
});

/**
 * `<角色>:<短名>` —— 平台留痕标签的唯一拼法。
 *
 * 空白 / null 回 `null`：那是「没配」，不是「配了一个空名字」。调用点据此念「未配」，
 * 不许自己拼一个前缀或拿 git `user.name` 顶上 —— 后者是提交身份，不是提单 / 处理身份
 * （`docs/guides/git-identity.md` §4）。
 *
 * @param {string} role `ISSUE_LABEL_ROLES` 里的值
 * @param {string | null | undefined} handle 短名（取自 `readDevHandle`）
 * @returns {string | null} 标签名；未配时为 null
 */
export function roleLabel(role, handle) {
  const h = String(handle ?? "").trim();
  return h === "" ? null : `${role}:${h}`;
}

/**
 * 提单人标签（`提单人:<短名>`）。
 *
 * @param {string | null | undefined} handle 短名
 * @returns {string | null}
 */
export function authorLabel(handle) {
  return roleLabel(ISSUE_LABEL_ROLES.author, handle);
}

/**
 * 处理人标签（`处理人:<短名>`）。
 *
 * @param {string | null | undefined} handle 短名
 * @returns {string | null}
 */
export function handlerLabel(handle) {
  return roleLabel(ISSUE_LABEL_ROLES.handler, handle);
}

/**
 * 参与人标签（`参与人:<短名>`）—— 只增不删的经手记录，不参与领取判据。
 *
 * @param {string | null | undefined} handle 短名
 * @returns {string | null}
 */
export function participantLabel(handle) {
  return roleLabel(ISSUE_LABEL_ROLES.participant, handle);
}

/**
 * 从 `get-issue` 回读的标签里取出某个角色的短名。标签可能是字符串或 `{name}` 对象
 * （平台两种回读形状都见过），两种都收；不是这个角色的一律忽略。
 *
 * @param {any[]} labels `get-issue` / `list-issues` 的 labels
 * @param {string} role `ISSUE_LABEL_ROLES` 里的值
 * @returns {string[]} 去重后的短名（按出现顺序）
 */
export function labelValues(labels, role) {
  const prefix = `${role}:`;
  /** @type {string[]} */
  const out = [];
  for (const item of Array.isArray(labels) ? labels : []) {
    const name = typeof item === "string" ? item : String(item?.name ?? "");
    if (!name.startsWith(prefix)) continue;
    const value = name.slice(prefix.length).trim();
    if (value !== "" && !out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * 向平台写文字时的开头署名。**同一格式、不分角色**：`**[评论人：<短名>]**`。
 *
 * 为什么不再按角色分 `提单人:` / `处理人:`：这两个前缀已经由标签承担（机器可读），
 * 正文里再写一遍既冗余、又让人以为正文那行也是判据。读者只要一眼看出「这串字是谁写的」，
 * 所以统一放在最前面；角色分工去标签里读。
 *
 * 未配时如实写「未配」、不编一个名字 —— 它仍是留痕，不是判断。
 *
 * @param {string | null | undefined} handle 短名
 * @returns {string} 开头署名行（不含换行）
 */
export function commentHeader(handle) {
  const name = String(handle ?? "").trim();
  return `**[评论人：${name || "未配"}]**`;
}

/**
 * 「这张单是谁提的、按什么优先级」—— 同样是**只读数，不拦**（ISSUE #2175）。
 *
 * 为什么账号层分不出人（当场实测，跨 #2135 / #2149 / #2156 / #2157 / #2163 五张单、跨并行会话）：
 * issue 是被 token 的**账号本体**创建的，`author.username` 与那串
 * `…+<账号>@noreply.cnb.cool` 的子地址都不随检出变。这与 `docs/guides/git-identity.md` §4
 * 讲的提交那一侧正相反 —— 那边 squash 合并保留 `author`，所以能给每份检出配一个 author 子地址；
 * 单子这一侧没有「git author」这一格可配，只能把留痕写进单子自己带的标签。
 *
 * 为什么不做成闸：这两格填什么都是「一个字符串」，没有任何判据会红。做成硬闸的必然后果与
 * §13.10.8 记的那次事故同型 —— 逼人为了过检随手填一个值，而假留痕比没留痕难查。
 *
 * @param {{
 *   handle?: string | null,
 *   platform?: string,
 *   root?: string,
 *   showExits?: boolean,
 * }} input `showExits` = 要不要把「这两格怎么按」那两句念出来（缺单或没配时才念，别每次都刷屏）；
 *   `root` 只用来把「去哪份检出填这一行」说实 —— 一台机器上四份并行检出时，
 *   「去 `.env` 里加一行」这句话指不出是哪一份（#2186 的现场）。
 * @returns {{handle: string | null, required: boolean, lines: string[]}}
 */
export function issueAuthoring({
  handle = null,
  platform = "",
  root = "",
  showExits = false,
} = {}) {
  const required = platform === "win32";
  const name = String(handle ?? "").trim();
  const label = authorLabel(name);
  const lines = [
    `[ship] 单子身份：提单人=${name || "未配"}（标签 ${label ?? "提单人:<名称>"}） · ` +
      `优先级走平台原生 \`--priority\`（${ISSUE_PRIORITIES}，本脚本不代填）` +
      " —— **这一格是读数，不改退码**",
  ];
  if (!name) {
    const where = path.join(root || ".", ".env");
    lines.push(
      required
        ? "[ship] 没配提单留痕 ⇒ 出口里那一格留空。Windows 开发者按规范在**这一份检出**的 " +
            `\`${where}\` 里填一行 \`${DEV_HANDLE_ENV_KEY}="<短名>"\`` +
            "（整行都不在时先跑 `pnpm env:init` —— 它只补缺失的键、不覆盖你已有的配置，#2186）。" +
            "它是提单留痕：不进 `src/env.js`、运行期不读、不随包"
        : `[ship] 没配提单留痕，而本轮只对 Windows 开发者要求这一格 ⇒ 不点名（当前宿主：${platform || "未告知"}；要配就填在 ${where}）`,
    );
  }
  if (showExits) {
    lines.push(
      "[ship] 这两格怎么按（本脚本不替你按）：" +
        '`cnb issues create-issue --repo <组织>/<仓库> --title "…" --body-file <正文文件> ' +
        `--priority <${ISSUE_PRIORITIES}>\``,
    );
    lines.push(
      "[ship]   建完再补一句 —— 实测 `create-issue --labels` 不落地（回读是空），标签要在建完之后按：" +
        `\`cnb issues post-issue-labels --repo <组织>/<仓库> --number <号> --labels ${label ?? "提单人:<名称>"}\``,
    );
  }
  return { handle: name || null, required, lines };
}

/**
 * `--whoami` 的自查出口：把「这一份检出是谁」与**两条留痕规则**打出来（ISSUE #2204）。
 *
 * 为什么需要它：手工 `cnb pulls post-pull` / `cnb issues post-issue-comment` 不走 `ship`，
 * 那两条路没有任何脚本能兜 —— 平台侧的 `author` 是 token 的账号本体，跨检出逐字相同。
 * 所以漏口只能靠「一条能粘贴的出口 + 文档口径」：这里给的就是那条出口，**一次也不碰平台**，
 * 也不改退码（它是读数，和阶段 0 那两行同口径）。
 *
 * @param {{handle?: string | null, root?: string, slug?: string | null}} input
 * @returns {string[]} 要打印的几行
 */
export function whoamiLines({ handle = null, root = "", slug = null } = {}) {
  const name = String(handle ?? "").trim();
  const label = handlerLabel(name);
  const author = authorLabel(name);
  const participant = participantLabel(name);
  const repo = slug || "<组织>/<仓库>";
  const lines = [
    `[ship] 本检出的平台留痕：${name || "未配"}` +
      (name
        ? `（提单人标签 ${author} · 处理人标签 ${label} · 参与人标签 ${participant}）`
        : "") +
      `（取自 ${DEV_HANDLE_ENV_KEY}：进程环境优先，其次这一份检出的 \`.env\`）`,
  ];
  if (!name) {
    lines.push(
      `[ship] 未配 ⇒ 在 \`${path.join(root || ".", ".env")}\` 填一行 ` +
        `\`${DEV_HANDLE_ENV_KEY}="<短名>"\`（整行不在时先跑 \`pnpm env:init\`，` +
        "它只补缺失的键、不覆盖已有配置）",
    );
  }
  lines.push(
    `[ship] 规则一：凡向平台写文字，正文最前面带一行粗体署名 \`${commentHeader(name)}\` —— ` +
      "提单 / PR 正文与领取 / 结束评论同一格式；角色分工看标签（提单人 / 处理人 / 参与人）",
  );
  lines.push(
    "[ship] 规则二：建 PR 后补标签并**独立回读**（`ship` 建的会自己做；手工建的要自己跑）：",
  );
  lines.push(
    `[ship]   cnb pulls post-pull-labels --repo ${repo} --number <PR号> --labels ${label ?? "处理人:<名称>"} -v`,
  );
  lines.push(
    `[ship]   cnb pulls list-pull-labels --repo ${repo} --number <PR号> -v` +
      "  ← 回读里看得见那个名字才算打上了",
  );
  lines.push(
    "[ship] 规则三：单子的领取 / 结束 / 查看走 ship（领取会补 `处理人:` / `参与人:` 并评论，" +
      "结束只撤 `处理人:`、保留 `参与人:`）：",
  );
  lines.push(
    `[ship]   pnpm ship --claim <号> · pnpm ship --release <号> · pnpm ship --claims`,
  );
  return lines;
}
