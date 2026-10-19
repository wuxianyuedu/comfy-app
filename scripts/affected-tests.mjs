#!/usr/bin/env node
/**
 * affected-tests.mjs — 提交前的「改到哪、测到哪」增量测试层
 *
 * 干什么：读**暂存区**的改动清单，解析出「这批改动牵扯到哪些测试文件」，连同
 * **固定结构守护清单**一起打给 `vitest run` 的位置参数。`.githooks/pre-commit`
 * 的 C 组只调用它一次（规范 §13.5 的口径：需要 vite 的测试并入同一行
 * `vitest run`，别新起一次冷启）。
 *
 * 为什么要这一层：全量 437 个文件实测是十分钟量级（规范 §11.13 的三档对照），
 * 挂在每次提交上不可用；而「只跑固定几个结构守护」又漏掉改动的直接消费方 ——
 * 表现是提交时绿、下一次全量才红，红还归因不到人。这一层买的是
 * 「改的代码有对应用例时，那次提交就跑到它」。
 *
 * 判据（方向一律是「宁可多跑，不许漏跑」）：
 *   ① 改动的测试文件本身；
 *   ② 同名兄弟：改 `x.ts` → 跑 `x.test.ts`；改快照 `__snapshots__/x.test.tsx.snap`
 *      → 跑 `x.test.tsx`；
 *   ③ **反向 import 闭包**：谁 import 了改动文件、谁又 import 了那些文件……沿 import
 *      图走到测试为止（含 `~/` 与 `@/` 别名、相对说明符按**引用方位置**解析、目录
 *      import 命中 `dir/index.*` 的 barrel 转出口）。只看「谁直接 import」不够：
 *      视图层的常态是 `X.test → Panel → X.tsx`，只走一跳时改 `X.tsx` 会解析出
 *      「受影响 0 个用例」（实测撞到过），那这句承诺就是空话。
 *   ④ 改动路径以字面量出现在测试的**代码文本**里（比对面已剥注释，§13.5.8）：门禁用例
 *      用 `execFileSync` 起被测脚本、主题用例按路径读 CSS，这类消费不是 import，
 *      只有整串匹配抓得住。
 *      同族：改 `scripts/<name>.cjs|mjs|py` 时按名字配 `tests/<name>.test.ts`。
 *
 * ⚠️ 闭包只跟着**静态写出来的**说明符走，两类它抓不到：运行时拼出来的路径
 * （`import(base + name)`、`path.join(dir, …)`）、以及解析目录之外的消费方。
 * 遇到公共地基（`vitest.config.ts`、`tests/setup.ts`、`package.json` / lockfile、
 * `.githooks/**`）被改时明确**放弃收窄**：只跑固定清单，并把放弃的理由打到 stderr。
 * 放弃是被看见的，不是静默降级。
 *
 * 兜底**刻意不是跑全量**，拦路石是两条实测（不是「全量带基线红」—— 真断言红今天是 0，
 * 见规范 §11.13 的复核行）：① 全量在钩子那一档（`--maxWorkers=4`）要 **32m35s**
 * （560 files / 6887 passed 全绿），把它塞进 wide 提交等于每次动 lockfile 等半小时；
 * ② 这一层的正确形态是**只跑解析出来的那份清单**，wide 时「不带位置参数」被钩子刻意
 * 阻断（空参数 = 谁都没筛过，红也归不了因），而把全量清单拼进 argv 在 Windows 上还会撞
 * 命令行长度上限。⇒ 翻兜底的前置是先造一条**显式的全量通道**并接受那半小时，
 * 不是等基线红清零（那件事已经发生了）。规范 §13.5.8。
 *
 * 用法：
 *   node scripts/affected-tests.mjs                # 读暂存区（pre-commit 用）
 *   node scripts/affected-tests.mjs --changed a b  # 手工指定改动清单（调试用）
 *   node scripts/affected-tests.mjs --json         # 连命中原因一起打
 *   node scripts/affected-tests.mjs --fixed-only   # 只要固定清单
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { KNOWN_FAILED_FILES } from "./quality-gate-shared.mjs";
import { FIXED_STRUCTURAL_TESTS } from "./fixed-structural-tests.mjs";
import { selectFixedByFace } from "./fixed-gate-input-faces.mjs";
import { stripComments } from "./tw4-scan-core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(HERE, "..");

/** @typedef {{test: (rel: string) => boolean, why: string}} WideTrigger */
/** @typedef {{mode: "subset" | "all", tests: string[], reasons: Record<string, string>}} Resolution */

