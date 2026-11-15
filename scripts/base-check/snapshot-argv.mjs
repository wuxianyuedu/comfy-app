import { readHookSteps } from "./hook-steps.mjs";
import path from "node:path";

/** #3930：判据路径迁移后，快照（上游）树用的是**上游自己的钩子**（旧路径），
 * 而本检出的钩子已是新路径 —— 基线/合并态那一侧按**快照自己的钩子**解析同一标签，
 * 否则基线侧对每一条搬过家的判据都 127（找不到模块）⇒ 整批复算不可归因（退 2）。
 * 快照钩子里没有的标签照旧用本检出的 argv（那一格在基线上真的不存在）。
 *
 * @param {string} worktreePath
 * @returns {(label: string, fallbackArgv: string[]) => string[]}
 */
export function snapshotArgvResolver(worktreePath) {
  /** @type {Map<string, string[]> | null} */
  let map = null;
  return (label, fallbackArgv) => {
    if (map === null) {
      map = new Map();
      try {
        for (const s of readHookSteps(path.join(worktreePath, ".githooks", "pre-commit"))) {
          map.set(s.label, s.argv);
        }
      } catch {
        // 快照钩子读不到（理论不可达：全量检出必有 .githooks）⇒ 退回本检出 argv
      }
    }
    return map.get(label) ?? fallbackArgv;
  };
}
