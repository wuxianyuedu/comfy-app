/**
 * affected-graph.mjs —— 「受影响用例」的**图辅助层**：反向遍历与显式源依赖声明。
 *
 * 从 `affected-tests.mjs` 拆出两件纯函数：① `reachFrom` 是反向 import 图的 BFS；
 * ② 用例文件头 `// @affected-source <路径>` 的解析与命中。拆的理由不是「代码多了」，
 * 而是它们与「改动面怎么算、固定清单怎么并」的判决链无关 —— 一个管图怎么走，
 * 一个管边从哪来；放在一起会把判决链本身顶过 §12.6 R5 的 900 行硬闸。
 *
 * 显式声明治的是 #4648 那类盲区：用例用 `join(ROOT, "src-tauri", "src", "lib.rs")`
 * 拼路径读文件，静态 import 图看不到，整串字面量比对面也抓不到；让用例自己登记它读
 * 什么，这里把声明变成图里的边。声明是注释，不会被「按路径引用」那条误当成运行期引用。
 */
import { normalizeRel } from "../lib/git-name-status.mjs";

/** 用例文件头的显式源依赖：只认这种注解，普通注释里提到路径不算。 */
const AFFECTED_SOURCE_RE = /^\s*\/\/\s*@affected-source\s+(?<path>[^\s]+)\s*$/gm;

/**
 * 从用例原文取出显式声明的源依赖（仓库相对路径；可能以 `/` 结尾表示子树）。
 * 导出的理由与 `specifiersOf` 同族：存在性守卫要用**同一份**解析，另抄一条正则
 * 就会在格式微调后两头各说各话（§12.12 / §12.18）。
 * @param {string} text
 * @returns {string[]}
 */
export function declaredSourcesOf(text) {
  /** @type {string[]} */
  const out = [];
  for (const m of text.matchAll(AFFECTED_SOURCE_RE)) {
    const rel = normalizeRel(m.groups?.path ?? "");
    if (rel) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * 把一份用例的声明并进 `declaredBy`（用例 → 声明路径集合）。
 * @param {Map<string, Set<string>>} declaredBy
 * @param {string} fromFile
 * @param {string} text
 */
export function addDeclaredSources(declaredBy, fromFile, text) {
  for (const rel of declaredSourcesOf(text)) {
    let bucket = declaredBy.get(fromFile);
    if (!bucket) {
      declaredBy.set(fromFile, (bucket = new Set()));
    }
    bucket.add(rel);
  }
}

/**
 * 本次改动面命中哪些显式声明。路径以 `/` 结尾表示子树；空声明与空改动面都返回空。
 * @param {Map<string, Set<string>>} declaredBy
 * @param {Iterable<string>} changedList 本次改动路径（已归一化）
 * @param {Set<string>} changedSet 同一份改动面的集合形态（整串匹配用）
 * @returns {string[]}
 */
export function declaredSourceHits(declaredBy, changedList, changedSet) {
  const list = [...changedList];
  /** @type {string[]} */
  const hits = [];
  for (const [testFile, declared] of declaredBy) {
    for (const dep of declared) {
      const hit = dep.endsWith("/")
        ? list.some((rel) => rel.startsWith(dep) && rel !== dep)
        : changedSet.has(dep);
      if (hit) {
        hits.push(testFile);
        break;
      }
    }
  }
  return hits;
}

/**
 * 反向 import 闭包：从 `roots` 出发，沿「谁 import 我」走到测试为止。
 * @param {Iterable<string>} roots
 * @param {Map<string, Set<string>>} importedBy
 * @returns {Map<string, number>} 文件 → 跳数（roots 自身为 0）
 */
export function reachFrom(roots, importedBy) {
  /** @type {Map<string, number>} */
  const hops = new Map();
  const queue = [];
  for (const rel of roots) {
    if (hops.has(rel)) {
      continue;
    }
    hops.set(rel, 0);
    queue.push(rel);
  }
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) {
      continue;
    }
    const hop = (hops.get(cur) ?? 0) + 1;
    for (const consumer of importedBy.get(cur) ?? []) {
      if (hops.has(consumer)) {
        continue;
      }
      hops.set(consumer, hop);
      queue.push(consumer);
    }
  }
  return hops;
}