const WIDE_REASON = {
  config: "全局测试配置（预算 / include / setupFiles）",
  setup: "每条用例的 setupFiles",
  deps: "依赖与脚本面，任何用例都可能受影响",
  types: "全局类型口径",
  hooks: "门槛自身",
};

/**
 * 改了这些就无所谓「收窄」：它们被每一条用例隐式消费，而这件事不出现在任何
 * import 语句里。命中即放弃收窄并说明原因。
 * @type {WideTrigger[]}
 */
const WIDE_TRIGGERS = [
  { test: (p) => p === "vitest.config.ts", why: WIDE_REASON.config },
  { test: (p) => p === "tests/setup.ts", why: WIDE_REASON.setup },
  {
    test: (p) =>
      p === "package.json" ||
      p === "pnpm-lock.yaml" ||
      p === "pnpm-workspace.yaml",
    why: WIDE_REASON.deps,
  },
  { test: (p) => p === "tsconfig.json", why: WIDE_REASON.types },
  { test: (p) => p.startsWith(".githooks/"), why: WIDE_REASON.hooks },
];

/**
 * 与 `vitest.config.ts` 的 `include` 同一口径；漂移由 `tests/affected-tests.test.ts` 盯着。
 * @param {string} rel
 * @returns {boolean}
 */
export function isTestPath(rel) {
  return (
    (rel.startsWith("src/") || rel.startsWith("tests/")) &&
    /\.test\.tsx?$/.test(rel)
  );
}

/** import 说明符不带扩展名，按候选逐个试（含目录形式的 barrel）。 */
const EXT_CANDIDATES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".jsx",
  ".mjs",
  ".json",
  "/index.ts",
  "/index.tsx",
  "/index.mjs",
];

/**
 * 把一条 import 说明符解析成仓库内相对路径的候选集合。
 * 别名 `~/` `@/` → `src/`；相对路径按**引用方所在文件**解析；裸包名返回空。
 * @param {string} spec
 * @param {string} fromFile
 * @returns {string[]}
 */
export function specCandidates(spec, fromFile) {
  const clean = spec.split("?")[0];
  if (!clean) return [];
  let base;
  if (clean === "~" || clean === "@") base = "src";
  else if (clean.startsWith("~/") || clean.startsWith("@/"))
    base = "src/" + clean.slice(2);
  else if (clean.startsWith("./") || clean.startsWith("../")) {
    const fromDir = fromFile ? path.posix.dirname(fromFile) : ".";
    base = path.posix.normalize(path.posix.join(fromDir, clean));
  } else return [];
  return EXT_CANDIDATES.map((ext) => base + ext);
}

/** 说明符抽取：`from` / `import` / `require` / `vi.mock` / `jest.mock` 后的字符串字面量。
 *  可选左括号让动态 `import("x")` 与 `require("x")` 也走同一条。 */
