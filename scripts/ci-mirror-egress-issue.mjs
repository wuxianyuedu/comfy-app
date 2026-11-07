#!/usr/bin/env node
/**
 * `ci-mirror-egress-issue.mjs` —— 每日档「镜像出勤 / egress 立案」的**自动执行者**（ISSUE #3278 方案 B）。
 *
 * ## 补的是哪一格
 *
 * `pnpm check:mirror-attendance`（#3046 期望第 2 条）早就把「GitHub 镜像那一格有没有推成、
 * 没推成是什么形状」判得清清楚楚，但它是**按需档**：`.cnb.yml` 的 PR / 每日 / push 三档里
 * 都没有一格跑它。于是「节点到 `github.com:443` 断流」这件事只有在有人手动敲一次命令、
 * 或某条 PR 恰好红了被人翻日志时才看得见 —— 判据在场、执行者不在场（§13.5.13 那一族）。
 *
 * 更隐蔽的是第二层：修 `judgeMirrorAttendance()` 前，窗口里只要**有一次** present 就退 0。
 * 现场 24h 窗口 `6 present + 2 egress` 仍是 `code=0 / verdict=present`。也就是说，就算
 * 给它挂个每天跑的执行者，间歇性断流期间它也会天天绿、一张单都不立。
 * 所以 #3278 同时做了两件事：判据里多一份 `signal`（`check-mirror-attendance.mjs`），
 * 本文件则是那个**按信号决定要不要写单**的执行者。
 *
 * ## 保持承重（方案 B 的边界，与 #3046 口径一字不差）
 *
 * 本文件**不改** `ci-github-mirror-push.mjs`、不给镜像格加回 `--readout`、不动
 * `GitHub 判决回读 / 日志分块 ×3 / GitHub 判决判定` 的 fail-closed。断流时 PR 照旧会红 ——
 * 这一点没有变。变的是：红之前 ≤24h 已有一张单把「环境红 ≠ 内容红」写成了机器可读的读数，
 * 人不必逐条翻构建日志去确认「这次红是不是又是节点出网」。
 *
 * 之所以不把这一格做成**会红的判据**：CNB stage 串行且失败即停，而 `每日单元测试` /
 * `每日全量E2E` 的唯一执行者就在其后。间歇性 egress 几乎天天有，一条天天红的读数格会把
 * 每日档整条链 skip 掉（§13.5.21）。所以平台那一跳带 `--no-block`：非零都折成退 0，
 * 但**那句红话原样打在屏幕上**并给可粘贴的手工出口，由用例钉住「不许改成静默 return」。
 * 它自己坏掉时用「后面几格没有读数」换「红被承认」是不划算的，与 `每日失败立案` 同一取舍。
 *
 * ## 判据链一个字都不另立（§12.12 / §12.18）
 *
 * 取数 / 逐格读数 / 判决 / 环境红信号 = `collectMirrorAttendance()` 那一份（内含
 * `fetchBuildsCoveringWindow()` / `readMirrorCell()` / `judgeMirrorAttendance()`）；
 * 开着的单 = `openDailyIssues()`；建单与「写后独立回读」= `runNewIssue()` /
 * `runAppendIssueComment()`；署名 = `machineHandle()` / `commentHeader()`。
 * 本文件只新增三件：**去重键**、**正文怎么摆**、**按信号决定写不写**。
 *
 * ## 三态退码（本地 / 判据档）与平台折码
 *
 *  · `0` 有结论（不用写 / 写成了）；
 *  · `1` 该写的没写成（建单被拒 / 写后回读不到）；
 *  · `2` 没结论（列表取不到 / 窗口没盖满 / 开着的单取不到）—— **不新建、不判绿**（§13.6.3）。
 * 平台带 `--no-block`：非零都落 0，话术照打。
 *
 * ## 为什么这一格排在 `每日安装依赖` 之后
 *
 * 自托管 runner 的宿主 PATH 上**没有 `cnb`**（`ci-token-scopes.mjs` 的五跑读数：装依赖
 * 那一格的日志里只有 node / pnpm / git）。`makeRunner()` 里的 `cnbSpawn()` 要在装完依赖
 * 之后才解析得到包真身 —— 同一跑的 `PR 失败立案` 好得很，正是因为它在依赖装好之后。
 * 排在安装之后是**执行者能不能起来**的问题，不是偏好；排在 `每日单元测试` 之前则是
 * §13.5.21 那条「最后一条会红的格」的约束（本格本身不红，也不许挪到它后面）。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci-mirror-egress-issue.mjs --no-block      # 平台每日那一格
 * node scripts/ci-mirror-egress-issue.mjs --dry-run        # 只打印将写什么，一条都不写
 * node scripts/ci-mirror-egress-issue.mjs --hours 72       # 换窗口
 * ```
 */
