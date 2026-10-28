/**
 * `affected-launch-junit-io.mjs` —— 组 C 读数的 **junit 取数与落盘形状层**。
 *
 * 为什么单独一份：这三件事钉的是同一个布局（写侧的 `--outputFile.junit`、清单落盘、
 * 读回失败 suite），而布局两侧必须逐字同形 —— 它和「跑一块并判决」是两个各自会变的
 * 方向。拆开另有直接代价：机制层长到读不动时，失效形态是「这条判据恒绿」，不是报错
 * （§12.6 R5 / `scripts/check-infra-file-size.cjs` 的 900 行硬闸，出口只有「拆」）。
 *
 * 三个形状都是实测钉住的，注释留在函数上；用例在
 * `tests/hook-affected-launch.test.ts`（它同时 import 读的那一侧 `precommit-timing.mjs`，
 * 因为只测写侧挡不住读侧改了前缀）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  C_MANIFEST_NAME,
  cFileXmlName,
  failingSuiteTextsFromJunit,
} from "./precommit-timing.mjs";

/**
 * 组 C 的**分文件耗时**读数出口（vitest 的 junit reporter）。
 *
 * 为什么要有它：`precommit-timing` 记的是「五个组各自的墙钟 + D 组 51 步的分步账」，
 * 而**组 C（固定清单 90 份 + 受影响用例）在账本里只有一个数** —— 偏偏那一个数就是
 * 整次提交的几乎全部（本机 13 次：总中位 1110s，组 C 中位 1108s）。于是「90 份里谁最贵」
 * 这句要砍线的话，从来没有数据可答，只能靠印象 —— 那正是 §13.5.8.2.1 那条
 * 「代价一律取稳态读数」反对的形态。这一档**只补读数，不改任何判定**。
 *
 * 三个形状都是实测钉住的，不是风格：
 *  · **人类可读的那个 reporter 必须显式在场** —— 只给 junit 会把整屏顶掉，而真红那一屏
 *    是唯一能读的东西（本档不替代它，只加一层）。调用点已经给了 console reporter
 *    （`quiet` 档的 `--reporter=dot`）时传 `withDefaultReporter: false`：再叠一个
 *    `default` 会让同一跑打两遍，正好把日志预算那一档省下来的东西还回去（ISSUE #2074
 *    —— 这两个开关此前从未同时打开，平台那格拿到账本目录之后才第一次相遇）；
 *  · 明细**走文件不走 stdout** —— 钩子与平台的日志预算都不是给 90 行明细留的位
 *    （同一动机见 `vitest.config.ts` 里覆盖率 reporter 那格：102400 字节的硬上限）；
 *  · **每块、每遍各一个文件** —— 复跑是「更隔离条件下的另一组读数」，与首跑叠进同一个
 *    文件就变成「谁后写谁冒充整体」。读账侧按 `(块, 遍)` 升序合并，第二遍覆盖第一遍。
 *
 * @param {string | undefined} dir 落点目录（钩子里就是导出的 `$LOGD`；平台那一格由
 *   `ci-affected-tests.mjs` 自己造一份 —— 两处都**不在检出里**，落进检出就会被
 *   checkout 与结构门禁牵着）
 * @param {number} chunkId 第几块（从 0 起）
 * @param {number} attempt 第几遍（1 = 首跑，2 = `--no-file-parallelism` 隔离复跑）
 * @param {{withDefaultReporter?: boolean}} [options] 见上面第一条；默认 `true`
 * @returns {string[]} 追加给 vitest 的参数；`dir` 为空时**回空数组**（= 今天的形状不变，
 *   人自己跑 `node scripts/run-affected-tests.mjs --full` 时没有 `$LOGD`，不该被塞读数）
 */
export function junitReportArgs(
  dir,
  chunkId,
  attempt,
  { withDefaultReporter = true } = {},
) {
  if (!dir) return [];
  return [
    ...(withDefaultReporter ? ["--reporter=default"] : []),
    "--reporter=junit",
    `--outputFile.junit=${cFileXmlName(dir, chunkId, attempt)}`,
  ];
}

/**
 * 把这次真正要跑的清单落一份到账本目录里 —— 读账侧拿它做**对账**。
 *
 * 没有它，「junit 里只有 88 份」与「这次清单就是 88 份」在账本里**逐字同形**，
 * 而前者意味着有两份用例根本没跑出读数（加载即炸 / 被跳过 / reporter 没记上）。
 * 「少跑几条没有任何判据会看见」是本仓立案的那一族（§13.5.8.2、§13.5.12），
 * 所以读数必须自带分母。写不进去只少一条对账，不拦提交（与记账同口径）。
 *
 * @param {string} dir
 * @param {string[]} files
 * @returns {boolean} 是否落盘成功
 */
export function writeFilesManifest(dir, files) {
  if (!dir) return false;
  try {
    writeFileSync(
      path.join(dir, C_MANIFEST_NAME),
      `${files.join("\n")}\n`,
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 读第 2 遍那份 junit 的**失败 suite 及各自文本**（判决按文件分开的依据）。
 *
 * 读不到就回空数组 —— 空数组在 `classifyRetry` 里会得到「每份都认不出自己」，
 * 那一档的行为是补跑或退 2，**不是**放行。方向刻意只往「多测、少放行」偏：
 * 把「读不到」读成「没有超时指纹」会把真红放大，读成「全是超时」会把真红吞掉，
 * 而吞掉那一型正是 ISSUE #2225 的现场。
 *
 * @param {{junitDir?: string, chunkId: number, read?: (file: string, enc: string) => string}} input
 * @returns {{name: string, body: string}[]}
 */
export function readRetrySuiteFailures(input) {
  const dir = input.junitDir ?? "";
  if (!dir) return [];
  const read = input.read ?? readFileSync;
  let xml;
  try {
    xml = read(cFileXmlName(dir, input.chunkId, 2), "utf8");
  } catch {
    return [];
  }
  return failingSuiteTextsFromJunit(xml);
}