const SPEC_RE =
  /(?:\bfrom|\bimport|\brequire|vi\.mock|jest\.mock)\s*\(?\s*["']([^"'\n]+)["']/g;

/**
 * 一份源码静态引用到的模块（候选路径集合，含 barrel 的 `dir/index.*` 形态）。
 * @param {string} text
 * @param {string} fromFile
 * @returns {Set<string>}
 */
function specifiersOf(text, fromFile) {
  const out = new Set();
  for (const m of text.matchAll(SPEC_RE)) {
    const spec = m[1];
    if (!spec) continue;
    for (const cand of specCandidates(spec, fromFile)) out.add(cand);
  }
  return out;
}

/**
 * @param {string} rel
 * @returns {string | null}
 */
function wideReasonFor(rel) {
  const hit = WIDE_TRIGGERS.find((t) => t.test(rel));
  return hit ? hit.why : null;
}

/**
 * 建反向 import 图：**候选路径 → 谁 import 了它**（含 barrel 转出口与别名）。
 *
 * 单独抽出来是为了让「按改动文件归因」能在**同一份图**上多跑几次 BFS ——
 * 逐文件各建一遍图会把约 220ms 的解析成本乘上改动文件数（与 §13.5.8.2「同一份
 * 输入被算了多少遍」是同一件事）。
 *
 * @param {Iterable<string>} nodes 参与建图的文件（源码 + 测试）
 * @param {(rel: string) => string | null} readText
 * @returns {{importedBy: Map<string, Set<string>>, codeTexts: Map<string, string>}}
 */
export function buildImportedBy(nodes, readText) {
  /** @type {Map<string, Set<string>>} */
  const importedBy = new Map();
  /** ④ 的比对面：注释里引用一个路径 ≠ 运行期读它，所以只留「代码文本」这一份。 */
  const codeTexts = new Map();
  for (const from of nodes) {
    const text = readText(from);
    if (text === null || text === undefined) continue;
    if (isTestPath(from)) codeTexts.set(from, stripComments(text));
    for (const cand of specifiersOf(text, from)) {
      let bucket = importedBy.get(cand);
      if (!bucket) importedBy.set(cand, (bucket = new Set()));
      bucket.add(from);
    }
  }
  return { importedBy, codeTexts };
}

/**
 * 反向 import 闭包：从 `roots` 出发，沿「谁 import 我」走到测试为止。
 *
 * @param {Iterable<string>} roots
 * @param {Map<string, Set<string>>} importedBy
 * @returns {Map<string, number>} 文件 → 跳数（roots 自身为 0）
 */
function reachFrom(roots, importedBy) {
  /** @type {Map<string, number>} */
  const hops = new Map();
  const queue = [];
  for (const rel of roots) {
    if (hops.has(rel)) continue;
    hops.set(rel, 0);
    queue.push(rel);
  }
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) continue;
    const hop = (hops.get(cur) ?? 0) + 1;
    for (const consumer of importedBy.get(cur) ?? []) {
      if (hops.has(consumer)) continue;
      hops.set(consumer, hop);
      queue.push(consumer);
    }
  }
  return hops;
}

/**
 * 核心解析：改动清单 + 测试清单 +（注入的）读文件函数 → 该跑哪些测试。
 * 不碰 git、不碰真实磁盘，便于用例喂夹具。
 *
 * @param {{changedPaths: string[], testFiles: string[], sourceFiles: string[], readText: (rel: string) => string | null, knownFailed?: string[], graph?: {importedBy: Map<string, Set<string>>, codeTexts: Map<string, string>}}} input
 * @returns {Resolution}
 */
