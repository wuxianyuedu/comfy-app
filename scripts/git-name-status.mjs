/**
 * `git diff --name-status -M` 的输出 → 改动面（纯函数、零外部依赖）。
 *
 * 为什么单独成模块：它被两条判据链复用 —— `changed-scope.mjs`（`check-format` /
 * `check-doc-mirror-pairing` 这些把脚本拷进**没有 node_modules** 的临时工作区里跑的
 * 用例的输入面）与 `affected-tests.mjs`（说明符扫描器，import 了 `typescript`）。
 * 放在后者里时，沙箱里那份 `changed-scope.mjs` 会连带解析 `typescript`，模块加载
 * 当场炸（ISSUE #2830 的现场：`ERR_MODULE_NOT_FOUND: Cannot find package
 * 'typescript' imported from <temp>/scripts/affected-tests.mjs`）。切分之后低层只
 * 依赖 `launcher-core/sync-attribution.mjs` 的 `parseDiffEntries`（同样是零依赖）。
 */
import { parseDiffEntries } from "./launcher-core/sync-attribution.mjs";

/** 仓库相对路径的规范形态：去空白、反斜杠转正斜杠。 */
/** @param {string} raw @returns {string} */
export function normalizeRel(raw) {
  return String(raw).trim().replace(/\\/g, "/");
}

/**
 * `git diff --name-status -M` 的输出 → 改动面。
 *
 * 为什么不用 `--name-only`：改名（`R`）在那一份输出里**只给新路径**，而旧路径才是
 * 「谁按路径消费了它」的线索 —— 用旧路径读文件、又不 import 的用例因此整条漏跑
 * （ISSUE #2226）。`R` 行把新旧两边都收进改动面；`C`（复制）源文件没变，只收新路径。
 * 解析复用 `launcher-core/sync-attribution.mjs` 的 `parseDiffEntries`（运行期陈旧路由
 * 归因也在用它，不另写一份切分）。
 *
 * @param {string} output `git diff --name-status -M` 的原始输出
 * @returns {{paths: string[], renamedFrom: string[]}} `paths` 是改动面（含改名旧路径），
 *   `renamedFrom` 只放 `R` 行的旧路径（读出改名事件用）
 */
export function changedPathsFromNameStatus(output) {
  /** @type {string[]} */
  const paths = [];
  /** @type {string[]} */
  const renamedFrom = [];
  for (const entry of parseDiffEntries(output)) {
    if (entry.status === "R" && entry.oldPath) {
      const old = normalizeRel(entry.oldPath);
      if (old) {
        paths.push(old);
        renamedFrom.push(old);
      }
    }
    const next = normalizeRel(entry.path);
    if (next) {
      paths.push(next);
    }
  }
  return {
    paths: [...new Set(paths)],
    renamedFrom: [...new Set(renamedFrom)],
  };
}