import path from "node:path";
import process from "node:process";

import {
  collectMirrorAttendance,
  DEFAULT_DETAIL_LIMIT,
  DEFAULT_WINDOW_HOURS,
} from "./check-mirror-attendance.mjs";
import { CODE } from "./check-daily-attendance.mjs";
import { openDailyIssues } from "./ci-daily-failure-issue.mjs";
import { resolveRepoSlug } from "./ci-build-readout.mjs";
import { machineHandle } from "./dev-handle.mjs";
import { makeRunner, writeScratch } from "./ship-exec.mjs";
import { runAppendIssueComment, runNewIssue } from "./ship-issue-new.mjs";
import { commentHeader } from "./ship-ticket.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 三态与仓内其余档同口径。 */
export const ISSUE_CODE = { DONE: 0, WRITE_FAILED: 1, NO_FACT: 2 };

/**
 * 去重键：**标题里的固定串**，不带构建号 / 时刻 / 次数。
 * 那些量每天都不一样，进键就等于「同一件事每天新开一张」（与 #2399 同一族）。
 * 治理口径本身在 #3278 跟踪；本单是「出勤读数」这一族，不与之合并（#2251 一条诉求一张单）。
 */
export const EGRESS_ISSUE_TITLE_KEY = "ci(mirror): GitHub 镜像同步 egress 出勤读数";

/** 建单标题（键 + 一句定性；定性不进键，改措辞不会把去重打断）。 */
export const EGRESS_ISSUE_TITLE = `${EGRESS_ISSUE_TITLE_KEY}（环境红）`;

/** 优先级：环境红不阻塞代码内容，但不立案就会一直没人问 ⇒ P2，不跟 P1 的每日失败立案抢视线。 */
export const EGRESS_ISSUE_PRIORITY = "P2";

/** 机器标记：日志抓取 / 人翻单子都认这一串，别写成自然语言的一句话。 */
export const ENVIRONMENT_RED_MARK = "environment-red=github-mirror-egress";

/**
 * 这一批要不要写。**纯函数**，所以每种形状都能离线钉住，不必造平台读数。
 *
 * 四道门依次为：判据没给结论 ⇒ 不写；信号说没环境红 ⇒ 不写；开着的单取不到 ⇒ 不写；
 * 剩下的才写，并顺手给出「已有旧单就追加、没有就新建」。
 *
 * @param {{out:{code:number, signal:{signal:string, shouldFile:boolean, note:string}},
 *   existing:Array<{number:number,title:string}>|null}} input
 * @returns {{action:"none"|"no-fact"|"write", reason:string, number?:number}}
 */
export function decideEgressAction({ existing, out }) {
  if (out.code === CODE.NO_VERDICT) {
    return {
      action: "no-fact",
      reason: "出勤判据没给结论（列表取不到 / 窗口没盖满 / 没有这一格）⇒ 不写单",
    };
  }
  if (!out.signal.shouldFile) {
    return {
      action: "none",
      reason: `signal=${out.signal.signal} ⇒ 窗口内没有需要立案的环境红：${out.signal.note}`,
    };
  }
  if (!Array.isArray(existing)) {
    return {
      action: "no-fact",
      reason: "取不到「开着的单」列表 ⇒ 不知道该新建还是追加，一次都不写（不重复建单）",
    };
  }
  const hit = existing.find((e) => String(e?.title ?? "").includes(EGRESS_ISSUE_TITLE_KEY));
  return {
    action: "write",
    ...(hit ? { number: Number(hit.number) } : {}),
    reason: hit
      ? `同一族已有 #${hit.number} ⇒ 在旧单下追加一条读数，不新建`
      : "这一族还没有开着的单 ⇒ 新建一张",
  };
}

/**
 * 正文：只有读数与出口，**不替任何人判根因**（与 `ci-daily-failure-issue.mjs` 同一纪律）。
 *
 * 两处是刻意的：① `code/verdict` 原值照抄，明写「退码一字未改」—— 免得读者把
 * `code=0` 看成「今天没红过」；② 机器标记单独成行，让日志 / 单子都能被 grep 认出来，
 * 而不是藏在一段人话里。
 *
 * @param {{out:any, reading:{asked:string[], coverage:string, windowBuilds:number},
 *   handle:string, windowHours:number, batch:string, slug:string}} input
 * @returns {string}
 */