export function resolveAffectedTests({
  changedPaths,
  testFiles,
  sourceFiles,
  readText,
  knownFailed = [],
  graph,
}) {
  /** @type {Record<string, string>} */
  const reasons = {};
  const picked = new Set();
  /**
   * @param {string} rel
   * @param {string} why
   */
  const add = (rel, why) => {
    if (!testFiles.includes(rel)) return;
    picked.add(rel);
    reasons[rel] = reasons[rel] ? `${reasons[rel]} + ${why}` : why;
  };
  /**
   * 固定清单并入 —— 空集是最危险的形态：`vitest run` 不带位置参数就是跑全量。
   *
   * ⚠️ **只有增量档（`subset`）按输入面筛**（`scripts/fixed-gate-input-faces.mjs`）：
   * `all` 那一档是「放弃收窄」的兜底 —— 改了全局测试配置、或命中了不可达的公共地基，
   * 那一刻的前提正是「这次没法信筛出来的结果」，所以固定清单**一条都不跳**。
   * 被跳过的条目必须进 `reasons.__faceSkipped` 由 `main()` 打出口：一条悄悄不跑的判据，
   * 与一条没写判据的判据在日志里逐字同形（本仓立案最狠的那一族）。
   *
   * @param {"subset" | "all"} mode
   * @param {Iterable<string>} extra
   * @param {string} [note]
   * @returns {Resolution}
   */
  const withFixed = (mode, extra, note) => {
    /* 改动清单为空 ⇒ **不过筛**。这一格与 `wide` 那种兜底不同源但同一取向：空清单在这里
     * 分不清「什么都没改」与「拿不到清单」（`stagedPaths()` 两条路都回 `[]`/`null`），
     * 而「不知道」不等于「没变」—— 同 `ci-install-deps.mjs` 那两条安全边界的一条口径。
     * 真发生时最贵的后果是「一次没人筛过的提交悄悄少跑四条判据」。 */
    const pickedFixed =
      mode === "subset" && changed.size > 0
        ? selectFixedByFace(FIXED_STRUCTURAL_TESTS, changed)
        : { keep: [...FIXED_STRUCTURAL_TESTS], skipped: [] };
    const out = {
      mode,
      tests: [...new Set([...pickedFixed.keep, ...extra])].sort(),
      reasons: note ? { __note: note } : reasons,
    };
    if (pickedFixed.skipped.length > 0) {
      out.reasons.__faceSkipped = pickedFixed.skipped
        .map((s) => s.test)
        .join(" ");
    }
    return out;
  };

  const changed = new Set();
  /** @type {string[]} */
  const wide = [];
  for (const raw of changedPaths) {
    const rel = String(raw).trim().replace(/\\/g, "/");
    if (!rel) continue;
    const why = wideReasonFor(rel);
    if (why) wide.push(`${rel} —— ${why}`);
    changed.add(rel);
  }
  if (wide.length > 0) return withFixed("all", [], wide.join(" / "));

  const list = [...changed];
  for (const rel of list) {
    if (isTestPath(rel)) {
      add(rel, "自身");
    } else {
      // 兄弟测试：`x.ts` ⇄ `x.test.ts(x)`。必须先剥掉源码自己的扩展名，
      // 否则 `x.tsx` 会拼成 `x.tsx.test.ts` 这种查无此文件的名字。
      const stem = rel.replace(/\.(ts|tsx|mts|js|jsx|mjs)$/, "");
      if (stem !== rel) {
        add(stem + ".test.ts", "兄弟测试");
        add(stem + ".test.tsx", "兄弟测试");
      }
    }
    // 快照文件按其宿主测试算。
    if (rel.endsWith(".snap")) {
      const dir = path.posix.dirname(rel);
      if (path.posix.basename(dir) === "__snapshots__")
        add(
          path.posix.join(
            path.posix.dirname(dir),
            path.posix.basename(rel, ".snap"),
          ),
          "快照宿主",
        );
    }
    // 门禁脚本按名字配它的回归测试。
    const script = /^scripts\/(.+)\.(?:cjs|mjs|py)$/.exec(rel);
    if (script) {
      add(`tests/${script[1]}.test.ts`, "脚本同名回归");
      add(`tests/${script[1]}.test.tsx`, "脚本同名回归");
    }
  }

  /* ── ③ 反向 import 闭包 ────────────────────────────────────────────────
   * `importedBy` 按**候选路径**建键（不按「文件是否存在」过滤）：被删掉或改名的
   * 文件已经不在索引清单里，但它的消费方仍然静态写着那个说明符 —— 那些测试正是
   * 这次改动会打破的东西，按存在性过滤就会把它们连同改动一起漏掉。
   * 成本：读 1.2k 个源码文件 + 6.4k 条说明符，实测 <1s。 */
  /* 图可以注入（`attributeAffected` 逐文件复用同一份），也可以就地建（钩子的常态）。
   * 注入这一条不是优化手段而是**口径**手段：归因的数必须与主解析走同一条判定链，
   * 否则两处会各自漂 —— 实测过一版「照抄一份判定」的归因，三个文件的数就都差了
   * 一两份（「按路径引用」那一档在增量面里只对尚未选中的测试生效）。 */
  const { importedBy, codeTexts } =
    graph ?? buildImportedBy(new Set([...sourceFiles, ...testFiles]), readText);

  const hops = reachFrom(list, importedBy);
  for (const [file, hop] of hops) {
    if (hop > 0 && isTestPath(file)) add(file, `反向 import ${hop} 跳`);
  }

  /* ── ④ 路径以字面量被引用（闭包抓不到的那类消费）──────────────────────── */
  /* 比对面是**剥注释之后**的代码文本（`codeTexts`，建树时一次算好）。为什么必须剥：
   * 本仓的门禁自测**在文件头的 JSDoc 里引用规范章节**是硬规则 15 要求的动作，于是
   * 「改一句注释」与「运行期读了那个文件」在原文里逐字同形 —— 实测只提交文档时，
   * `docs/standards/13-提交与-code-review.md` 一个路径把 6 份门禁自测按「按路径引用」
   * 拉进增量面（上次账本逐文件读数合计 455.8s，量级参考），而那六份里没有一份在运行期
   * 读那份 `.md`。口径、实测量与判据在 §13.5.8。 */
  for (const testFile of testFiles) {
    if (picked.has(testFile)) continue;
    const text = codeTexts.get(testFile);
    if (text === undefined) continue;
    for (const rel of list) {
      if (rel !== testFile && text.includes(rel)) {
        add(testFile, "按路径引用");
        break;
      }
    }
  }

  /* 已知基线红（`KNOWN_FAILED_FILES` 单点定义，与 `run-tests.mjs` / 一键门禁同一份）：
   * 从**增量**面里剔掉，否则别线的红会让无关提交落不了地。固定清单不受影响 ——
   * 那几条是全库不变量的执行者，没有「先放行」的余地。剔除是被打印出来的，不是静默。 */
  const skipped = [...picked].filter((t) => knownFailed.includes(t));
  for (const t of skipped) picked.delete(t);

  const out = withFixed("subset", picked);
  if (skipped.length > 0) out.reasons.__skipped = skipped.join(" ");
  return out;
}

