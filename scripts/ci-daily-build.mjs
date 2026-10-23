#!/usr/bin/env node
/**
 * ci-daily-build.mjs — 「生产构建**每天一次**」那条定时流水线的**唯一入口**（ISSUE #2010）。
 *
 * ## 为什么要有这一条（它回答的是另一个问题）
 *
 * `pull_request` 那条流水线上**曾经**有「生产构建」这一步（`artifact-run.mjs`），
 * 它回答的是「**这次改动**能不能构建出来」；2026-10-18 那一格被撤走，理由是同一份
 * `pnpm run build` 链在本地已经有一笔必须还的账（`新鲜度账` 读
 * `FRESHNESS_TRACKS.artifact.dirty`：动了构建输入面 ⇒ 当天自己证一次），PR 上再跑一次
 * 是第二个执行者而不是第二份信息。而用户要的是另一件事：
 * **master 上那份源码，今天能不能构建出来** —— 哪怕今天一行代码都没改。
 *
 * 两者的差别不是形式上的，这三类是本档答得到而 PR 答不到的：
 *
 *   · **时间**：`next build` 的结果不只取决于源码，还取决于它抓得到什么。实测过的
 *     形态就在本仓：`API 文档生成与自检` 那一格是因为 typedoc 与锁文件的对不上
 *     才红的（不是源码写错），而下游依赖的 advisory、Playwright 的下载根、节点上
 *     的 Python 解释器都会在某一天早上变掉 —— PR 上没有改动的那几天，这些一律看不见。
 *   · **谁在跑**：PR 上是「最后推分支的那位」，master 上是「最后改配置的那位」
 *     （官方 crontab 文档的负责人机制）。定时任务把执行身份交给配置的持有者，
 *     于是「这条流水线红了」这件事有一个确定的人去看。
 *     ⚠️ 这一条自 2026-10-18 起是**双刃**的：PR 那一格撤了之后，「构建坏了」唯一的
 *     机器目击者就是这一跑，而它的执行身份**不是改坏的那个人**。红了先按 master 的
 *     提交区间找（`git log --since=<上一次绿的构建>`），别按负责人机制直接派单。
 *   · **频率**：PR 上跑得多（每推一次就是一整条），但**空转**的日子一条都没有；
 *     这里反过来，一天一条。
 *
 * ## 为什么它不是一个新判据，只是 `artifact-run.mjs` 的一层壳
 *
 * 「构建能不能过」的判据**一个字都不该在这里重写**：`pnpm run build` 那串链
 * （`next build` → 剥私有输入 → 数产物 → 冒烟）是 AGENTS 硬规则 17/18 的产物级防线，
 * 记账走 `artifact-run.mjs`（跑绿即刷 `scripts/.artifact-freshness.json`）。
 * 本文件多出来的只有三件**跑这一次才有意义**的事：
 *
 *   ① 把「这一跑是**定时那一跑**」写出来（日志里那是我唯一的身份线索：
 *      失败时人拿到的是 `master` 的一个快照，`CNB_EVENT` / `CNB_BUILD_ID` 之外
 *      什么都没有）；
 *   ② 报一次**工具链身份**（`scripts/ci-image-identity.mjs`，读数、恒退 0）——
 *      定时那一跑是这台节点上唯一「每天都会发生」的事件，环境变了要在这里看见；
 *   ③ 把 `artifact-run.mjs` 的退出码**原样转出去**（定时任务的成败只看退出码）。
 *
 * ## 它刻意不做的事（每一条都是有过代价的）
 *
 *   · **不再记一次账**：`artifact-run.mjs` 跑绿时已经记了。这里再写一遍只会造出
 *     「两处各记一次」的第二份实现（§12.12），而两份一漂，账面上看不出哪份是真的。
 *   · **不改任何文件**：定时任务的工作区是**一次性检出**，写下的东西不落回任何分支 ——
 *     所以「跑绿了就把账提交回去」这件事在这里是**不成立**的，别照着
 *     `writeFreshness` 的注释去想那条路（回写仓库是一条单独的决策，见 §13.5.4）。
 *   · **不冒充整档 e2e / 全量单测**：那两档有各自的账与各自的口径，本条只答构建。
 *
 * ## 用法
 *
 *   node scripts/ci-daily-build.mjs               # 定时那一跑（`.cnb.yml` 的 crontab 流水线）
 *   node scripts/ci-daily-build.mjs --dry-run     # 只打印会做什么（本机自查 / 用例）
 *
 * 本机想复现同一条链不必经过它：`pnpm build:tracked`（同一个入口，只是少了那两句读数）。
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { imageIdentity } from "./ci-image-identity.mjs";
import { ARTIFACT_TIMEOUT_MS, main as artifactMain } from "./artifact-run.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 这一次是不是「定时那一跑」—— 只看平台给的事件变量（官方 `build-in-env.md`）。
 *
 * 它**只是读数**（进日志、给失败时的第一眼），不改变任何分支：本文件的入场券本来
 * 就是「被 crontab 那条流水线调起来」，所以即使变量为空也照跑（例如本机自查）。
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{event: string, buildId: string, user: string}}
 */
export function runContext(env = process.env) {
  return {
    event: String(env.CNB_EVENT ?? "(本机 / 无事件变量)"),
    buildId: String(env.CNB_BUILD_ID ?? "(无)"),
    user: String(env.CNB_BUILD_USER_NICKNAME ?? env.CNB_BUILD_USER ?? "(无)"),
  };
}

/**
 * 打这一次的身份（**不含任何判据**）。
 *
 * @param {{env?: NodeJS.ProcessEnv, log?: (line: string) => void}} [deps]
 * @returns {number} 恒 0
 */
export function announce({ env = process.env, log = console.log } = {}) {
  const context = runContext(env);
  log("== 每日生产构建 ==");
  log(
    `触事件：${context.event}（构建 ${context.buildId}，执行身份 ${context.user}）` +
      " —— 定时任务看的是 master 的 HEAD，与「今天有没有人推代码」无关",
  );
  return 0;
}

/**
 * 真跑一次：身份读数 → 构建（判据全在 `artifact-run.mjs` 里）→ 转出退出码。
 *
 * @param {{argv?: string[], log?: (line: string) => void, runBuild?: (argv: string[]) => number, identity?: (deps: object) => {exitCode: number}}} [deps]
 * @returns {number}
 */
export function main({
  argv = process.argv.slice(2),
  log = console.log,
  runBuild = artifactMain,
  identity = imageIdentity,
} = {}) {
  announce({ log });
  /* 镜像身份是**读数**（它自己恒退 0，理由见那份文件的头注）：
   * 放在构建之前，是因为它要描述的是「这一跑跑在什么环境上」—— 构建把机器搅热之后
   * 再读，读到的是另一台机器的样子。它的输出混进构建日志不影响退出码。 */
  identity({ log });
  return runBuild(argv);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
