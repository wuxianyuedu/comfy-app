/**
 * ship-find-issues.mjs —— `pnpm ship --find-issues <关键词>` 的只读 Issue 检索（ISSUE #5167）。
 *
 * 开工前「有没有同类单」此前每处各写一套 `cnb issues list-issues` 取数 + 过滤，
 * 分页形状与失败口径都不统一：页页都满而平台一直说「还有」时，取数被截成「没有」。
 * 这里复用 `ship-branches.mjs` 的翻页终止判据与 `cnbJson`，只输出人读的四列 +
 * 取数覆盖（翻了几页 / 取了几条 / 窗口取没取满），取不满就明说「没取到」而不是「没有」。
 *
 * 一次只做只读查询：不写平台、不领取、不关单。
 */
import { asArray } from "./ship-build.mjs";
import { readListHasMore } from "./ship-branches.mjs";
import { CODE } from "./ship-core.mjs";
import { cnbJson } from "./ship-exec.mjs";

/** 平台每页上限（与 `--branches` 同形）。 */
export const ISSUE_PAGE_SIZE = 100;
/** 防失控上限，不是取数目标；撞线必须报「取不满」。 */
export const ISSUE_MAX_PAGES = 32;

/**
 * 平台 Issue 记录 → 人读四列。纯函数，形状来自 `list-issues -v` 的 `data.*`。
 *
 * @param {any[]} list
 * @returns {{number:number, title:string, state:string, labels:string[], url:string|null}[]}
 */
export function issueRows(list) {
  return (Array.isArray(list) ? list : [])
    .map((r) => {
      const number = Number(r?.number ?? r?.issue?.number);
      /** @type {any[]} */
      const rawLabels = Array.isArray(r?.labels) ? r.labels : [];
      const labels = rawLabels
        .map((l) => (typeof l === "string" ? l : String(l?.name ?? "")))
        .filter(Boolean);
      const slug = typeof r?.repository?.full_name === "string" ? r.repository.full_name : null;
      return {
        number,
        title: String(r?.title ?? ""),
        state: String(r?.state ?? ""),
        labels,
        url: slug ? `https://cnb.cool/${slug}/-/issues/${number}` : null,
      };
    })
    .filter((r) => Number.isInteger(r.number) && r.number > 0)
    .sort((a, b) => b.number - a.number);
}

/**
 * 翻 Issue 列表。取不到就是取不到 —— `ok:false` 让调用方落「没结论」。
 *
 * @param {(cmd:string,args:string[])=>any} run
 * @param {string} slug
 * @param {{state:string, keyword?:string|null, label?:string|null, maxPages?:number}} opts
 */
export function fetchIssues(run, slug, opts) {
  const maxPages = opts.maxPages ?? ISSUE_MAX_PAGES;
  /** @type {any[]} */
  const list = [];
  let pages = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const got = cnbJson(run, [
      "issues",
      "list-issues",
      "--repo",
      slug,
      "--page",
      String(page),
      "--page-size",
      String(ISSUE_PAGE_SIZE),
      "--state",
      opts.state,
      ...(opts.keyword ? ["--keyword", opts.keyword] : []),
      ...(opts.label ? ["--labels", opts.label, "--labels-operator", "contains_all"] : []),
      "-v",
    ]);
    if (!got) {
      return {
        ok: false,
        list,
        pages,
        windowComplete: false,
        note: `第 ${page} 页取不到（cnb 没跑起来或响应不是 JSON）`,
      };
    }
    const batch = asArray(got.json);
    if (!batch) {
      return { ok: false, list, pages, windowComplete: false, note: `第 ${page} 页的形状认不出来` };
    }
    list.push(...batch);
    pages = page;
    const more = readListHasMore(got.json);
    if (batch.length === 0) {
      return {
        ok: true,
        list,
        pages,
        windowComplete: more !== true,
        note: more === true ? `第 ${page} 页是空页，而平台仍说还有 ⇒ 按取不满收` : null,
      };
    }
    if (more === false || (more === null && batch.length < ISSUE_PAGE_SIZE)) {
      return { ok: true, list, pages, windowComplete: true, note: null };
    }
  }
  return {
    ok: true,
    list,
    pages,
    windowComplete: false,
    note: `**取不满**：防失控上限 ${maxPages} 页翻满而平台仍说还有 ⇒ 窗口外的单子没有结论`,
  };
}

/**
 * `--find-issues` 的入口：只读、一次只检索一件事。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string|null, keyword:string|null,
 *   state?:string, label?:string|null, maxPages?:number}} ctx
 * @returns {number} `CODE` 之一
 */
export function runFindIssues({ run, log, slug, keyword, state = "all", label = null, maxPages }) {
  if (!slug) {
    log("[find-issues] 取不到仓库 slug ⇒ 无法向平台问单，这一格没有结论。");
    return CODE.NOT_RUN;
  }
  const word = String(keyword ?? "").trim();
  if (word === "") {
    log("[find-issues] 没给关键词 ⇒ 不把「取不到」冒充「没有同类单」。");
    return CODE.NOT_RUN;
  }
  const states = state === "all" ? ["open", "closed"] : [state];
  /** @type {ReturnType<typeof issueRows>} */
  const rows = [];
  let pages = 0;
  for (const s of states) {
    const got = fetchIssues(run, slug, { state: s, keyword: word, label, maxPages });
    if (!got.ok) {
      log(`[find-issues] ${s}：${got.note} ⇒ 这一格没有结论（退 2 不是「没有」）。`);
      return CODE.NOT_RUN;
    }
    pages += got.pages;
    rows.push(...issueRows(got.list));
    if (!got.windowComplete) {
      log(`[find-issues] ${s}：${got.note} ⇒ 窗口没取满，不念「没有同类单」（退 2）。`);
      return CODE.NOT_RUN;
    }
  }
  rows.sort((a, b) => b.number - a.number);
  log(
    `[find-issues] 关键词「${word}」· 状态 ${state}${label ? ` · 标签 ${label}` : ""} · ` +
      `翻了 ${pages} 页 / 命中 ${rows.length} 张（取数窗口取满）`,
  );
  for (const r of rows) {
    log(
      `  #${r.number} · ${r.state} · ${r.title}${r.labels.length ? ` · [${r.labels.join(", ")}]` : ""}${r.url ? ` · ${r.url}` : ""}`,
    );
  }
  if (rows.length === 0) {
    log("[find-issues] 窗口取满也没有命中 ⇒ 这一次确实没查到，不是「没取到」。");
  }
  return CODE.GREEN;
}