/**
 * **按改动文件归因**：这次的受影响面里，每一份测试是被**哪个**改动文件拉进来的。
 *
 * 存在的理由是一条没有任何执行者的建议：「把大改动拆小」（规范 §13.5.8.1 末尾）。
 * 那句话说了两年，却从来没人知道**该从哪一刀切** —— 改动面不是一个数，它是一组
 * 贡献极不均衡的数：实测 5 个文件拉出 304 份（几乎全量），其中改 `src/lib/endpoints.ts`
 * 一个就贡献了大半，而另外四个加起来不到一半。不知道这件事，拆小就是盲拆。
 *
 * 算法：**逐文件走同一条判定链**（`resolveAffectedTests`），每次只留一个改动文件，
 * 得出「单独改它一个会跑多少份」。`importedBy` 图通过参数注入、只建一次 ——
 * 逐文件各建一遍会把解析成本乘上改动文件数（实测 220ms/次）。
 *
 * ⚠️ **不另写一份判定**。这条建议的全部价值在于它的数**与真正要跑的清单对得上**，
 * 而两处实现的漂移是静默的：本轮实测过一版「照抄一份」的归因，`--attribute` 报
 * 180 / 67 / 3，主链报 173 / 65 / 2 —— 差在「按路径引用」那一档（主链只对增量面里
 * 尚未被其他原因选中的测试做字面量匹配）。多报几份看着无害，实际等于给了一条
 * **对不上账**的建议，正是本仓库反复在收的那一族。
 *
 * ⚠️ 贡献**不可加**（同一份测试常被多个改动文件共同拉到，交集非空），所以这里的
 * 数是「**单独改它一个**会跑多少份」，不是「从总数里减掉多少」——后者要精确算必须
 * 枚举子集（2^n）。要说清这一点的原因同 §13.5.8.2 那句「不伪造绿」：给一个看起来
 * 精确、实际含义不同的数，比不给更坏。
 *
 * @param {string[]} changedPaths 本次改动的文件
 * @param {{importedBy: Map<string, Set<string>>, codeTexts: Map<string, string>}} graph
 *   `buildImportedBy()` 的产物（复用同一份图，避免逐文件重建）
 * @param {string[]} testFiles 参与统计的测试全集（须与建图时的口径一致）
 * @param {string[]} sourceFiles 参与建图的源码全集（须与建图时的口径一致）
 * @returns {{file: string, affected: number, total: number}[]} 按单独影响面**从大到小**排序；
 *   `affected` 是受影响份数（不含固定清单），`total` 是合计（含固定清单）
 */
