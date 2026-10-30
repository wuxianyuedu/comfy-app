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
 *   node scripts/check-doc-mirror-pairing.cjs --base <ref>
 *
 * `--staged` 与其它 D0 步骤同形（钩子传这个）；不带它判的也是暂存集 —— 这份工作区里
 * 没有「全量档」可判：镜像与源是否**同批**是提交的属性，不是仓库的属性。
 *
 * ── `--base <ref>`：换判决面的来源（ISSUE #2265 的现场）──────────────────────
 *
 * 暂存集是**提交的属性**，而平台那一格跑在干净快照上（索引里没有本次改动）⇒ 这一步在平台上
 * **恒不判**：它打印「暂存区是空的 —— 没有判决面」并按「没跑起来」收，
 * 被计成绿 —— 而「改了文档源、镜像没同批带上」在平台侧一个执行者都没有。
 * （⚠️ 「平台上没有暂存区」这句过去被写在下面那个 reason 里，它是错的，而且错得能骗过
 * 用例自己：ISSUE #2344 实测平台的索引**可以非空** —— 上一格的新鲜度账回写失败就会往里
 * 留东西。这里要的是「平台拿不到本次改动面」，那是 `--base` 的理由，不是「索引永远空」。）
 *
 * `--base <ref>` 把判决面换成「**相对那条基线改了什么**」：平台上拿得到（PR 事件上平台给
 * `CNB_PULL_REQUEST_TARGET_SHA`，由 `scripts/changed-scope.mjs` 统一选基线，与「受影响用例」
 * 那一格、`shell-gate` 同一份口径）。**判决链一字未改** —— 还是「改没改源 / 镜像在不在同一批」。
 *
 * ⚠️ 两条边界：
 *   · **判决面取不到 ⇒ 退 2，不是退 0**（仓库三态：0 绿 / 1 红 / 2 没跑起来）。
 *     「没有输入可判」与「判过了、没问题」是两件事 —— 退 0 会被复合档计成「绿」。
 *   · **暂存集为空 ⇒ 退 2**，除非这一笔是**说出来的**刻意空提交（见下）。
 *     原先这里写的是「`git commit` 不许空提交 ⇒ 本地这一跳的暂存集永远非空」—— 那句是错的：
 *     `--allow-empty` 存在，而 `pnpm ship --rerun-ci` 正是要靠它重新派生一条流水线
 *     （ISSUE #2354）。空索引有两种来路（忘了 stage / 刻意空提交）且逐字同形，所以不猜：
 *     只认 `scripts/intentional-empty-commit.mjs` 那个唯一口径 —— 旗标在场**且**索引真空
 *     ⇒ 这一条的问题没有对象（空提交不改任何文件），正面按 0 收；旗标在场而索引非空
 *     ⇒ 旗标当场作废并打印，照正常档判。它不是跳过门禁的开关。
 *
 * `changed-scope.mjs` 是 ESM，而本文件是 CJS —— Node 24 的 `require(esm)` 认得了（实测）。
 * **惰性 require**：只有真的走 `--base` 形态才加载它（它会拖进一条依赖链），
 * 暂存形态那一跳的加载面一字未变。
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { SCOPED_DOCS, generatedPathFor } = require("./doc-facts.cjs");
/* 刻意空提交的唯一口径（ESM，Node 的 require(esm) 认得，与下面 changed-scope 同一形态）。 */
const { intentionalEmptyCommit } = require("./intentional-empty-commit.mjs");

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

/**
 * 判决面：这一次「同批」指的是哪一批文件。
 *
 * 两个来源，**互斥**（判据只该看到一个来源 —— 两个都挂着，「到底按哪个面判」就变成读代码的事）：
 *   · `--base <ref>` ⇒ 「相对那条基线改了什么」（平台侧那一档）；
 *   · 暂存区（本地那一跳；`--staged` 只是把这件事写出来而已）。
 *
 * ⚠️ **取不到 ⇒ 这一格没判**（`ok: false`），由调用方退 2 —— 不是退 0。
 * 「没有输入可判」与「判过了、没问题」是两件事，退 0 会被复合档计成「绿」。
 *
 * @param {string[]} argv
 * @returns {{ok: true, files: string[], via: string} | {ok: false, reason: string}}
 */