export function composeEgressBody({ batch, handle, out, reading, slug, windowHours }) {
  const signal = out.signal;
  const shapes = Object.entries(out.stats.shapeCounts)
    .map(([shape, n]) => `${shape}×${n}`)
    .join("、");
  return [
    commentHeader(handle),
    "",
    `> \`${ENVIRONMENT_RED_MARK}\` · \`signal=${signal.signal}\` · \`egress=${signal.egress}/${signal.seen}\``,
    "",
    "## 症状（每日档自动出勤格立案，正文只含读数）",
    "",
    `- 窗口 ${windowHours}h · 读数时刻 \`${batch}\` · 窗口内共 ${reading.windowBuilds} 跑`,
    `- 出勤判决：\`code=${out.code} / verdict=${out.verdict}\`（**三态退码一字未改**）`,
    `- 逐跑形状：${shapes || "(无)"}；其中 \`egress\` ${signal.egress} 跑`,
    `- 覆盖自证：${reading.coverage}`,
    `- 逐跑读了正文的构建：${reading.asked.join("、") || "(空)"}`,
    "",
    "## 机器可读的那一句：**环境红 ≠ 内容红**",
    "",
    "这几跑的红来自 `Runner[orange-connector]` 到 `github.com:443` 的出网，",
    "**不是**本批 PR 的代码、判据或令牌缺陷；与「内容红」分开认，别拿它去改镜像格的重试预算。",
    "镜像格与 `GitHub 判决回读 / 判定` 整条链维持承重（#3046 口径未改），断流时 PR 仍会红。",
    "治理口径跟踪在 #3278；本单只记「窗口里出现过环境红」这一族的逐日读数。",
    "",
    "## 根因：**未判定**",
    "",
    "本格不替任何人判「节点侧为什么断流」。下一动作在**仓库改不了**的那一层：",
    "白名单 / 代理 / 换 runner（`SHAPE_NOTES.egress` 同一句）。",
    "",
    "手工出口（可粘贴）：",
    "",
    "- `pnpm check:mirror-attendance --json` —— 同一份判据，看 `signal` 与逐跑形状",
    "- `pnpm ship --diagnose <构建号>` —— 认某一跑红在哪一格",
    `- 日志出处：https://cnb.cool/${slug}/-/build/logs/<构建号>`,
    "",
    "> 本单由 `scripts/ci-mirror-egress-issue.mjs` 建；判据链复用 `check-mirror-attendance.mjs`，没有第二套判决。",
    "> 同一族再次出现时**不新建**，在这张单下追加一条读数 —— 号一关，欠着的东西连可见性都没了。",
  ].join("\n");
}

/**
 * 入口。取数 / 写单全部可注入，用例一次平台命令都不发。
 *
 * @param {{argv?:string[], run?:any, log?:(s:string)=>void, slug?:string|null, now?:number,
 *   windowHours?:number, limit?:number, collect?:Function, existing?:Array<{number:number,title:string}>|null}} [io]
 * @returns {number} `ISSUE_CODE` 之一（带 `--no-block` 时非零落 0，话术照打）
 */
