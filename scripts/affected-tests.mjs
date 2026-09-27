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
 *   ④ 改动路径以字面量出现在测试文本里：门禁用例用 `execFileSync` 起被测脚本、
 *      主题用例按路径读 CSS，这类消费不是 import，只有整串匹配抓得住。
 *      同族：改 `scripts/<name>.cjs|mjs|py` 时按名字配 `tests/<name>.test.ts`。
 *
 * ⚠️ 闭包只跟着**静态写出来的**说明符走，两类它抓不到：运行时拼出来的路径
 * （`import(base + name)`、`path.join(dir, …)`）、以及解析目录之外的消费方。
 * 全量套件当前带着别线的基线红，所以「拿不准就跑全量」在这里不可用 —— 遇到公共地基
 * （`vitest.config.ts`、`tests/setup.ts`、`package.json` / lockfile、`.githooks/**`）
 * 被改时明确**放弃收窄**：只跑固定清单，并把放弃的理由打到 stderr。放弃是被看见的，
 * 不是静默降级；等基线红清零后，把 `mode === "all"` 那条分支改成跑全量（规范 §13.5.8）。
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(HERE, "..");

/**
 * 固定结构守护清单：与本次改动无关、每次提交都要跑的那批。它们守的是**全库级**
 * 不变量（日志通道单点、容器单入口、core 主干单一来源、lib 的 Node-only 声明、
 * barrel 出口纪律、mock 目标存在性、仓储基类纯净）——这些不会因为「本次没改到」
 * 而变得安全。这一份是**唯一出处**，钩子不再自己抄一遍。
 */
export const FIXED_STRUCTURAL_TESTS = [
  "tests/single-logger-channel.test.ts",
  "tests/container-single-access.test.ts",
  "tests/core-spine-single-source.test.ts",
  "tests/lib-node-only-declarations.test.ts",
  "tests/core-barrel-entry-discipline.test.ts",
  "tests/test-mock-targets.test.ts",
  "tests/repository-base-purity.test.ts",
  // 本层自己的判据必须在**每一次**提交里跑：解析器一旦把「自己」算漏了，
  // 只有这一条能发现（它守的是「增量层还在增量」这件事本身）。
  "tests/affected-tests.test.ts",
];

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
 * 核心解析：改动清单 + 测试清单 +（注入的）读文件函数 → 该跑哪些测试。
 * 不碰 git、不碰真实磁盘，便于用例喂夹具。
 *
 * @param {{changedPaths: string[], testFiles: string[], sourceFiles: string[], readText: (rel: string) => string | null}} input
 * @returns {Resolution}
 */
export function resolveAffectedTests({
  changedPaths,
  testFiles,
  sourceFiles,
  readText,
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
   * 固定清单永远并入 —— 空集是最危险的形态：`vitest run` 不带位置参数就是跑全量。
   * @param {"subset" | "all"} mode
   * @param {Iterable<string>} extra
   * @param {string} [note]
   * @returns {Resolution}
   */
  const withFixed = (mode, extra, note) => ({
    mode,
    tests: [...new Set([...FIXED_STRUCTURAL_TESTS, ...extra])].sort(),
    reasons: note ? { __note: note } : reasons,
  });

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
  const nodes = new Set([...sourceFiles, ...testFiles]);
  /** @type {Map<string, Set<string>>} */
  const importedBy = new Map();
  /** @type {Map<string, string>} */
  const texts = new Map();
  for (const from of nodes) {
    const text = readText(from);
    if (text === null || text === undefined) continue;
    texts.set(from, text);
    for (const cand of specifiersOf(text, from)) {
      let bucket = importedBy.get(cand);
      if (!bucket) importedBy.set(cand, (bucket = new Set()));
      bucket.add(from);
    }
  }

  /** @type {Map<string, number>} */
  const hops = new Map();
  const queue = [];
  for (const rel of list) {
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
  for (const [file, hop] of hops) {
    if (hop > 0 && isTestPath(file)) add(file, `反向 import ${hop} 跳`);
  }

  /* ── ④ 路径以字面量被引用（闭包抓不到的那类消费）──────────────────────── */
  for (const testFile of testFiles) {
    if (picked.has(testFile)) continue;
    const text = texts.get(testFile);
    if (text === undefined) continue;
    for (const rel of list) {
      if (rel !== testFile && text.includes(rel)) {
        add(testFile, "按路径引用");
        break;
      }
    }
  }

  return withFixed("subset", picked);
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

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--fixed-only")) {
    process.stdout.write(FIXED_STRUCTURAL_TESTS.join(" ") + "\n");
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
        });

  const extra = res.tests.filter((t) => !FIXED_STRUCTURAL_TESTS.includes(t));
  if (res.mode === "all") {
    process.stderr.write(
      `[affected] 放弃收窄（${res.reasons.__note ?? "见 --json"}）→ 只跑固定清单 ` +
        `${res.tests.length} 个。兜底不是全量：全量当前带别线基线红（规范 §11.13 / §13.5.8）\n`,
    );
  } else {
    process.stderr.write(
      `[affected] 暂存 ${changed.length} 个文件 → 跑 ${res.tests.length} 个测试` +
        `（固定 ${FIXED_STRUCTURAL_TESTS.length} + 受影响 ${extra.length}）\n`,
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