function resolveFace(argv) {
  const baseIdx = argv.indexOf("--base");
  if (baseIdx >= 0) {
    const baseRef = (argv[baseIdx + 1] ?? "").trim();
    if (!baseRef) {
      return {
        ok: false,
        reason: "`--base` 要一条基线（用法：`--base <ref>`）—— 拿不到基线就没有判决面",
      };
    }
    /* 惰性 require：只有走 `--base` 形态才加载它（它会拖进一条依赖链），
     * 暂存形态那一跳的加载面一字未变。 */
    const { changedFilesForBaseRef } = require("./changed-scope.mjs");
    const got = changedFilesForBaseRef(baseRef, { cwd: ROOT });
    if (!got.ok) {
      return { ok: false, reason: got.reason };
    }
    /* 改名的两侧都进面：源被搬走了也算「这次改了源」。 */
    /* ⚠️ **空清单在这里是「成功测得没有改动」**，不是「取不到面」—— 基线取到了、
     *   diff 跑成功了、结果是空，那就是「这次什么都没改」⇒ 没有可判的内容 ⇒ 绿。
     *   （把它读成「不知道」会让 master 上的本地复算永远退 2 —— 那正是
     *   「降档不许被读成全套过了」的忌讳。） */
    return {
      ok: true,
      files: [...got.files, ...got.renamedFrom].map(asKey),
      via: `基线 ${baseRef}`,
    };
  }
  const files = stagedPaths();
  /* 空暂存区有两条来路，而它们在索引上逐字同形，所以**不猜**：只认说出来的意图
   * （唯一生产者是 `pnpm ship --rerun-ci`，ISSUE #2354 —— 它要推一笔空提交重新派生
   * 一条流水线，而 D0 把空索引读成「取不到面」就等于把那条路堵死）。
   * 两种不一致都要**当场念出来**：不念就留下一个「设了旗标而没人知道它被忽略」的现场。 */
  const intent = intentionalEmptyCommit({ stagedCount: files.length });
  if (intent.voidNote) {
    console.error(`[doc-mirror-pairing] ⚠ ${intent.voidNote}`);
  }
  if (files.length === 0) {
    if (intent.note) {
      console.log(`[doc-mirror-pairing] ${intent.note}`);
    }
    if (intent.applies) {
      return { ok: true, files: [], via: "刻意空提交（没有可判的配对）" };
    }
    return {
      ok: false,
      reason:
        "暂存区是空的 —— 没有判决面（本地可能忘了 stage，平台上也可能有非空的索引 —— " +
        "上一格的账回写失败就会把账本留在里面，ISSUE #2344）",
    };
  }
  return { ok: true, files, via: "暂存区" };
}

function main() {
  const argv = process.argv.slice(2);
  const face = resolveFace(argv);
  if (!face.ok) {
    console.error(
      `[doc-mirror-pairing] 这一条**没判**：${face.reason} —— ` +
        "没有判决面不等于「已通过」，按「没跑起来」收（退 2）。",
    );
    return 2;
  }
  const staged = new Set(face.files);
  const missing = [...SOURCES]
    .filter((src) => staged.has(src))
    .map((src) => ({ src, twin: asKey(generatedPathFor(src)) }))
    .filter(({ twin }) => !staged.has(twin));

  if (missing.length === 0) {
    console.log(
      "[doc-mirror-pairing] OK：本次没有「改了文档源、镜像没同批带上」的情形" +
        `（判决面：${face.via}，${face.files.length} 个文件）。`,
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
      "  修法：`pnpm run doc:render -- --only <上面那些源>`，只提交**自己源对应的那几份**镜像" +
      "（不要手改生成物）。\n" +
      "  ⚠️ 别跑无参的全量档：那一档**无条件**重生成所有镜像，会把别人留在 HEAD 上的陈旧镜像\n" +
      "  一起改脏进你这批（实测一例：改 1 份规范带出另一份镜像 126 行整表重排，ISSUE #2527）。\n" +
      "  想知道「全量现在漂了谁」跑 `pnpm run doc:render -- --check`（只比对不写），\n" +
      "  它点名的那几份若不在你的批里，那是上一批留下的漂移 —— 立案或留给那一批，别顺手代改。",
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, stagedPaths, SOURCES };
