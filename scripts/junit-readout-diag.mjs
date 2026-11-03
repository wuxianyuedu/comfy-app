/**
 * junit-readout-diag.mjs — 全量单测两份 junit 榜（分文件耗时榜、装载税榜）的**落点诊断**。
 *
 * 从 `scripts/full-suite-run.mjs` 抽出来单独成模块：那一份脚本已过 900 行硬闸
 * （§12.6 R5 姊妹档），诊断逻辑是独立职责，且值得被单测直接核（见 `tests/...`）。
 *
 * 为什么需要它（#2697）：CI 上 vitest 自报「已写入 `<X>`」，父进程按 `path.join(ROOT,…)` 读
 * 同一份字符串却读不到。三种成因必须分得开，否则「读数缺失」又被读成一句含糊的「没有」：
 *   · `dirIsLink` —— 落点目录是链接（realpath 指向别处）：vitest 写到链接另一头，父进程读不到
 *     （这是 #2697 的真实成因；落点已移出 `node_modules`，见 `SUITE_JUNIT_RELATIVE`）；
 *   · `foundElsewhere` —— 报告实际落在别处（落点基准漂移）：回退去读那份，让榜单仍能打出来；
 *   · `exists` 但解析出 0 份 —— 报告在盘、形状对不上（vitest 版本/输出结构变了，或这一跑空跑）。
 */
import fs from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/**
 * 落点诊断的产物（来自 `junitFileDiag` + `findJunitReport`），三态话术按它分流。
 * @typedef {Object} JunitDiag
 * @property {boolean} [foundElsewhere] 报告实际落在别处（落点基准漂移），已回退去读那份
 * @property {string} [actualPath] 实际读到的报告绝对路径
 * @property {boolean} [exists] 预期落点文件存在（但解析出 0 份）
 * @property {number} [size] 预期落点文件字节数
 * @property {string|null} [mtime] 预期落点文件 mtime
 * @property {boolean} [dirIsLink] 落点目录是链接（realpath 指向别处）
 * @property {string} [realDir] 落点目录的 realpath
 */

/**
 * 父进程算出的**预期**路径，与「实际能在盘上找到的报告」是不是一回事。
 *
 * @param {string} expectedAbs 父进程算出的绝对路径
 * @returns {{exists: boolean, size: number, mtime: string|null, dirIsLink: boolean, realDir: string}}
 */
export function junitFileDiag(expectedAbs) {
  const dir = path.dirname(expectedAbs);
  let realDir = dir;
  let dirIsLink = false;
  try {
    realDir = fs.realpathSync(dir).replaceAll("\\", "/");
    dirIsLink = realDir !== dir.replaceAll("\\", "/");
  } catch {
    /* 读不到 realpath（目录不存在等）⇒ 按原路径算，dirIsLink 保持 false */
  }
  /** @type {{exists: boolean, size: number, mtime: string|null, dirIsLink: boolean, realDir: string}} */
  const out = { exists: false, size: 0, mtime: null, dirIsLink, realDir };
  try {
    const st = fs.statSync(expectedAbs);
    out.exists = true;
    out.size = st.size;
    out.mtime = st.mtime.toISOString();
  } catch {
    /* 不存在 ⇒ exists=false，留给调用方区分「没落盘」与「落了读不到」 */
  }
  return out;
}

/**
 * 找 junit 报告：先看预期落点，缺失时在该落点的几个**候选目录**里找同名/同前缀文件。
 *
 * 候选目录既含新落点 `.comfy-ci/` 也含旧落点 `node_modules/.cache/`，是为了在「落点基准
 * 漂移」（#2697 候选 3：子进程的有效 cwd 与 `ROOT` 不一致，报告写到了别处）时仍能找回报告，
 * 让两份榜单在平台侧真的打得出来（#2697 期望 3）。回退读到的若比预期旧，话术里会点名。
 *
 * @param {string} expectedAbs 父进程算出的绝对路径
 * @returns {{path: string, found: boolean, drifted: boolean}}
 */
export function findJunitReport(expectedAbs) {
  if (fs.existsSync(expectedAbs)) {
    return { path: expectedAbs, found: true, drifted: false };
  }
  const base = path.basename(expectedAbs);
  /** @type {Array<{p: string, m: number}>} */
  const hits = [];
  for (const d of [path.join(ROOT, ".comfy-ci"), path.join(ROOT, "node_modules", ".cache")]) {
    try {
      if (!fs.statSync(d).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    for (const f of fs.readdirSync(d)) {
      if (f === base || (f.startsWith("comfy-full-suite-junit") && f.endsWith(".xml"))) {
        try {
          hits.push({ p: path.join(d, f), m: fs.statSync(path.join(d, f)).mtimeMs });
        } catch {
          /* 读到一半被删 ⇒ 忽略这一份 */
        }
      }
    }
  }
  if (hits.length === 0) {
    return { path: expectedAbs, found: false, drifted: false };
  }
  hits.sort((a, b) => b.m - a.m);
  const best = hits[0];
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- hits 上方已判非空，守卫为 noUncheckedIndexedAccess 下 hits[0] 的 undefined 分量收窄
  if (!best) {
    return { path: expectedAbs, found: false, drifted: false };
  }
  return { path: best.p, found: true, drifted: true };
}

/**
 * 「读不到 junit」这一档的**三态**话术（#2697 期望 2）：把「没落盘」「落了但我按这个路径读不到」
 * 「落了也读到了但解析 0 份」分开说 —— 否则读数缺失会被读成一句含糊的「没有」，正是
 * §13.6.4.1「拿不到测量 ≠ 测量结果是 0」的反面。
 *
 * @param {string} kind 榜名（分文件耗时 / 装载税）
 * @param {string} file 父进程算出的落点（绝对）
 * @param {JunitDiag} [diag] `junitFileDiag` + `findJunitReport` 的产物
 * @returns {string[]}
 */
export function junitMissingLine(kind, file, diag) {
  const where = file ? `（落点 ${file}）` : "";
  if (diag?.foundElsewhere) {
    return [
      `[full-suite-run] ${kind}读数：**落了但我按原路径读不到**${where} —— 报告实际在 ` +
        `${diag.actualPath}（与预期不一致，落点基准漂移，见 #2697）。已回退读那份，榜单照打。`,
    ];
  }
  if (diag?.exists) {
    return [
      `[full-suite-run] ${kind}读数：**落盘了但解析出 0 份**${where} —— 报告在盘` +
        `（${diag.size ?? "?"} 字节、mtime ${diag.mtime ?? "?"}），但形状对不上` +
        `（vitest 版本/输出结构变了，或这一跑是空跑、没命中任何位置过滤器）。` +
        `这不是「没落盘」，是「落了读不出」—— 先看本机 \`node scripts/full-suite-run.mjs --dry-run\` 的落点是否一致。`,
    ];
  }
  if (diag?.dirIsLink) {
    return [
      `[full-suite-run] ${kind}读数：**没落盘**${where} —— 落点目录是链接（realpath 指向 ${diag.realDir}），` +
        `vitest 把报告写到了链接另一头，父进程按原路径读不到（#2697：落点已移出 node_modules 规避）。`,
    ];
  }
  return [
    `[full-suite-run] ${kind}读数：**没有** —— junit 未落盘或这一跑没跑到收尾${where}${diag
        ? `（落点目录 realpath = ${diag.realDir}，与计算一致 ⇒ 这一跑 vitest 没写出 junit）`
        : ""}`,
  ];
}
