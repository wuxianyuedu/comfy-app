/**
 * `ci-dependabot-triage-model.mjs` —— Dependabot 告警巡检的**纯函数层**：
 * 聚合 / 去重键 / 正文渲染 / 计划。一条网络请求都不发（`planActions()` 只吃
 * **完整**读数），每条失效形态都能被 `tests/ci-dependabot-triage.test.ts` 直接钉住。
 *
 * 与 `ci-code-scanning-triage-model.mjs`（code scanning 那一族，ISSUE 同一套口径）
 * 同构而不同形：聚合键、告警形状、正文内容都是 Dependabot 自己的。机制层（HTTP）
 * 复用 `ci-code-scanning-triage-platform.mjs` 的既有出口；编排层在
 * `ci-dependabot-triage.mjs`。
 */

/** 标题里的去重键前缀 —— 只认这一段，其余（告警数 / 严重度）只给读者看。 */
export const TITLE_PREFIX = "dependabot: ";

/** 本档建的单挂在谁名下（与 code scanning 巡检同一口径：机器自起的账用机器的名字）。 */
export const AUTHOR_HANDLE = "ci-daily";

/** 告警族的主标签 / 「该包已无 open 告警」标记。 */
export const FAMILY_LABEL = "dependabot";
export const CLEARED_LABEL = "dependabot:cleared";

/** 严重度 → 平台优先级（与 code scanning 那族同一张表的 Dependabot 档：只有四档）。 */
const SEVERITY_PRIORITY = /** @type {Record<string, string>} */ ({
  critical: "P0",
  high: "P1",
  medium: "P2",
  low: "P3",
});

/** 严重度排序（越大越先处理）。 */
const SEVERITY_RANK = /** @type {Record<string, number>} */ ({
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
});

/**
 * GitHub 告警页在 GitHub 网页上的落点（正文里给读者点的那一条）。
 * @param {string} ghRepo `owner/name`
 * @param {number} number 告警编号
 * @returns {string}
 */
export function alertLink(ghRepo, number) {
  return `https://github.com/${ghRepo}/security/dependabot/${number}`;
}

/**
 * 网络层只要这一格（用例递替身时不必造一个完整的 `Response`）。
 * @typedef {(url: string, init?: {method?: string, body?: string, headers?: Record<string, string>, signal?: AbortSignal}) => Promise<{ok: boolean, status: number, headers: {get(key: string): string | null}, text(): Promise<string>}>} FetchLike
 */

/**
 * 一条告警（只留正文与去重要用的那几格）。
 * @typedef {{
 *   number: number,
 *   pkg: string,
 *   ecosystem: string,
 *   name: string,
 *   severity: string,
 *   ghsaId: string,
 *   summary: string,
 *   range: string,
 *   patched: string,
 *   manifestPath: string,
 *   scope: string,
 *   url: string,
 *   updatedAt: string,
 * }} Alert
 */

/**
 * 平台上的已有单（open 单列表里用得上的三格）。
 * @typedef {{number: number, title: string, labels: string[]}} IssueRow
 */

/**
 * 一次计划动作。`clear` 的正文要读旧单才拼得出来，所以这里只给该节与 marker。
 * @typedef {{
 *   kind: "create" | "update" | "clear",
 *   pkg: string,
 *   severity: string,
 *   count: number,
 *   title: string,
 *   number?: number,
 *   body?: string,
 *   priority?: string,
 *   section?: string,
 *   marker?: string,
 * }} Action
 */

/** 标题里的去重键。
 * @param {string} pkg `ecosystem/name`（`npm/lodash`）
 * @returns {string} `dependabot: npm/lodash`
 */
export function titleKey(pkg) {
  return `${TITLE_PREFIX}${String(pkg ?? "").trim()}`;
}

/** 标题的比对形（平台收掉多空白，本地也按同一口径比）。
 * @param {unknown} title 标题原值
 * @returns {string}
 */
