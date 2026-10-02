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

import { KNOWN_FAILED_FILES } from "./quality-gate-shared.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(HERE, "..");

/**
 * 固定结构守护清单：与本次改动无关、每次提交都要跑的那批。它们守的是**全库级**
 * 不变量（日志通道单点、容器单入口、core 主干单一来源、lib 的 Node-only 声明、
 * barrel 出口纪律、mock 目标存在性、仓储基类纯净、平台侧 CI 配置的在不在与规范
 * 口径一致）——这些不会因为「本次没改到」而变得安全。这一份是**唯一出处**，
 * 钩子不再自己抄一遍。
 */
export const FIXED_STRUCTURAL_TESTS = [
  "tests/single-logger-channel.test.ts",
  "tests/container-single-access.test.ts",
  "tests/core-spine-single-source.test.ts",
  "tests/lib-node-only-declarations.test.ts",
  "tests/core-barrel-entry-discipline.test.ts",
  "tests/test-mock-targets.test.ts",
  "tests/repository-base-purity.test.ts",
  // 「平台侧没有自动兜底」这件事现在是文档口径 + 仓库现实两头都要对上：加回一份
  // `.cnb.yml` 不会让任何现有判据变红（规范 §13.5.3 的结论只写在正文里），而它一旦
  // 存在就会被读成「有 CI 兜底」——绿灯可信度的地基不能靠人记得住。
  "tests/no-platform-ci-config.test.ts",
  // 像素基线按平台分文件：少一档不是「那一档没跑」，而是判失败并顺手生成半套未入库的
  // PNG。这条守的是「视觉层在真正执行它的那台机器上到底有没有基线」，与本次改动无关。
  "tests/visual-baseline-pairing.test.ts",
  // 条件性 skip 的登记表：全绿里的 `N skipped` 不说明「绿的是哪一种」，尤其产物级探针
  // （没构建过的检出上整块不判）。这条守住「每个暗掉的站点都有人登记它为什么暗」。
  "tests/conditional-skip-registry.test.ts",
  // 本层自己的判据必须在**每一次**提交里跑：解析器一旦把「自己」算漏了，
  // 只有这一条能发现（它守的是「增量层还在增量」这件事本身）。
  "tests/affected-tests.test.ts",
  // 「拿正则断言源码形状」前要先剥注释 —— 这件事仓里已各自内联了 18 份（ISSUE #1192），
  // 而 §12.12 的孪生判据抓不到（每份都远小于 60 行）。台账双向都拦：新增一份 = 红，
  // 收敛掉一份却没收紧台账 = 红。它守的是「这张表还有没有记账能力」，与本次改动无关，
  // 所以必须进固定清单（只在受影响时才跑，等于让下一次复制悄悄过去）。
  "tests/strip-comments-single-source.test.ts",
  // router 层的错误信封：裸 `throw new Error` 会被 tRPC 归成 INTERNAL_SERVER_ERROR，
  // 「越权与不存在同形」就只剩一句没有判据的话（台账 E8）。这条同时验 eslint 配置里
  // 那条 selector **真的会响** —— 「配置写在」与「配置在跑」是两件事（§11.7 同源），
  // 而它守的是「下一次新增一处就红」，与本次改动无关，所以进固定清单。
  "tests/router-error-envelope.test.ts",
  // 「挂载即欠执行者」：root.ts 每挂一条 procedure，就必须有测试真的调用它。
  // 这条判据的对象正是「router 挂了、接口能通、却从来没人跑过」这一族（台账 E3），
  // 而它守的是**下一次新增** —— 与本次暂存改动无关，只在受影响时才跑等于形同虚设。
  "tests/trpc-surface-executors.test.ts",
  // 产物布局的单一出处判据：`src/` 里出现第二处「产物根 / 产物地址 / 地址→磁盘」就红。
  // 这条守的是「同一句布局被抄七遍、其中两遍对同一个输入结论相反」那一族（台账 A8
  // 第二段：成片合成因此每条镜头必败），而它必须在**新增**时响 —— 与本次暂存改动
  // 有没有碰到 media/ 目录无关，所以进固定清单。
  "tests/artifact-layout-single-source.test.ts",
  // 客户端写的 REST 地址必须有落点：`src/**` 里以引号紧接 `/api/` 开头的字面量，
  // 得能在 `src/app/**` 的目录形状里找到一个 route handler。这条守的是
  // 「路径写得很像真的、handler 根本不存在」那一族（台账 E3‴：三条实测 404，
  // 调用点一句 `catch {}` 就咽成空态，全仓库没有一条判据红过）—— 新增一条假地址
  // 与本次暂存改动无关也必须响，所以进固定清单。
  "tests/rest-endpoint-targets.test.ts",
  // 「调用点的形状错误不许被咽掉」（台账 F13）：`as never` 逐处登记 + 投影参数不许是
  // unknown + `.select(… as never)` 这个形状零存在。这一族的实际事故是 `train.cancel`
  // 从 Prisma→Drizzle 迁移起每次 500 而零红 —— 新增一处就是重新装上那个消音器，
  // 与本次暂存改动无关也必须响，所以进固定清单。
  "tests/f13-projection-shapes.test.ts",
  // 「判据自己有没有执行者」：`doc:check` 接进 pre-commit D 组之后的在位判据。
  // 它必须进固定清单而不是只跟着改动走 —— 改 `.githooks/**` 会让本脚本**放弃收窄、
  // 只跑固定清单**（实测 `--changed .githooks/pre-commit` 的清单里不含任何按路径
  // 引用的用例），于是「有人把这一步摘回手动档」那次改动恰好不会跑到这条守卫，
  // 表现不是红而是「文档又开始说谎而全绿」。这一族是零执行者判据（规范 §13.5.8）。
  "tests/doc-check-hook-wiring.test.ts",
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
 * @param {{changedPaths: string[], testFiles: string[], sourceFiles: string[], readText: (rel: string) => string | null, knownFailed?: string[]}} input
 * @returns {Resolution}
 */
export function resolveAffectedTests({
  changedPaths,
  testFiles,
  sourceFiles,
  readText,
  knownFailed = [],
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

  /* 已知基线红（`KNOWN_FAILED_FILES` 单点定义，与 `run-tests.mjs` / 一键门禁同一份）：
   * 从**增量**面里剔掉，否则别线的红会让无关提交落不了地。固定清单不受影响 ——
   * 那几条是全库不变量的执行者，没有「先放行」的余地。剔除是被打印出来的，不是静默。 */
  const skipped = [...picked].filter((t) => knownFailed.includes(t));
  for (const t of skipped) picked.delete(t);

  const out = withFixed("subset", picked);
  if (skipped.length > 0) out.reasons.__skipped = skipped.join(" ");
  return out;
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
          knownFailed: KNOWN_FAILED_FILES,
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