export function attributeAffected(changedPaths, graph, testFiles, sourceFiles) {
  const out = [];
  for (const raw of changedPaths) {
    const rel = String(raw).trim().replace(/\\/g, "/");
    if (!rel) continue;
    /* **逐文件走同一条判定链**（`resolveAffectedTests`），而不是另写一份「这个文件
     * 拉到哪些测试」的复制品 —— 复制品与主链的漂移是静默的，而这条建议的全部价值
     * 就在于它的数**与真正要跑的清单对得上**。图注入进去，所以这么循环不重建图。
     *
     * `knownFailed` 显式传空：这里问的是「改这一个文件**理论上的**面有多大」，
     * 而不是「这次的增量面」—— 基线红属于别线的账，混进归因会让同一份改动在不同
     * 时期给出不同的建议，而拆小的判据不该随时间漂。 */
    const res = resolveAffectedTests({
      changedPaths: [rel],
      testFiles,
      sourceFiles,
      readText: () => null,
      knownFailed: [],
      graph,
    });
    const affected = res.tests.filter(
      (t) => !FIXED_STRUCTURAL_TESTS.includes(t),
    ).length;
    out.push({ file: rel, affected, total: res.tests.length });
  }
  // 稳定排序：同份数时按路径字典序，避免同样的改动在不同机器上给出不同顺序。
  return out.sort((a, b) =>
    b.affected !== a.affected
      ? b.affected - a.affected
      : a.file < b.file
        ? -1
        : 1,
  );
}

/* ── 以下是与 git / 真实磁盘打交道的部分（用例不覆盖这一段，纯转调）─────── */

/**
 * @param {string[]} args
 * @returns {string | null}
 */