export function normalizeTitle(title) {
  return String(title ?? "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/** 标题里认出的依赖键（`dependabot: ` 之后、` ·` 之前那一段）。
 *
 * 作用域名（@scope/name）里的 `@` / `/` 都在键里：`npm/@libsql/client` 必须整个
 * 被认回来，否则同一条依赖会裂成两张单。
 *
 * @param {unknown} title 标题原值
 * @returns {string | null} 认不出时 null
 */
export function packageOfTitle(title) {
  const m = /dependabot:\s*(?<pkg>[^\s·]+)/.exec(normalizeTitle(title));
  return m?.groups?.pkg ?? null;
}

/**
 * 一条 GitHub 原始告警 → 本档的 `Alert`。字段缺全不抛错（坏行按「读数缺失」
 * 落到占位值，聚合与正文照常成立）。
 * @param {any} raw `GET /dependabot/alerts` 的一项
 * @returns {Alert}
 */
export function normalizeAlert(raw) {
  const pkg = raw?.dependency?.package ?? raw?.security_vulnerability?.package ?? {};
  const vuln = raw?.security_vulnerability ?? {};
  const advisory = raw?.security_advisory ?? {};
  const ecosystem = String(pkg?.ecosystem ?? "(未知生态)").trim();
  const name = String(pkg?.name ?? "(未知包)").trim();
  return {
    number: Number(raw?.number ?? 0),
    pkg: `${ecosystem}/${name}`,
    ecosystem,
    name,
    severity: String(advisory?.severity ?? "unknown")
      .trim()
      .toLowerCase(),
    ghsaId: String(advisory?.ghsa_id ?? "(无 GHSA)").trim(),
    summary: String(advisory?.summary ?? "").trim(),
    range: String(vuln?.vulnerable_version_range ?? "").trim(),
    patched: String(vuln?.first_patched_version?.identifier ?? "(无修复版)").trim(),
    manifestPath: String(raw?.dependency?.manifest_path ?? "(无 manifest)").trim(),
    scope: String(raw?.dependency?.scope ?? "").trim(),
    url: String(raw?.html_url ?? ""),
    updatedAt: String(raw?.updated_at ?? "").trim(),
  };
}

/**
 * 按依赖聚合（**一包一单**）：同一包的多条 advisory 是同一个修法（把它升到
 * 修复版），逐 advisory 建单等于让同一个修法在 N 张单里各说一遍。组的严重度
 * 取其中**最高**的那条。
 * @param {Alert[]} alerts 已规范化的告警
 * @returns {Array<{pkg: string, ecosystem: string, name: string, severity: string, count: number, alerts: Alert[]}>} 按严重度降序
 */
export function aggregateByPackage(alerts) {
  /** @type {Map<string, {pkg: string, ecosystem: string, name: string, severity: string, count: number, alerts: Alert[]}>} */
  const groups = new Map();
  for (const alert of Array.isArray(alerts) ? alerts : []) {
    const key = alert.pkg;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      group.alerts.push(alert);
      if ((SEVERITY_RANK[alert.severity] ?? -1) > (SEVERITY_RANK[group.severity] ?? -1)) {
        group.severity = alert.severity;
      }
    } else {
      groups.set(key, {
        pkg: key,
        ecosystem: alert.ecosystem,
        name: alert.name,
        severity: alert.severity,
        count: 1,
        alerts: [alert],
      });
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      alerts: [...group.alerts].sort((a, b) => a.number - b.number),
    }))
    .sort(
      (a, b) =>
        (SEVERITY_RANK[b.severity] ?? -1) - (SEVERITY_RANK[a.severity] ?? -1) ||
        b.count - a.count ||
        a.pkg.localeCompare(b.pkg),
    );
}

/**
 * 已有单里，属于这一族的那些（标题带 `dependabot: ` 或挂着本族标签）。
 * @param {IssueRow[]} issues 平台返回的 open 单
 * @returns {IssueRow[]}
 */
export function managedIssues(issues) {
  return (Array.isArray(issues) ? issues : []).filter(
    (issue) =>
      normalizeTitle(issue?.title).includes(TITLE_PREFIX) ||
      (Array.isArray(issue?.labels) &&
        issue.labels.some((l) => l === FAMILY_LABEL || l === CLEARED_LABEL)),
  );
}

/**
 * 同一依赖那一张已有单（多张时取号最小的那张，并把「有多张」这件事由调用方念出来）。
 * @param {IssueRow[]} issues 已筛过本族的单
 * @param {string} pkg 依赖键
 * @returns {IssueRow | null}
 */
export function findIssueForPackage(issues, pkg) {
  const key = titleKey(pkg);
  let picked = null;
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (!normalizeTitle(issue?.title).includes(key)) {
      continue;
    }
    if (!picked || issue.number < picked.number) {
      picked = issue;
    }
  }
  return picked;
}

/**
 * 标题：`dependabot: <ecosystem>/<name> · <n> 条 · <severity>`。
 * 入键的只有前一段（`titleKey()`）；后两段是给列表页读者看的，随读数变**不进键**。
 * @param {string} pkg 依赖键
 * @param {number} count open 告警数
 * @param {string} severity 组内最高严重度
 * @returns {string}
 */
export function issueTitle(pkg, count, severity) {
  return `${titleKey(pkg)} · ${count} 条 · ${severity}`;
}

/** Markdown 表格单元：竖线要转义，换行要收成空格，否则整张表会散架。
 * @param {unknown} value 原值
 * @returns {string}
 */
function cell(value) {
  return String(value ?? "")
    .replaceAll("|", String.raw`\|`)
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .trim();
}

/** ISO 时刻 → 北京时间那句读数（UTC 也保留，两边都能对）。
 * @param {string} iso ISO 时刻
 * @returns {string}
 */
