#!/usr/bin/env node
/**
 * `affected-launch-junit.mjs` —— 组 C 的**分文件耗时读数**出口（vitest 的 junit reporter）。
 *
 * ## 为什么要有它
 *
 * `precommit-timing` 记的是「五个组各自的墙钟 + D 组的分步账」，而**组 C（固定清单 +
 * 受影响用例）在账本里只有一个数** —— 偏偏那一个数就是整次提交的几乎全部（本机 13 次：
 * 总中位 1110s，组 C 中位 1108s）。于是「那几十份里谁最贵」这句要砍线的话从来没有数据
 * 可答，只能靠印象 —— 那正是「代价一律取稳态读数」反对的形态。这一档**只补读数，
 * 不改任何判定**。
 *
 * ## 三个形状都是实测钉住的，不是风格
 *
 *   · **`--reporter=default` 必须显式保留**：只给 junit 会把人类可读的输出顶掉，而真红
 *     那一屏是唯一能读的东西（本档不替代它，只加一层）；
 *   · 明细**走文件不走 stdout**：钩子与平台的日志预算都不是给几十行明细留的位
 *     （同一动机见 `vitest.config.ts` 里覆盖率 reporter 那格：102400 字节的硬上限）；
 *   · **每块、每遍各一个文件**：复跑是「更隔离条件下的另一组读数」，与首跑叠进同一个
 *     文件就变成「谁后写谁冒充整体」。读账侧按 `(块, 遍)` 升序合并，第二遍覆盖第一遍。
 *
 * 单独成文件的理由与「话术层」「日志预算」两刀相同（§12.6 R5 / §12.13）：
 * `run-affected-tests.mjs` 是机制层，越长越读不动，而读不动的那一层的失效形态是
 * 「判据恒绿」而不是报错。**判据与形状一个字没改**，换的只是它住哪儿。
 */
import path from "node:path";
import { writeFileSync } from "node:fs";

/* 组 C 分文件读数的**落盘布局**由账本那一侧拥有（读的一侧是格式的权威）。
 * import 而不是各抄一份文件名：抄两份的漂移形态是静默的 —— 改名那侧照常跑、
 * 这侧读不到，而「读不到」在这一格长得和「这次没有读数」一模一样。 */
import { C_MANIFEST_NAME, cFileXmlName } from "./precommit-timing.mjs";

/**
 * 追加给 vitest 的分文件耗时参数。
 *
 * @param {string | undefined} dir 落点目录（钩子里就是导出的 `$LOGD`：每次新建、随 trap
 *   删除、**不在检出内** —— 落进检出就会被 checkout 与结构门禁牵着）
 * @param {number} chunkId 第几块（从 0 起）
 * @param {number} attempt 第几遍（1 = 首跑，2 = `--no-file-parallelism` 隔离复跑）
 * @returns {string[]} `dir` 为空时**回空数组**（= 今天的形状不变：人自己跑
 *   `node scripts/run-affected-tests.mjs --full` 时没有 `$LOGD`，不该被塞读数）
 */
export function junitReportArgs(dir, chunkId, attempt) {
  if (!dir) {
    return [];
  }
  return [
    "--reporter=default",
    "--reporter=junit",
    `--outputFile.junit=${cFileXmlName(dir, chunkId, attempt)}`,
  ];
}

/**
 * 把这次真正要跑的清单落一份到账本目录里 —— 读账侧拿它做**对账**。
 *
 * 没有它，「junit 里只有 88 份」与「这次清单就是 88 份」在账本里**逐字同形**，而前者
 * 意味着有几份用例根本没跑出读数（加载即炸 / 被跳过 / reporter 没记上）。「少跑几条
 * 没有任何判据会看见」是本仓立案的那一族（§13.5.8.2、§13.5.12），所以读数必须自带分母。
 * 写不进去只少一条对账，不拦提交（与记账同口径）。
 *
 * @param {string} dir
 * @param {string[]} files
 * @returns {boolean} 是否落盘成功
 */
export function writeFilesManifest(dir, files) {
  if (!dir) {
    return false;
  }
  try {
    writeFileSync(path.join(dir, C_MANIFEST_NAME), `${files.join("\n")}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}