function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 << 20,
    });
  } catch (err) {
    process.stderr.write(
      `[affected] git ${args.join(" ")} 失败：${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
}

/**
 * 暂存区改动。`--diff-filter` 保留 D：删掉的文件要去匹配「谁 import 了它」。
 * @returns {string[] | null}
 */
function stagedPaths() {
  const out = git(["diff", "--cached", "--name-only", "--diff-filter=ACMRD"]);
  if (out === null) return null;
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 参与 import 图的文件目录与扩展名：闭包要能穿过 `scripts/` 里的门禁脚本。 */
const SOURCE_DIRS = ["src/", "tests/", "scripts/", "tools/"];
const SOURCE_EXT_RE = /\.(ts|tsx|mts|js|jsx|mjs|cjs)$/;

/**
 * 一个 tracked 路径是否进 import 图（`.d.ts` 是纯声明，不做节点）。
 * @param {string} rel
 * @returns {boolean}
 */
export function isSourcePath(rel) {
  return (
    SOURCE_DIRS.some((dir) => rel.startsWith(dir)) &&
    SOURCE_EXT_RE.test(rel) &&
    !rel.endsWith(".d.ts")
  );
}

/**
 * `git ls-files` 走索引、不扫盘：未跟踪的临时文件不该进图。
 * @returns {string[] | null}
 */
function trackedPaths() {
  const out = git(["ls-files"]);
  if (out === null) return null;
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string} rel
 * @returns {string | null}
 */
function readText(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

/**
 * 一次 `git ls-files` 出两份清单：测试（输出的候选）与 import 图的节点。
 * @returns {{testFiles: string[], sourceFiles: string[]} | null}
 */
function collectInputs() {
  const tracked = trackedPaths();
  if (tracked === null) return null;
  return {
    testFiles: tracked.filter(isTestPath),
    sourceFiles: tracked.filter(isSourcePath),
  };
}

/**
 * wide（放弃收窄）那一档打印给提交者看的话术。
 *
 * 为什么要单独成函数、并让用例钉住文本：这句话过去写的是「全量当前带别线基线红」，
 * 那是**假前提**（ISSUE #1393 在 master `9392a88f` 上重测：真断言红 0 条、
 * `KNOWN_FAILED_FILES` 是空数组；`--maxWorkers=4` 全量 560 files 全绿）。
 * 假理由每遇到一次 wide 提交就当着所有人的面重印一遍，久而久之就成了「谁也不去翻兜底」的
 * 默认解释 —— 所以它跟判据一样需要执行者，不能只改一次文本。规范 §13.5.8 / §11.13。
 * @param {string} note 放弃收窄的原因（哪个公共地基被改了）
 * @param {number} count 固定清单里的用例文件数
 */
export function wideFallbackNote(note, count) {
  return (
    `[affected] 放弃收窄（${note}）→ 只跑固定清单 ${count} 个。` +
    "兜底不是全量：wide 这一档跑全量实测要 32m35s，而钩子刻意不接受「空参数=全跑」" +
    "这种没人筛过的形态（真断言红已经是 0，不是挡路的那件事）。" +
    "要按名字跑全量（显式档，不受这条限制）：" +
    "`node scripts/run-affected-tests.mjs --full`。规范 §13.5.8 / §11.13\n"
  );
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--fixed-only")) {
    process.stdout.write(FIXED_STRUCTURAL_TESTS.join(" ") + "\n");
    return 0;
  }
  /* `--attribute`：只回答「这次的受影响面里，每一份是被哪个改动文件拉进来的」，
   * 打在 stdout（JSON），供 C 组的收尾建议用（`run-affected-tests.mjs` 那一步）。
   * 它是**诊断档**，不参与筛选、不改清单、不影响退出码 —— 拿不到图时打空数组而不是
   * 报错：这条建议没有到「值得拦住提交」的分量（口径见属性函数头顶那节）。 */
  if (argv.includes("--attribute")) {
    const ci = argv.indexOf("--changed");
    const changed =
      ci >= 0
        ? argv.slice(ci + 1).filter((a) => !a.startsWith("--"))
        : (stagedPaths() ?? []);
    const inputs = collectInputs();
    if (inputs === null || changed.length === 0) {
      process.stdout.write("[]\n");
      return 0;
    }
    const graph = buildImportedBy(
      new Set([...inputs.sourceFiles, ...inputs.testFiles]),
      readText,
    );
    process.stdout.write(
      JSON.stringify(
        attributeAffected(changed, graph, inputs.testFiles, inputs.sourceFiles),
      ) + "\n",
    );
    return 0;
  }
  const ci = argv.indexOf("--changed");
  const changed =
    ci >= 0
      ? argv.slice(ci + 1).filter((a) => !a.startsWith("--"))
      : (stagedPaths() ?? []);
  const inputs = collectInputs();
  /** @type {Resolution} */
  const res =
    inputs === null
      ? {
          mode: "all",
          tests: [...FIXED_STRUCTURAL_TESTS].sort(),
          reasons: { __note: "读不到测试清单（git ls-files 失败）" },
        }
      : resolveAffectedTests({
          changedPaths: changed,
          testFiles: inputs.testFiles,
          sourceFiles: inputs.sourceFiles,
          readText,
          knownFailed: KNOWN_FAILED_FILES,
        });

  const extra = res.tests.filter((t) => !FIXED_STRUCTURAL_TESTS.includes(t));
  if (res.mode === "all") {
    process.stderr.write(
      wideFallbackNote(res.reasons.__note ?? "见 --json", res.tests.length),
    );
  } else {
    /* 「固定 N」必须是**这次真跑到的**固定条数，不是清单长度 —— 开了输入面之后两者
     * 可以不同，而这一行是唯一会被读账的数字：拿清单长度冒充实跑，跳过的那几条
     * 就在这句话里消失了（同「读不到就少说一条」那类病）。 */
    process.stderr.write(
      `[affected] 暂存 ${changed.length} 个文件 → 跑 ${res.tests.length} 个测试` +
        `（固定 ${res.tests.length - extra.length} + 受影响 ${extra.length}）\n`,
    );
  }
  if (res.reasons.__faceSkipped) {
    const skipped = res.reasons.__faceSkipped.split(" ").filter(Boolean);
    process.stderr.write(
      `[affected] 固定清单按**输入面**跳过 ${skipped.length} 条（${skipped.join(" ")}）` +
        "—— 名单与每条的面在 scripts/fixed-gate-input-faces.mjs，" +
        "「改到被测工具却没跑」是不允许的形态，所以这里逐条点名而不是静默少跑\n",
    );
  }
  if (res.reasons.__skipped) {
    process.stderr.write(
      `[affected] 跳过已知基线红 ${res.reasons.__skipped.split(" ").length} 个` +
        `（${res.reasons.__skipped}）—— 清单在 scripts/quality-gate-shared.mjs，` +
        "修好后立刻删，别让它长期静默\n",
    );
  }
  // 空集绝不允许：`vitest run` 不带位置参数就是跑全量。
  const tests = res.tests.length > 0 ? res.tests : [...FIXED_STRUCTURAL_TESTS];
  process.stdout.write(
    argv.includes("--json")
      ? JSON.stringify({ ...res, tests }, null, 2) + "\n"
      : tests.join(" ") + "\n",
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  process.exit(main());
}