export function beijingTime(iso) {
  const at = Date.parse(String(iso ?? ""));
  if (Number.isNaN(at)) {
    return `（时刻读不出：${String(iso ?? "")}）`;
  }
  const shifted = new Date(at + 8 * 3600 * 1000);
  return `${shifted.toISOString().replace("T", " ").slice(0, 16)}（北京）`;
}

/**
 * 这一组告警里最新的 `updated_at`（正文的「数据时点」：只在告警集真的变了时才变，
 * 与 code scanning 那族的「最近分析」同一角色 —— 防止正文每天无谓地刷一遍）。
 * @param {Alert[]} alerts
 * @returns {string} 没有可读时刻时返回空串
 */
export function latestUpdatedAt(alerts) {
  const times = (Array.isArray(alerts) ? alerts : [])
    .map((a) => String(a?.updatedAt ?? ""))
    .filter((t) => !Number.isNaN(Date.parse(t)))
    .sort();
  return times.at(-1) ?? "";
}

/**
 * 修复建议 —— Dependabot 告警的修法方向是同一句话（升到修复版），所以这里
 * 只给**通用**出口，不替人编每条 advisory 的假指引。
 */
const FIX_HINTS = [
  "把这一依赖升到告警里的**首个修复版**（`first_patched_version`）：manifest 与 lockfile 一起动（`pnpm update <pkg>` / `pnpm install`），只改 manifest 不锁文件 = 下一次安装又回到受影响版本。",
  "有 major 跨越 / 破坏性变更时：先在分支上升一版试跑，别直接顶到默认分支。",
  "若这条依赖已不再使用，直接移除；若确需停留在受影响版本，在 GitHub 侧把告警 **dismiss** 并把理由写在本单（平台会记住理由，本档按 open 过滤后就不再翻它）。",
];

/**
 * 正文：概览（依赖 / 最高严重度 / open 数 / 涉及 manifest / 数据时点）+ 告警明细 +
 * 修复建议 + 验收口径。**只写读数与出口**，不代写因果。
 *
 * ⚠️ 正文里**不写「巡检时刻」**：那一格每跑一次都变，会让「同一份读数」每次都被
 * 判成「正文变了」⇒ 每天各刷一次、各评论一条。正文只随**告警集**变（「数据时点」
 * 取告警里最新的 `updated_at`，告警没变它就不变）；本跑的时刻在追加评论里
 * （只在读数真的变了时才发）。
 *
 * @param {{pkg: string, ecosystem: string, name: string, severity: string, alerts: Alert[], ghRepo: string}} input
 * @returns {string}
 */
export function renderIssueBody({ pkg, ecosystem, name, severity, alerts, ghRepo }) {
  const rows = alerts
    .map(
      (a) =>
        `| #${a.number} | ${cell(a.ghsaId)} | ${cell(a.summary)} | ${cell(a.severity)} | ` +
        `${cell(a.range)} | ${cell(a.patched)} | ${cell(a.manifestPath)} | ${cell(a.scope)} | ` +
        `[打开](${a.url || alertLink(ghRepo, a.number)}) |`,
    )
    .join("\n");
  const manifests = [...new Set(alerts.map((a) => a.manifestPath))].join("、");
  return [
    `**[评论人：${AUTHOR_HANDLE}]**`,
    "",
    `# ${titleKey(pkg)}`,
    "",
    "## 概览",
    "",
    "| 项 | 读数 |",
    "| --- | --- |",
    `| 依赖 | \`${pkg}\` |`,
    `| 生态 / 包名 | ${cell(ecosystem)} / \`${cell(name)}\` |`,
    `| 严重度（最高） | ${severity} |`,
    `| open 告警数 | ${alerts.length} |`,
    `| 涉及 manifest | ${cell(manifests)} |`,
    `| 数据时点 | ${latestUpdatedAt(alerts) || "（告警未带时刻）"} |`,
    "",
    "## 告警明细",
    "",
    "| 告警 | GHSA | 摘要 | 严重度 | 受影响范围 | 首个修复版 | manifest | 作用域 | 链接 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    rows || "| （无） | | | | | | | | |",
    "",
    "## 修复建议",
    "",
    ...FIX_HINTS.map((line) => `- ${line}`),
    "",
    "## 验收口径",
    "",
    "- 这个包在 **GitHub Dependabot alerts** 里不再有 `open` 告警（看正文顶部的告警明细，不是本机 `npm audit` 的读数）。",
    "- 告警在 GitHub 侧变成 `fixed`（或 `dismissed` 且理由写在告警上）。",
    "- 本单由人确认后关闭；本档不自动关单 —— 告警修好后再出新告警是新的编号，自动关会把这笔账丢掉。",
    "- 复发时按**依赖键**落回本单（标题里的 `dependabot: <ecosystem>/<name>` 是去重键），不另开新单。",
    "",
    "---",
    "",
    "本单由 `dependabot-triage` 自动生成：读数取自 GitHub Dependabot alerts API，" +
      "每条告警的原始链接在告警明细里。",
    "",
  ].join("\n");
}

