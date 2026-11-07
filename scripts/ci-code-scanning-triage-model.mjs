/**
 * `ci-code-scanning-triage-model.mjs` —— 巡检的**纯函数层**：聚合 / 去重键 / 正文渲染 / 计划。
 *
 * 这一层一条网络请求都不发（`planActions()` 只吃三个**完整**读数），所以每条失效形态都能被
 * `tests/ci-code-scanning-triage.test.ts` 直接钉住。机制层（HTTP）在
 * `ci-code-scanning-triage-platform.mjs`，编排层（main）在 `ci-code-scanning-triage.mjs`。
 *
 * 拆三层是 `check-infra-file-size.cjs` 的 900 行硬闸逼出来的 —— 顺带把「看一眼就能判对错」
 * 的那部分单独放下，读的人不必先穿过网络错误处理。
 */

/** 标题里的去重键前缀 —— 只认这一段，其余（命中数 / 严重度）只给读者看。 */
export const TITLE_PREFIX = "code-scanning: ";

/** 本档建的单挂在谁名下（与每日失败立案同一口径：机器自起的账用机器的名字）。 */
export const AUTHOR_HANDLE = "ci-daily";

/** 标记「这张单的规则已经不在最新分析里」的标签（只提示，不关单）。 */
export const CLEARED_LABEL = "code-scanning:cleared";

/** 告警族的主标签。 */
export const FAMILY_LABEL = "code-scanning";

/** 平台标签的颜色（与既有标签同一形状：六位十六进制，不带 `#`）。 */
export const LABEL_COLORS = /** @type {Record<string, string>} */ ({
  [FAMILY_LABEL]: "D73A4A",
  [CLEARED_LABEL]: "0E8A16",
});

/** 严重度 → 平台优先级。判断写死并说明：critical 的安全问题不该排在「没被判断过」那一档。 */
const SEVERITY_PRIORITY = /** @type {Record<string, string>} */ ({
  critical: "P0",
  high: "P1",
  medium: "P2",
  low: "P3",
  warning: "P3",
  note: "P3",
});

/** 严重度排序（越大越先处理）。 */
const SEVERITY_RANK = /** @type {Record<string, number>} */ ({
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  warning: 1,
  note: 0,
});

/**
 * GitHub 告警页在 GitHub 网页上的落点（正文里给读者点的那一条）。
 * @param {string} ghRepo `owner/name`
 * @param {number} number 告警编号
 * @returns {string}
 */
export function alertLink(ghRepo, number) {
  return `https://github.com/${ghRepo}/security/code-scanning/${number}`;
}

/**
 * 一次 CodeQL 分析读数。
 * @typedef {{ref: string, commitSha: string, createdAt: string, id: number}} Analysis
 */

/**
 * 网络层只要这四格（用例递替身时不必造一个完整的 `Response`）。
 * @typedef {(url: string, init?: {method?: string, body?: string, headers?: Record<string, string>, signal?: AbortSignal}) => Promise<{ok: boolean, status: number, headers: {get(key: string): string | null}, text(): Promise<string>}>} FetchLike
 */

/**
 * 一条告警（只留正文与去重要用的那几格）。
 * @typedef {{
 *   number: number,
 *   ruleId: string,
 *   severity: string,
 *   path: string,
 *   startLine: number | null,
 *   message: string,
 *   url: string,
 * }} Alert
 */

/**
 * 平台上的已有单（`list-issues` 里用得上的三格）。
 * @typedef {{number: number, title: string, labels: string[]}} IssueRow
 */

/**
 * 一次计划动作。`clear` 的正文要读旧单才拼得出来，所以这里只给该节与 marker。
 * @typedef {{
 *   kind: "create" | "update" | "clear",
 *   ruleId: string,
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

/**
 * 标题里的去重键。
 * @param {string} ruleId 规则 id（`js/redos`）
 * @returns {string} `code-scanning: js/redos`
 */
export function titleKey(ruleId) {
  return `${TITLE_PREFIX}${String(ruleId ?? "").trim()}`;
}

/**
 * 标题的比对形（平台收掉多空白，本地也按同一口径比）。
 * @param {unknown} title 标题原值
 * @returns {string}
 */
