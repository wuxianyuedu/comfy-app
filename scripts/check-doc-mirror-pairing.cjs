#!/usr/bin/env node
/**
 * check-doc-mirror-pairing.cjs — 「改了 `SCOPED_DOCS` 里的文档源，就必须同批带上它的
 * `docs/generated/**` 镜像」，判在**提交那一刻**（规范 §13.5.5）。
 *
 * ## 为什么这条要活在本地钩子里（而它那两个同类判据都在平台侧）
 *
 * 2026-10-16 那批（ISSUE #1975）把「生成态文档与源同步」整体挪到平台，理由是它判的是
 * **读者面**的一致性、挡不住任何一次代码回归 —— 那句到今天仍然成立。但它留下了一个
 * 没人管的形状：**平台那一格跑的是 `--check --autofix`**（`scripts/ci-heavy-gates.mjs`
 * 里那条），它会**就地修好再判**，于是「改了源、镜像没跟着提交」这件事在它的读数里
 * 根本不会出现。唯一还照得出它的是 `受影响用例` 那格里的
 * `tests/check-doc-references.test.ts`「绿的时候不多写」—— 那一格判的是**增量面**，
 * 命中的往往是**下一个动文档面的人**，不是漏带镜像的那个人。
 *
 * 实测这一族在 2026-10-21 一天里复现三次（每次都吃掉一次 CI 往返，红话还指着别人
 * 没碰过的文件）。**「下次记得带镜像」不是判据**：漏带的人本地全绿、平台也全绿，
 * 红总在别人身上 —— 这正是 §13.5.12 立案的那一族（判据写了、执行者不在改它的那个人身上）。
 *
 * ## 为什么这一条可以进 D0（成本口径）
 *
 * 与那两个挪走的判据不同，它**不读任何文档内容**：一次 `git diff --cached --name-only -z`
 * 加一次 Set 比对，判的是「这次提交的形态对不对」—— 那是 D0 形态前置档的本职（§13.5.8.2.1）。
 * 内容一致性仍由平台那一格判（那边有 `pnpm doc:render` 的产物可写）。
 *
 * 用法：
 *   node scripts/check-doc-mirror-pairing.cjs [--staged]
 *
 * `--staged` 与其它 D0 步骤同形（钩子传这个）；不带它判的也是暂存集 —— 这份工作区里
 * 没有「全量档」可判：镜像与源是否**同批**是提交的属性，不是仓库的属性。
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { SCOPED_DOCS, generatedPathFor } = require("./doc-facts.cjs");

const ROOT = path.resolve(__dirname, "..");
/**
 * git 输出的是正斜杠，而 `path.join` 在 Windows 上给反斜杠 —— 比较前统一成前者。
 * @param {string} p @returns {string}
 */
const asKey = (p) => p.split(path.sep).join("/");
const SOURCES = new Set(SCOPED_DOCS.map(asKey));

/**
 * 暂存区里的路径（`-z` 分隔：本仓文档名含中文与前导点，换行分隔的形态在这上面会错位）。
 * @returns {string[]}
 */
function stagedPaths() {
  const out = execFileSync("git", ["diff", "--cached", "--name-only", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out
    .split("\0")
    .filter((s) => s !== "")
    .map(asKey);
}

function main() {
  const staged = new Set(stagedPaths());
  const missing = [...SOURCES]
    .filter((src) => staged.has(src))
    .map((src) => ({ src, twin: asKey(generatedPathFor(src)) }))
    .filter(({ twin }) => !staged.has(twin));

  if (missing.length === 0) {
    console.log(
      staged.size === 0
        ? "[doc-mirror-pairing] 暂存区是空的 —— 没有什么可判（这不是「已通过」）。"
        : "[doc-mirror-pairing] OK：本次没有「改了文档源、镜像没同批带上」的情形。",
    );
    return 0;
  }

  console.error(
    "[doc-mirror-pairing] ✗ 这批改了 SCOPED_DOCS 里的文档源，但没带上对应的生成态镜像：",
  );
  for (const { src, twin } of missing) {
    console.error(`  · 源在批里：${src}\n    镜像不在批里：${twin}`);
  }
  console.error(
    "  为什么拦在这里而不是等平台：平台那一格 `生成态文档与源同步` 跑的是 `--check --autofix`，\n" +
      "  它会**就地修好再判**，所以这一族在平台读数里从不出现；红总是落在下一个动文档面的 PR 上\n" +
      "  （命中它的是 `受影响用例` 里 `tests/check-doc-references.test.ts` 的「绿的时候不多写」）。\n" +
      "  修法：`pnpm doc:render` 之后把 `docs/generated/**` 一并提交 —— 不要手改生成物。",
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, stagedPaths, SOURCES };