/**
 * 「这个包已无 open 告警」那一节（刷新正文时插到最前面，**不删**原明细）。
 *
 * marker 刻意**不带时刻**：没有「最新分析」可指，稳定的 marker 才能让下一跑的
 * 「已处理过」判断命中（否则每次巡检都会把同一份「已清零」再写一遍）。
 *
 * @param {{pkg: string, at: string}} input
 * @returns {{section: string, marker: string}}
 */
export function renderClearedSection({ pkg, at }) {
  const marker = `已无 open 告警 · \`${pkg}\``;
  const section = [
    "## 最新读数：这个包已无 open 告警",
    "",
    `- 巡检时刻：${at}`,
    `- \`${pkg}\` 当前在 GitHub Dependabot alerts 里**没有 open 告警**（此前的告警明细保留在下面，作为历史）。`,
    "",
    "处置：**本档不自动关单** —— 请人工核对代码后关闭；之后再出新告警会按依赖键落回本单。",
    "",
    marker,
    "",
    "---",
    "",
  ].join("\n");
  return { section, marker };
}

/**
 * 把「已无 open 告警」那一节拼到旧正文最前面（署名行保持有且只有一行）。
 * @param {string} existingBody 平台上的旧正文
 * @param {string} section `renderClearedSection()` 的 section
 * @returns {string}
 */
export function composeClearedBody(existingBody, section) {
  const text = String(existingBody ?? "").replace(/\s+$/, "");
  const withoutHeader = text.replace(/^\*\*\[评论人：[^\]\n]*\]\*\*\s*/, "");
  const merged = `**[评论人：${AUTHOR_HANDLE}]\n\n${section}${withoutHeader}`.replace(/\s+$/, "");
  return `${merged}\n`;
}

/**
 * 追加评论那一条（短读数，不把整张正文再贴一遍）。
 * @param {{pkg: string, count: number, at: string}} input
 * @returns {{body: string, marker: string}}
 */
export function renderUpdateComment({ pkg, count, at }) {
  const marker = `巡检读数 · \`${pkg}\``;
  const body = [
    `**[评论人：${AUTHOR_HANDLE}]**`,
    "",
    `## ${marker}`,
    "",
    `- 巡检时刻：${at}`,
    `- \`${pkg}\` 当前 open 告警：**${count} 条**（明细以正文里的告警表为准，本次已刷新）。`,
    "",
  ].join("\n");
  return { body, marker };
}

/**
 * 纯函数：这一跑要做什么。
 *
 * 与 code scanning 那族同一条边界：`alerts` 与 `existing` 都是**完整**读数
 * （取不全时调用方根本不进来），所以这里不做任何「取不到就跳过」的分支。
 * 没有「最近分析」这一读数（Dependabot 没有分析对象），正文只随告警集变。
 *
 * @param {{alerts: Alert[], existing: IssueRow[], ghRepo: string, at: string}} input
 * @returns {Action[]}
 */
export function planActions({ alerts, existing, ghRepo, at }) {
  const groups = aggregateByPackage(alerts);
  const managed = managedIssues(existing);
  /** @type {Action[]} */
  const actions = [];
  for (const group of groups) {
    const issue = findIssueForPackage(managed, group.pkg);
    const title = issueTitle(group.pkg, group.count, group.severity);
    const body = renderIssueBody({
      pkg: group.pkg,
      ecosystem: group.ecosystem,
      name: group.name,
      severity: group.severity,
      alerts: group.alerts,
      ghRepo,
    });
    if (issue) {
      actions.push({
        kind: "update",
        pkg: group.pkg,
        severity: group.severity,
        count: group.count,
        title,
        number: issue.number,
        body,
        priority: SEVERITY_PRIORITY[group.severity] ?? "P2",
      });
    } else {
      actions.push({
        kind: "create",
        pkg: group.pkg,
        severity: group.severity,
        count: group.count,
        title,
        body,
        priority: SEVERITY_PRIORITY[group.severity] ?? "P2",
      });
    }
  }
  const live = new Set(groups.map((g) => g.pkg));
  for (const issue of managed) {
    const pkg = packageOfTitle(issue.title);
    if (!pkg || live.has(pkg)) {
      continue;
    }
    const cleared = renderClearedSection({ pkg, at });
    actions.push({
      kind: "clear",
      pkg,
      severity: "unknown",
      count: 0,
      title: issueTitle(pkg, 0, "已无 open 告警"),
      number: issue.number,
      section: cleared.section,
      marker: cleared.marker,
    });
  }
  return actions;
}