export function normalizeTitle(title) {
  return String(title ?? "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/**
 * 标题里认出的规则 id（`code-scanning: ` 之后那一段）。
 *
 * 只认这一段：命中数 / 严重度会随读数变，把它们读进键就等于「同一规则每天都是新的一张」。
 *
 * @param {unknown} title 标题原值
 * @returns {string | null} 认不出时 null
 */
export function ruleOfTitle(title) {
  const m = /code-scanning:\s*(?<rule>[A-Za-z0-9._/-]+)/.exec(normalizeTitle(title));
  return m?.groups?.rule ?? null;
}

/**
 * 一条 GitHub 原始告警 → 本档的 `Alert`。
 * @param {any} raw `GET /code-scanning/alerts` 的一项
 * @returns {Alert}
 */
export function normalizeAlert(raw) {
  const loc = raw?.most_recent_instance?.location ?? {};
  return {
    number: Number(raw?.number ?? 0),
    ruleId: String(raw?.rule?.id ?? "unknown"),
    severity: String(raw?.rule?.security_severity_level ?? raw?.rule?.severity ?? "unknown")
      .trim()
      .toLowerCase(),
    path: String(loc?.path ?? "(无路径)"),
    startLine: Number.isInteger(loc?.start_line) ? Number(loc.start_line) : null,
    message: String(
      raw?.most_recent_instance?.message?.text ?? raw?.rule?.description ?? "",
    ).trim(),
    url: String(raw?.html_url ?? ""),
  };
}

/**
 * 按规则聚合。同一规则的多条告警进一张单；组的严重度取其中**最高**的那一条。
 * @param {Alert[]} alerts 已规范化的告警
 * @returns {Array<{ruleId: string, severity: string, count: number, alerts: Alert[]}>} 按严重度降序
 */
export function aggregateByRule(alerts) {
  /** @type {Map<string, {ruleId: string, severity: string, count: number, alerts: Alert[]}>} */
  const groups = new Map();
  for (const alert of Array.isArray(alerts) ? alerts : []) {
    const id = alert.ruleId;
    const group = groups.get(id);
    if (group) {
      group.count += 1;
      group.alerts.push(alert);
      if ((SEVERITY_RANK[alert.severity] ?? -1) > (SEVERITY_RANK[group.severity] ?? -1)) {
        group.severity = alert.severity;
      }
    } else {
      groups.set(id, {
        ruleId: id,
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
        a.ruleId.localeCompare(b.ruleId),
    );
}

/**
 * 已有单里，属于这一族的那些（标题带 `code-scanning: ` 或挂着本族标签）。
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
 * 同一规则那一张已有单（多张时取号最小的那张，并把「有多张」这件事由调用方念出来）。
 * @param {IssueRow[]} issues 已筛过本族的单
 * @param {string} ruleId 规则 id
 * @returns {IssueRow | null}
 */
export function findIssueForRule(issues, ruleId) {
  const key = titleKey(ruleId);
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
 * 标题：`code-scanning: <rule id> · <n> 处 · <severity>`。
 *
 * 入键的只有前一段（`titleKey()`）；后两段是给列表页读者看的，随读数变**不进键**。
 *
 * @param {string} ruleId 规则 id
 * @param {number} count 命中数
 * @param {string} severity 组内最高严重度
 * @returns {string}
 */
export function issueTitle(ruleId, count, severity) {
  return `${titleKey(ruleId)} · ${count} 处 · ${severity}`;
}

/**
 * Markdown 表格单元：竖线要转义，换行要收成空格，否则整张表会散架。
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

/**
 * ISO 时刻 → 北京时间那句读数（UTC 也保留，两边都能对）。
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
 * 每一条规则怎么修 —— 只给**方向**，不替人写代码（判断仍然在动手的人那里）。
 * 规则表之外的一律落到通用那一条，不为凑表编一句像模像样的假指引。
 */
const FIX_HINTS = /** @type {Record<string, string[]>} */ ({
  "actions/missing-workflow-permissions": [
    "在 workflow 顶层或每个 job 上加 `permissions:`，只授予这一格真正用到的那几项（其余 `none`）。",
    "本仓已有先例：`package-desktop.yml` 用 workflow 级 `permissions: contents: write`；PR 档按格收窄。",
  ],
  "js/incomplete-sanitization": [
    "`String.replace()` 只换第一处：改成 `replaceAll()` 或带 `g` 的正则。",
    "如果本意是「只换开头那一处」，加锚点（`/^…/`）把意图写出来，别让它看起来像漏了全局。",
  ],
  "js/incomplete-multi-character-sanitization": [
    "单趟替换会被嵌套输入绕过（`<<script>` 去掉一层还是 `</script>`）：改成循环到不再变化，或换用成熟的转义库。",
  ],
  "js/shell-command-injection-from-environment": [
    "不要把路径拼进 shell 命令字符串：改成 `spawn(cmd, args, { shell: false })`，参数走数组。",
    "本仓 `launcher-core/shell.mjs` 已有 `shell: false` 的口径；这两处是拼字符串那条路。",
  ],
  "js/insecure-randomness": [
    "安全相关的随机量改用 `crypto.randomUUID()` / `crypto.getRandomValues()`；`Math.random()` 只留给非安全的抖动。",
    "若这一处本来就只是「不要撞号」，在注释里写清「为什么不需要密码学强度」，别让下一个人重新判一遍。",
  ],
  "js/identity-replacement": [
    "`replace('/', '/')` 是空操作：直接删掉，或确认原本要换的字符是什么再改成对的。",
  ],
  "js/request-forgery": [
    "对用户可控的 URL 做协议 + 主机白名单校验，再发请求；本仓的本地 ComfyUI 地址应只允许 loopback / 已配置的 host。",
    "校验要发生在**请求之前**，并且失败就拒绝，不要「校验完仍然用原串」。",
  ],
  "js/redos": [
    "这个正则存在可重叠的量词：改成互斥分支 / 缩短回溯窗口，或先对输入长度设上限。",
    "改完用长输入跑一遍（单测里钉一条），别只在小样本上验。",
  ],
  "js/bad-tag-filter": [
    "过滤标签的正则要带 `i` 标志，或显式写 `[sS][cC][rR]…` —— 大小写混写的标签同样能被浏览器执行。",
  ],
});

/** 通用那一条（每条规则都带）。 */
const FIX_GENERAL = [
  "先确认这条告警的**最小修法**，再动手：CodeQL 的 `help` 里通常给了数据流路径。",
  "改完以「最近一次分析不再命中」为准，不以「本地点不复现」为准（扫描器看到的是全仓）。",
];

/**
 * 一条规则那一节的修复建议。
 * @param {string} ruleId 规则 id
 * @returns {string[]}
 */
function fixHints(ruleId) {
  return [...(FIX_HINTS[ruleId] ?? []), ...FIX_GENERAL];
}

/**
 * 正文：概览（rule / severity / 命中数 / 最近分析 commit + 时间 / ref）+ 命中表 +
 * 修复建议 + 验收口径。**只写读数与出口**，不代写因果。
 *
 * ⚠️ 正文里**不写「巡检时刻」**：那一格每跑一次都变，会让「同一份读数」每次都被判成
 * 「正文变了」⇒ 每天九张单各刷一次、各评论一条。正文只随**分析读数**变；本跑的时刻
 * 在追加评论里（只在读数真的变了时才发）。
 *
 * @param {{ruleId: string, severity: string, alerts: Alert[], analysis: Analysis, ghRepo: string}} input
 * @returns {string}
 */
export function renderIssueBody({ ruleId, severity, alerts, analysis, ghRepo }) {
  const rows = alerts
    .map(
      (a) =>
        `| #${a.number} | ${cell(a.severity)} | \`${cell(a.path)}:${a.startLine ?? "?"}\` | ` +
        `${cell(a.message)} | [打开](${alertLink(ghRepo, a.number)}) |`,
    )
    .join("\n");
  return [
    `**[评论人：${AUTHOR_HANDLE}]**`,
    "",
    `# ${titleKey(ruleId)}`,
    "",
    "## 概览",
    "",
    "| 项 | 读数 |",
    "| --- | --- |",
    `| 规则 | \`${ruleId}\` |`,
    `| 严重度 | ${severity} |`,
    `| 命中数 | ${alerts.length} |`,
    `| 最近分析 commit | \`${analysis.commitSha.slice(0, 8)}\` |`,
    `| 最近分析时间 | ${analysis.createdAt} · ${beijingTime(analysis.createdAt)} |`,
    `| 分析 ref | \`${analysis.ref}\` |`,
    "",
    "## 命中明细",
    "",
    "| 告警 | 严重度 | 位置 | 摘要 | 链接 |",
    "| --- | --- | --- | --- | --- |",
    rows || "| （无） | | | | |",
    "",
    "## 修复建议",
    "",
    ...fixHints(ruleId).map((line) => `- ${line}`),
    "",
    "## 验收口径",
    "",
    "- 这条规则在**最近一次 CodeQL 分析**里不再有命中（看正文顶部那一行 commit / ref，不是本机的复现结果）。",
    "- 告警在 GitHub 侧变成 `fixed`（或 `dismissed` 且理由写在告警上）。",
    "- 本单由人确认后关闭；本档不自动关单 —— 告警修好再复发会换新的 alert 号，自动关会把这笔账丢掉。",
    "- 复发时按**规则 id** 落回本单（标题里的 `code-scanning: <rule id>` 是去重键），不另开新单。",
    "",
    "---",
    "",
    "本单由 `code-scanning-triage` 自动生成：读数取自 GitHub code scanning API，" +
      "每条告警的原始链接在命中表里。",
    "",
  ].join("\n");
}

/**
 * 「这条规则已无命中」那一节（刷新正文时插到最前面，**不删**原来的命中表）。
 * @param {{ruleId: string, analysis: Analysis, at: string}} input
 * @returns {{section: string, marker: string}}
 */
function renderClearedSection({ ruleId, analysis, at }) {
  const marker = `已无该规则命中 · \`${analysis.commitSha.slice(0, 8)}\``;
  const section = [
    "## 最新读数：已无该规则命中",
    "",
    `- 巡检时刻：${at}`,
    `- 最近一次 CodeQL 分析：commit \`${analysis.commitSha.slice(0, 8)}\` · ` +
      `${analysis.createdAt} · \`${analysis.ref}\``,
    `- \`${ruleId}\` 在这份分析里**没有命中**（此前的命中表保留在下面，作为历史）。`,
    "",
    "处置：**本档不自动关单** —— 请人工核对代码后关闭；告警复发会换新的 alert 号，" +
      "自动关会把这笔账丢掉。",
    "",
    marker,
    "",
    "---",
    "",
  ].join("\n");
  return { section, marker };
}

/**
 * 把「已无命中」那一节拼到旧正文最前面（署名行保持有且只有一行）。
 * @param {string} existingBody 平台上的旧正文
 * @param {string} section `renderClearedSection()` 的 section
 * @returns {string}
 */
export function composeClearedBody(existingBody, section) {
  const text = String(existingBody ?? "").replace(/\s+$/, "");
  const withoutHeader = text.replace(/^\*\*\[评论人：[^\]\n]*\]\*\*\s*/, "");
  const merged = `**[评论人：${AUTHOR_HANDLE}]**\n\n${section}${withoutHeader}`.replace(/\s+$/, "");
  return `${merged}\n`;
}

/**
 * 追加评论那一条（短读数，不把整张正文再贴一遍）。
 * @param {{ruleId: string, count: number, analysis: Analysis, at: string}} input
 * @returns {{body: string, marker: string}}
 */
export function renderUpdateComment({ ruleId, count, analysis, at }) {
  const marker = `巡检读数 · \`${analysis.commitSha.slice(0, 8)}\``;
  const body = [
    `**[评论人：${AUTHOR_HANDLE}]**`,
    "",
    `## ${marker}`,
    "",
    `- 巡检时刻：${at}`,
    `- \`${ruleId}\` 当前命中：**${count} 处**（明细以上面正文里的命中表为准，本次已刷新）。`,
    `- 最近一次 CodeQL 分析：commit \`${analysis.commitSha.slice(0, 8)}\` · ` +
      `${analysis.createdAt} · \`${analysis.ref}\``,
    "",
  ].join("\n");
  return { body, marker };
}

/**
 * 纯函数：这一跑要做什么。
 *
 * 三条边界写在类型里：`alerts` 与 `existing` 都是**完整**读数（取不全时调用方根本不进来），
 * `analysis` 已经拿到；所以这里不做任何「取不到就跳过」的分支 —— 那种分支会让一次部分
 * 读数看起来像一次「没有变化」的正常跑。
 *
 * @param {{alerts: Alert[], existing: IssueRow[], analysis: Analysis, ghRepo: string, at: string}} input
 * @returns {Action[]}
 */
export function planActions({ alerts, existing, analysis, ghRepo, at }) {
  const groups = aggregateByRule(alerts);
  const managed = managedIssues(existing);
  /** @type {Action[]} */
  const actions = [];
  for (const group of groups) {
    const issue = findIssueForRule(managed, group.ruleId);
    const title = issueTitle(group.ruleId, group.count, group.severity);
    const body = renderIssueBody({
      ruleId: group.ruleId,
      severity: group.severity,
      alerts: group.alerts,
      analysis,
      ghRepo,
    });
    if (issue) {
      actions.push({
        kind: "update",
        ruleId: group.ruleId,
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
        ruleId: group.ruleId,
        severity: group.severity,
        count: group.count,
        title,
        body,
        priority: SEVERITY_PRIORITY[group.severity] ?? "P2",
      });
    }
  }
  const live = new Set(groups.map((g) => g.ruleId));
  for (const issue of managed) {
    const ruleId = ruleOfTitle(issue.title);
    if (!ruleId || live.has(ruleId)) {
      continue;
    }
    const cleared = renderClearedSection({ ruleId, analysis, at });
    actions.push({
      kind: "clear",
      ruleId,
      severity: "unknown",
      count: 0,
      title: issueTitle(ruleId, 0, "已无命中"),
      number: issue.number,
      section: cleared.section,
      marker: cleared.marker,
    });
  }
  return actions;
}