export function main(io = {}) {
  const argv = io.argv ?? process.argv.slice(2);
  const log =
    io.log ??
    ((s) => {
      console.log(s);
    });
  const run = io.run ?? makeRunner(ROOT);
  const dryRun = argv.includes("--dry-run");
  const noBlock = argv.includes("--no-block");
  const now = io.now ?? Date.now();
  const windowHours = io.windowHours ?? DEFAULT_WINDOW_HOURS;
  const limit = io.limit ?? DEFAULT_DETAIL_LIMIT;
  const slug = io.slug === undefined ? resolveRepoSlug(run) : io.slug;
  const handle = machineHandle("ci-daily", process.env);
  /** 这一批的唯一标记：追加评论时「写后独立回读」按它认是不是自己刚写的那一条。 */
  const batch = new Date(now).toISOString();

  /** @param {number} code @param {string} why @returns {number} 退码出口：`--no-block` 只改码，不改话术。 */
  const finish = (code, why) => {
    if (code !== ISSUE_CODE.DONE && noBlock) {
      log(
        `[mirror-egress] ※ 这一格本该以退码 ${code} 结束（${why}），` +
          "但平台那一跳带 `--no-block`：**不拦路**。上面那句就是它的全部出口 —— " +
          "「看不见」才是这一格唯一的失效形态，别把它改成静默 return。",
      );
      return ISSUE_CODE.DONE;
    }
    return code;
  };

  if (!slug) {
    log("[mirror-egress] 推不出仓库 slug ⇒ 这一格没有执行者。");
    return finish(ISSUE_CODE.NO_FACT, "推不出仓库 slug");
  }
  const collect = io.collect ?? collectMirrorAttendance;
  const reading = collect({ limit, now, run, slug, windowHours });
  if (reading?.ok !== true) {
    log(`[mirror-egress] 没结论 ? ${reading?.why ?? "取数没给形状"} ⇒ 不写单。`);
    return finish(ISSUE_CODE.NO_FACT, "出勤取数没给结论");
  }
  const { out } = reading;
  log(
    `[mirror-egress] ${ENVIRONMENT_RED_MARK} signal=${out.signal.signal}` +
      ` egress=${out.signal.egress}/${out.signal.seen} code=${out.code}/${out.verdict}` +
      ` · ${out.signal.note}`,
  );

  const existing = io.existing === undefined ? openDailyIssues(run, slug) : io.existing;
  const decision = decideEgressAction({ existing, out });
  log(`[mirror-egress] ${decision.reason}`);
  if (decision.action === "none") {
    return ISSUE_CODE.DONE;
  }
  if (decision.action === "no-fact") {
    return finish(ISSUE_CODE.NO_FACT, decision.reason);
  }

  const body = composeEgressBody({ batch, handle, out, reading, slug, windowHours });
  if (dryRun) {
    log(
      `[mirror-egress] --dry-run：${decision.number ? `在 #${decision.number} 下追加` : `新建「${EGRESS_ISSUE_TITLE}」`}` +
        ` · 正文 ${body.length} 字 · 优先级 ${EGRESS_ISSUE_PRIORITY} · 一条都没写`,
    );
    return ISSUE_CODE.DONE;
  }

  /** @param {string} name @param {string} text @returns {string | null} 落点仍走 `writeScratch` 那一份。 */
  const mkTmp = (name, text) => writeScratch(ROOT, name, text);
  if (decision.number) {
    const ok = runAppendIssueComment({
      body,
      log: (line) => {
        log(`[mirror-egress] ${String(line).replace(/^\[ship\]\s*/, "")}`);
      },
      marker: batch,
      mkTmp,
      number: decision.number,
      run,
      slug,
    });
    if (!ok) {
      log(
        `[mirror-egress] ✗ #${decision.number} 的读数没写成或回读不到 ⇒ 手工出口：` +
          `cnb issues post-issue-comment --repo ${slug} --number ${decision.number} --body-file <正文文件> -v`,
      );
      return finish(ISSUE_CODE.WRITE_FAILED, "追加读数没写成或回读不到");
    }
    log(`[mirror-egress] ✓ 已在 #${decision.number} 追加一条读数并独立回读到（不新建）`);
    return ISSUE_CODE.DONE;
  }

  const file = mkTmp("mirror-egress-issue", body);
  if (!file) {
    log("[mirror-egress] ✗ 取不到 git 目录 ⇒ 正文没有落点，一条都不写。");
    return finish(ISSUE_CODE.WRITE_FAILED, "正文没有落点");
  }
  const code = runNewIssue({
    dryRun: false,
    handle,
    log: (line) => {
      log(`[mirror-egress] ${String(line).replace(/^\[ship\]\s*/, "")}`);
    },
    mkTmp,
    opt: {
      issueBodyFile: path.relative(ROOT, file),
      newIssue: EGRESS_ISSUE_TITLE,
      priority: EGRESS_ISSUE_PRIORITY,
    },
    root: ROOT,
    run,
    slug,
  });
  if (code !== ISSUE_CODE.DONE) {
    log(`[mirror-egress] ✗ 那张单没建成（runNewIssue 退 ${code}）`);
    return finish(ISSUE_CODE.WRITE_FAILED, `runNewIssue 退 ${code}`);
  }
  log(`[mirror-egress] ✓ 已立案「${EGRESS_ISSUE_TITLE}」（建 → 补标签 → 独立回读全过）`);
  return ISSUE_CODE.DONE;
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const exit = main();
  if (exit !== ISSUE_CODE.DONE) {
    process.stderr.write(`[mirror-egress] exit ${exit}\n`);
  }
  process.exit(exit);
}
