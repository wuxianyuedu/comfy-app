/**
 * ship-issue-edit.mjs —— `--edit-issue <号> --issue-body-file <文件>` 的写 + 独立回读（ISSUE #5165）。
 *
 * 为什么单独一件：改单子正文此前只能手敲 `cnb issues update-issue --repo … --number … --body-file …`
 * 三件套 —— 参数顺序写错会静默改错单，而 `cnb` 认不出的子命令还退 `0`（SKILL 第 1 条），
 * 所以「回执不算结论」在这里尤其是硬约束。正文只从文件进（argv 内联会在 shell 那一步被
 * 反引号挖洞，与 `--message` 同源），给了 `--priority` 就一并写并回读。
 *
 * 回读的逐字比对复用 `sameCommentBody`（平台会吃掉末尾换行 / 改写图片链接，#2719 / #3655），
 * `get-issue` 的形状复用 `readIssue`，这里不写第二套。
 */
import { sameCommentBody, stripTrailingNewline } from "./ship-comment.mjs";
import { CODE } from "./ship-core.mjs";
import { cnbJson } from "./ship-exec.mjs";
import { readIssue } from "./ship-issue-io.mjs";
import { readIssueBody } from "./ship-issue-new.mjs";

/**
 * 写后回读的结论。纯函数，便于用例直接喂形状。
 *
 * @param {{body:string, priority:string|null, back:{body:string, priority:string}|null, length:number}} input 回读形状
 * @returns {"green"|"red"|"no-run"} 绿 / 红 / 没结论
 */
export function classifyEditReadback({ body, priority, back, length }) {
  if (!back) {
    return "no-run";
  }
  if (!sameCommentBody(body, back.body)) {
    return "red";
  }
  if (priority && String(back.priority ?? "").toUpperCase() !== priority) {
    return "red";
  }
  return length > 0 ? "green" : "no-run";
}

/**
 * `--edit-issue` 的执行体：写 → `get-issue` 独立回读 → 逐字比对。
 *
 * @param {{run:(cmd:string,args:string[])=>any, log:(s:string)=>void, slug:string, number:number, root:string, handle:string|null, mkTmp:(name:string,text:string)=>string|null, opt:any, dryRun?:boolean}} ctx 写与回读所需的注入
 * @returns {number} `CODE` 之一
 */
export function runEditIssue({ run, log, slug, number, root, handle, mkTmp, opt, dryRun = false }) {
  const bodyFile = String(opt.issueBodyFile ?? "").trim();
  if (bodyFile === "") {
    log(
      "[ship] [ERROR] --edit-issue 要和 --issue-body-file <正文文件> 一起用：" +
        "正文是判断，不由脚本生成，也不从 argv 内联读（反引号会在 shell 那一步被当命令替换执行掉）。",
    );
    return CODE.NOT_RUN;
  }
  const read = readIssueBody(root, bodyFile, handle);
  if (!read.ok) {
    log(`[ship] 读不到正文文件：${read.where} ⇒ 这一格没有执行者。`);
    return CODE.NOT_RUN;
  }
  if (read.raw.trim() === "") {
    log(`[ship] 正文文件是空的：${read.where} ⇒ 不把单子正文清成只有署名行。`);
    return CODE.NOT_RUN;
  }
  const priority = String(opt.priority ?? "")
    .trim()
    .toUpperCase();
  if (dryRun) {
    log(
      `[ship] --dry-run：#${number} 将改成 ${bodyFile} 的正文（${read.text.length} 字，` +
        `首行「${String(read.text.split(/\r?\n/)[0]).slice(0, 60)}」）` +
        `${priority ? `，优先级 ${priority}` : ""}，再 get-issue 回读比对；一条都没写。`,
    );
    return CODE.GREEN;
  }
  const file = mkTmp("ship-issue-edit-body", read.text);
  if (!file) {
    log("[ship] 取不到 git 目录 ⇒ 正文没有落点，这一格没有执行者。");
    return CODE.NOT_RUN;
  }
  const wrote = cnbJson(run, [
    "issues",
    "update-issue",
    "--repo",
    slug,
    "--number",
    String(number),
    "--body-file",
    file,
    ...(priority ? ["--priority", priority] : []),
    "-v",
  ]);
  if (!wrote) {
    log(
      `[ship] #${number} 改正文那一步没跑起来（回执不是 JSON）⇒ 不念「已改」；` +
        "下一动作：确认 cnb 与仓库 slug，再跑一次这条命令。",
    );
    return CODE.NOT_RUN;
  }
  const back = readIssue({ run, slug, number });
  const verdict = classifyEditReadback({
    body: read.text,
    priority: priority || null,
    back,
    length: read.text.length,
  });
  if (verdict === "no-run") {
    log(
      `[ship] #${number} 改后回读没跑起来 ⇒ **不念「已改」**：` +
        "写可能已经成功，先去单子上看一眼再决定要不要重投。",
    );
    return CODE.NOT_RUN;
  }
  if (verdict === "red") {
    const got = back?.body ?? "";
    log(
      `[ship] ✗ #${number} 回读与发出的正文不是同一份` +
        `（发出 ${stripTrailingNewline(read.text).length} 字、回读 ${stripTrailingNewline(got).length} 字` +
        `${priority ? ` · 优先级 请求 ${priority} / 回读 ${String(back?.priority ?? "?")}` : ""}）。` +
        "⇒ 不念「已改」；先去单子上看实际内容，别直接重投。",
    );
    return CODE.RED;
  }
  const firstLine = String(String(back?.body ?? "").split(/\r?\n/)[0]).slice(0, 60);
  const priorityText = priority ? ` · 优先级=${String(back?.priority ?? "?")}` : "";
  log(
    `[ship] ✓ #${number} 正文已回读（get-issue，逐字相同）：${stripTrailingNewline(read.text).length} 字 · 首行「${firstLine}」${priorityText}`,
  );
  return CODE.GREEN;
}
