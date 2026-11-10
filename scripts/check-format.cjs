#!/usr/bin/env node
// @ts-nocheck -- oxfmt 格式判据(判定型;执行者 = .githooks/pre-commit 的 D0(带 --staged)、GA .github/workflows/pr-gate.yml 的两格(带 --changed 的改动面档 + 不带旗标的全量档) 与 pnpm check:all(带 --changed),盘点出口 pnpm format:report(全量档只出清单))
/**
 * oxfmt 格式判据（**硬闸**）—— 规范见 docs/standards/13-提交与-code-review.md §13.5.1。
 * （格式化器 prettier → oxfmt 的迁移见 ISSUE #2541；下文「prettier 时代」字样是历史叙述，
 * 现役调用面只认 oxfmt。）
 *
 * ── 它在哪跑：本地 D0 判 + 平台侧判（ISSUE #2610，2026-10-29；中间那段历史见下）─────
 *
 * 现在是**一份实现、三档判面**（判面收窄是 printWidth 迁移的地基，见下）：
 *   · `.githooks/pre-commit` 的 **D0** 带 `--staged`（「没碰到扫描面」就跳过并明说跳过，
 *     红了当场 `pnpm exec oxfmt <点名的文件>`，只点本次改的 —— 不必等一次 CI 往返）；
 *     命中扫描面后判的是**暂存的那一批**，不再回落全库；
 *   · `.github/workflows/pr-gate.yml` 的「oxfmt 格式」（`--changed`）与 `pnpm check:all`
 *     带 `--changed`：判**改动面**（`changed-scope.mjs` 的 `resolveChangedFiles`，
 *     基线 = `CNB_PULL_REQUEST_TARGET_SHA` 三点 diff，本地退回各 remote/本地 master
 *     的分叉点）∩ `GLOBS`；
 *   · **默认（不带旗标）照旧全库**——硬闸语义「未过 oxfmt 的文件一个都不许有」
 *     由这一档背书。执行者是 `pr-gate.yml` 紧跟 `--changed` 之后的第二格（ISSUE #3291，
 *     2026-11-07），所以是**合入前唯一自动执行点**、暴露窗口 0；`--report` 盘点也走全库，
 *     但只出清单。
 * 这几处都由 `tests/doc-check-hook-wiring.test.ts` 与 `tests/ci-incremental-gates.test.ts`
 * 钉（钩子里有 + 平台两格都在 + 都指这一份脚本）。
 *
 * ⚠️ `--staged` 另有**一道输入面前置**（ISSUE #3259）：oxfmt 按路径读工作区，不读 index
 * blob，所以「这批路径此刻在工作区的样子」不必然等于「本次要提交的字节」。判绿之前
 * 先对 `hits` 查一次 index ⇄ 工作区是否一致；不一致就按 §13.6.3 不给结论（exit 2 +
 * 点名），一致才往下判 —— 那样判绿才真的推出提交内容干净。只管 `--staged` 这一档：
 * 平台 `--changed` 判的是 `<基线>...HEAD`，那里的工作区本来就是已提交的树。
 *
 * ⚠️ **两份扫描面，各管各的**（ISSUE #2979）：改动面两档（`--staged` / `--changed`）
 * 的扫描面 = **改动面 ∩ `GLOBS`**，不过 `IGNORE_GLOBS`；`IGNORE_GLOBS` 只对全量档生效
 * —— 它是「存量迁移」的白名单，不是「这些文件不用管格式」的白名单。
 *
 * ── 为什么判面要收窄（printWidth 80 → 100 的增量迁移）──────────────────
 *
 * `printWidth` 改成 100 的那一刻，全库档对**还没迁移的存量**恒红：一行 79 列的
 * 旧代码什么都没做错，只是按旧行宽折过行。一次性全量重排走不通——它会被
 * `check-merged-side-loss.mjs`（#1617）判成「整份退回」：解开 80 列折行后的
 * 字节流恰好等于某些文件**更早的历史版本**（实测 width=100 重排一次，5 份命中），
 * 而那条判据没有豁免口。所以迁移只能增量：**谁碰一个文件，谁把它迁到 100**，
 * 判面跟着收窄到「这次改动带来的那批」。代价要说清楚：全库不变式从「每一份都干净」
 * 弱成「你带来的每一份都干净」，没被碰过的存量文件不迁移就不变干净——这是
 * 增量采用的定义，不是漏洞。
 *
 * 这段历史之所以值得留在文件头上，是因为它三步都在判同一件事：「**自称在哪跑**」与
 * 「**真在哪跑**」必须一致（§13.5.12 立案的那族形态）。
 *   ① ISSUE #2010：从钩子挪到平台侧。理由成立 —— 这一档的结论挡不住任何一次代码回归，
 *      格式漂了没有运行时症状，最坏后果是一次 `--write` 产出与本次改动无关的全文件 diff
 *      （§13.7），而它留在每次提交里的成本实测是冷缓存 ~21s / 热缓存 ~4.5s。
 *   ② ISSUE #2342 → #2362/#2365：让平台那一格「红 ⇒ 就地修好 ⇒ 委托可信事件把修复提交
 *      推回 PR 源分支」。它解决的是「PR 事件的令牌推不动」（`repo-code:r`，没有 YAML 开关能翻）。
 *   ③ ISSUE #2610（本轮）：那第二条的**委托那一跳**在 PR 事件上也发不出去 —— 2026-10-28
 *      实测 `start-build` 回 `403 / errcode 10023 / Missing required scopes:
 *      repo-cnb-trigger:rw`（build `cnb-tb0-1k61hpvhf`）。于是「就地修」的产物每次都被
 *      丢在 CI 工作区里，账面只留一句「委托没发出去」，而格式红照旧要人回来补一次 oxfmt
 *      —— 白跑一次 CI 往返，还没买到任何东西。**修了但没人负责**比不修更坏（ISSUE #2231
 *      同型：「自动修 + 再判」正是让陈旧在 CI 上隐形的那一格）。⇒ autofix 与委托整条摘掉，
 *      判与修落回本地，平台只判。
 *
 * ⚠️ 与它相邻的 `check-reformat-only.cjs`（「格式化提交与行为改动分离」）**一直留在钩子里**，
 * 两件事别混：那一条判的是「这次提交有没有把真实改动埋进几百个文件的重排里」，
 * 后果是不可逆的（`git blame` 永久失真、squash 合并后本地再没有拆分的机会），
 * 而这一条判的只是「文件现在干不干净」—— 那个随时可以再修。
 * 也正因如此，②那种「由平台替你改源文件」的形态对上一条完全不适用 —— 它一旦被自动修，
 * 「行为改动与格式化各一笔」这条纪律就永久没了（bot 提交会把两种改动混在一笔里）。
 *
 * 背景(ISSUE #575 第 9 项):
 * `format:check` 长期是**唯一没有纳入门禁**的既有质量命令。原因很实在 ——
 * 全库 576 个文件未过 prettier,一次性 `--write` 会产生与本次改动无关的全文件
 * diff,直接违反 §13.7「禁止无关全文件变更」(评审无法从 diff 里看出改了什么)。
 * 但它长期不进门的代价是:每个新文件都可以带着任意格式进来,存量只会更多,
 * 「等基线整改完再接入」因此**永远不会发生**。
 *
 * 判据:**未过 oxfmt 的文件一个都不许有**(ISSUE #1811 收尾时从棘轮翻成硬闸;那时
 * 格式化器还是 prettier,#2541 起换 oxfmt,判据对象随之迁移)。
 *
 * 它此前是棘轮(基线 `scripts/.format-baseline.json` + 只许下降):当年一次性
 * `--write` 全库会产出与本次改动无关的全文件 diff(违 §13.7),所以存量冻结在基线上。
 * 存量**已清零**,于是棘轮车道没有成员 —— `--update` 写回去的永远是一份空账,
 * 留下的却是「手改 JSON 就能把新违规登记成已知存量」这条通道(§13.6.2 的两类对照)。
 * 所以删基线、删 `--update` / `--strict`,命中即退 1;`--report` 保留(清零后的自证靠它)。
 *
 * 为什么按**文件**记账而不是记全局「未过文件数」:计数只约束总量 —— 修好 3 个、
 * 弄坏 4 个,总数变大才失败,弄坏的那 3 个无人知晓。文件级记账下,「把干净的
 * 文件弄脏」当场失败,而「这个文件此前是干净的」本身就是一个可断言的事实。
 *
 * 为什么白名单是**形态**(glob)而不是文件列表:`scripts/` `tests/` `e2e/` 与根级
 * 配置是**高频 churn 路径**(每次踩坑都要改一遍),把它们纳入棘轮会让每一次排障
 * 提交都顺带产生格式 diff。用 glob 表达「这类文件暂不纳入」不会漂移,且新增这类
 * 文件时自动落在白名单里(不误报)。豁免不进棘轮计数。
 *
 * 白名单里的第二类是**非源码产物**:`src-tauri/target/` 下是 `cargo build` 的输出
 * (Rust 壳)。**现在谁在忽略它**（ISSUE #2602）:本门禁与 `format:check` / `format:write`
 * 的扫描面收口在 `SCAN_ROOTS` 五个目录（`src`、`.storybook`、`scripts`、`tools`、`e2e`）
 * ——`target/` 天然不在面内,不存在「生成脚本被格式化工具折行 ⇒ serde_json 读到尾随逗号 ⇒ 整壳编译失败」
 * 那一条(那是 prettier 时代的现场,当年的执行者是根级 `.prettierignore`,#2541 删
 * prettier 时一并删了;这条历史上的根因与取证见 ISSUE #730 / #638)。产物既不该被
 * 格式化 —— 下一次构建会覆盖它,也不该进棘轮计数。
 *
 * 调用形态:oxfmt 一次 `--check <targets…>`,targets 是**展开后的文件路径**——glob 不交给
 * shell 展开(Windows 上 cmd/pwsh 的展开语义与 POSIX 不同,逐个列路径对平台无感)。
 * prettier 时代的 `--cache` 不再沿用(oxfmt 无缓存档,全量实测 2s 级,见文件头成本段)。
 *
 * 用法:
 *   node scripts/check-format.cjs             # 全库检查(硬闸:命中即退 1) —— 裸调用的硬闸语义;
 *                                           #   平台侧 `pr-gate.yml` 也跑这一档(ISSUE #3291)
 *   node scripts/check-format.cjs --changed   # 只判改动面 ∩ GLOBS —— 平台侧改动面格与 check:all 用这一档
 *   node scripts/check-format.cjs --report    # 只出清单不判失败(盘点用,照旧全库)
 *   node scripts/check-format.cjs --staged    # 判暂存面(人的动作:提交前自查)
 *                                           #   合并态(MERGE_HEAD 在场)下暂存面 = 相对第一父的
 *                                           #   全量差异,会收窄到本分支带来的那份(ISSUE #2747)
 *
 * ── `--staged` / `--changed` 的输入面：两份扫描面怎么分（ISSUE #2979）─────────
 *
 * 全库扫描实测 **3.5–4.8s**(热缓存,本机 8 核;2026-11-07 复测)。它曾是钩子 D 组里
 * **单项最贵**的一步 —— 旧注释记的 17.6s 是当时的量级,与今天差一个量级;引用成本时
 * 按现读数,不要再拿那笔旧账当今天的依据。
 *
 * 全量档的扫描面由既有配置算出来(`git ls-files` 跟踪的全库,落在 `SCAN_ROOTS` 五个
 * 目录里、又被 `GLOBS` 收口的那些):
 *   · `GLOBS` 收 `.ts/.tsx/.js/.jsx/.mjs/.cjs/.mdx` —— 连 `.md` 都不在其内,所以
 *     `docs/**` `changelog.d/**` `README.md` **本来就一份都不扫**;
 *   · `IGNORE_GLOBS` 在全量档上把 `tests/` `public/` `docs/api/**`
 *     `docs/generated/**` `src-tauri/target/**` 与根级 `*.js` / `*.config.*` 整类剔掉
 *     （`scripts/` `tools/` `e2e/` 原本也在此列，2026-11-06 清完存量后移出，ISSUE #3251）;
 *   · 剩下的是 `src/**`、`.storybook/**`、`scripts/**`、`tools/**`、`e2e/**` 里
 *     上述扩展名的那批。
 *
 * 「只加了 changelog 碎片 / 只改文档 / 只碰 `tests/`」
 * 这一大类提交,在**全量档**上是白付:那些文件根本不在 oxfmt 的靶子里,扫多少遍
 * 结论都一样(这一层收窄是 ISSUE #1747 加的,手法与 `check-docs-api.cjs --staged`
 * 逐字同源)。改动面两档(`--staged` / `--changed`)进一步把「判面」收窄到
 * 「这次改动带来的那批」—— 收窄后判**点名的那个批次**,不回落全库。
 *
 * ⚠️ **`IGNORE_GLOBS` 不进改动面两档**（ISSUE #2979）：它的立论是「高频 churn 路径
 * 纳入棘轮会让每次排障都产生格式 diff」—— 那是**棘轮时代**的话；翻成硬闸之后
 * （§13.5.1，#1811）改动面两档对存量本来就不红，白名单在那两档上剩下的唯一效果
 * 是「列在里面的目录没有任何一个判决面能拦到」（本地那步说「跳过」、当时 CNB 那格
 * `ifModify` 不含 ⇒ 根本不执行，两处都不红 —— #2942 重跑现场点名的三份
 * `.mjs`/`.cjs` 全在 `scripts/`，说明判据面本该含它；`scripts/` 已于 ISSUE #3251
 * 与 `tools/` `e2e/` 一起从全量档白名单移出）。所以两档的扫描面是
 * **改动面 ∩ `GLOBS`**（`isChangedFaceFile()`，同一份 `GLOBS` 展开，不另抄清单），
 * `IGNORE_GLOBS` 只对全量档生效 —— 它是「存量迁移」的白名单，不是
 * 「这些文件不用管格式」的白名单。
 *
 * **跳过是结论,不是沉默放行**:未命中时打印一行「本次提交未触及扫描面,跳过」,
 * 与真正扫过之后的 `[format] OK` 在输出上可分辨(§11.23 的「声明 ⇄ 读者」口径)。
 * ⚠️ 边界:它**只**跳过 `check` 档。`--report` 是人的动作,不受 `--staged` 影响
 * (照旧全库)。
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const { gateFail, gatePass, indentItems } = require("./ci-log.mjs");

/* oxfmt 的调用**不经 pnpm 层**（口径同台账 E10：平台 shim 那一层正是
 * 「命令没跑成却被读成没问题」的藏身处；这条规矩是 prettier 时代立的，换 oxfmt 后照旧）。
 * 入口三级解析（实现见下方 `resolveOxfmtEntry`）：
 *   1. `COMFYAPP_OXFMT_ENTRY` —— 门禁自己的用例在临时目录里搭沙箱，那里没有
 *      `node_modules`，不给这条接缝就只能撞「入口取不到」；
 *   2. 按扫描根 resolve `oxfmt/package.json` → 同目录 `bin/oxfmt`；
 *   3. resolve 失败时回落按扫描根拼 `node_modules/oxfmt/bin/oxfmt`；再取不到 →
 *      exit 2 并说明「没跑成」。
 * **任何一档都不许回落成「0 个文件未过」** —— 那正是本脚本过去的 fail-open 形态。
 *
 * 取 ESM 判据模块（`launcher-core/shell.mjs`）的那段动态 import 随之删除：
 * 本脚本不再需要 pnpm 形态判定，`main()` 保持 async 只为收尾顺序不变。 */

/* 扫描根取 cwd:门禁在仓库根被调用,而 oxfmt / git 都按 cwd 解析仓库
 * (与 check-circular-deps.cjs 同口径)。基线取 __dirname 旁,与脚本同目录。 */
const ROOT = process.cwd();
const ARGS = new Set(process.argv.slice(2));

/** oxfmt 入口的三级解析（见上）。取不到返回 null，由 `main()` 以 exit 2 收尾。 */
function resolveOxfmtEntry() {
  const fromEnv = process.env.COMFYAPP_OXFMT_ENTRY;
  if (fromEnv) {
    return fs.existsSync(fromEnv) ? fromEnv : null;
  }
  try {
    // 按扫描根解析：门禁在仓库根被调用，本地 `node_modules/oxfmt` 就是它的依赖。
    // 取 `oxfmt/package.json` 而不是直接 resolve `oxfmt/bin/oxfmt`：后者可能被包的
    // `exports` 字段挡住（子路径不导出），前者是常见可解析面；两者都失败时退回按
    // 扫描根拼路径（与 prettier 时代「任何一档都不许回落成 0 个未过」同口径）。
    const pkg = createRequire(path.join(ROOT, "noop.js")).resolve("oxfmt/package.json");
    return path.join(path.dirname(pkg), "bin", "oxfmt");
  } catch {
    const fallback = path.join(ROOT, "node_modules", "oxfmt", "bin", "oxfmt");
    return fs.existsSync(fallback) ? fallback : null;
  }
}

const REPORT_ONLY = ARGS.has("--report");
const STAGED = ARGS.has("--staged");
const CHANGED = ARGS.has("--changed");

/** 扫描范围与 package.json 的 format:write（以及 .oxfmtrc.json 的纳入面）逐字一致。
 * `mjs` / `cjs` 是 ISSUE #2979 加的：`scripts/**` 的入口与判据本来就是这两个扩展名，
 * 它们不进面 = 「这一仓自己的脚本从来没被格式判据看过」。 */
const GLOBS = ["**/*.{ts,tsx,js,jsx,mjs,cjs,mdx}"];

/** oxfmt 的扫描根：`GLOBS` 减白名单后收口出的面是 `src/**` + `.storybook/**` +
 * `scripts/**` + `tools/**` + `e2e/**`（根上的 `*.config.*` / `*.js`、`tests/**`、
 * `public/**` 等仍在 IGNORE_GLOBS 里）。
 * ⚠️ 这一半**只管全量档**（默认 / `--report`，ISSUE #2979）：它是「存量迁移」的白名单，
 * 不是「这些文件不用管格式」的白名单 —— 改动面两档（`--staged` / `--changed`）的
 * 扫描面是**改动面 ∩ `GLOBS`**，不过 `IGNORE_GLOBS`（见 `isChangedFaceFile()`）。
 * 传目录而非 glob：oxfmt 认 glob，但 glob 形态会把白名单里的目录也带进来，
 * 交给下面的 `isScanned()` 收口更直白（同一份真源，不另抄一份名单）。 */
const SCAN_ROOTS = ["src", ".storybook", "scripts", "tools", "e2e"];

/** 白名单(glob,相对仓库根):① 高频 churn 路径;② 非源码产物(构建输出)。见文件头注释。
 * ⚠️ 它**只对全量档生效**（默认 / `--report`，ISSUE #2979）：改这两档立论的时候
 * （棘轮时代「高频 churn 不想每次排障都带格式 diff」）硬闸还没来；翻成硬闸之后
 * （§13.5.1，ISSUE #1811）这条理由对「判本次改动」的两档已经不成立 —— 那两档
 * 对存量本来就不红（改动面收窄）。`scripts/` `tools/` `e2e/` 已于 ISSUE #3251
 * 从这一份移出（存量清零，全量档要开始判它们）；剩下的条目是「存量还没迁完」的
 * `tests/` `public/` 等，以及根级配置与非源码产物。所以改动面两档（`--staged` /
 * `--changed`）的扫描面不过这一份（`isChangedFaceFile()`），全量档照旧。 */
const IGNORE_GLOBS = [
  "tests/**",
  "public/**",
  "docs/api/**",
  "docs/generated/**",
  /* ② 非源码产物:Rust 壳的构建输出(被嵌套的 src-tauri/.gitignore 忽略)。 */
  "src-tauri/target/**",
  /* 根级配置（ISSUE #3293）：全量档只逐 `SCAN_ROOTS` 跑，根级文件不在任何扫描根
   * ⇒ 这一条**移不移出都不改变全量档的判决面**（移出是假动作，只会把 `isScanned()`
   * 的声明面变宽）。两份存量（`drizzle.config.ts` / `oxlint.config.ts`）已在本批迁到
   * oxfmt 100 列；它们的实际判决面是 `--changed` / `--staged`（被碰时才判），
   * 与全量档无关。留着的意义是「声明 ⇄ 事实」对齐。 */
  "*.config.{js,ts,mjs,cjs}",
  "*.js",
];

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function escapeRe(s) {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** 把 glob 转成正则(支持 `**` / `*` / `?` / `{a,b}`):不引依赖,口径可控。 */
function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob.slice(i, i + 3) === "**/") {
        out += "(?:.*/)?";
        i += 2;
      } else if (glob.slice(i, i + 2) === "**") {
        out += ".*";
        i += 1;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "{") {
      const close = glob.indexOf("}", i);
      if (close === -1) {
        out += String.raw`\{`;
        continue;
      }
      out += `(?:${glob
        .slice(i + 1, close)
        .split(",")
        .map(escapeRe)
        .join("|")})`;
      i = close;
    } else if (c === "/") {
      out += "/";
    } else {
      out += escapeRe(c);
    }
  }
  return new RegExp(`${out}$`);
}

const IGNORE_RES = IGNORE_GLOBS.map(globToRegExp);
const GLOB_RES = GLOBS.map(globToRegExp);

function isIgnored(rel) {
  return IGNORE_RES.some((re) => re.test(rel));
}

/**
 * 扫描面的**正形态**:先由 `GLOBS` 认出「oxfmt 会看的文件」,再剔掉
 * `IGNORE_GLOBS`。两者是同一份白名单的两个方向,所以这里不重复任何目录名。
 * ⚠️ 只服务**全量档**（`SCAN_ROOTS` 的收口）；改动面两档走 `isChangedFaceFile()`。
 * @param {string} rel 仓库根相对 POSIX 路径
 */
function isScanned(rel) {
  return GLOB_RES.some((re) => re.test(rel)) && !isIgnored(rel);
}

/**
 * **改动面两档**（`--staged` / `--changed`）的扫描面：改动面 ∩ `GLOBS`，
 * **不过 `IGNORE_GLOBS`**（ISSUE #2979）。
 *
 * 为什么是两份判面：`IGNORE_GLOBS` 的立论是「高频 churn 路径纳入棘轮会让每次
 * 排障都产生格式 diff」—— 那是**棘轮时代**（存量冻结、`--write` 带整文件重排）的话。
 * 翻成硬闸之后，改动面两档对存量本来就不红（只判「这次改动带来的那批」），
 * 白名单在那两档上剩下的唯一效果就是「本仓自己的脚本 / 用例从来没被格式判据看过」
 * —— 而平台那一格真点到过 `scripts/**` 的文件（#2942 重跑现场：三份 `.mjs`/`.cjs`
 * 被点名），说明判据面**本该**含它。全量档照旧（存量迁移另有 #2710 的账；
 * #3251 迁完 scripts/tools/e2e 后，只剩 `tests/**` 与根级匹配 `GLOBS` 的文件不在
 * 全量档面内（2026-11-07 实测 tests 368 份 + 根级 7 份；其中根级 2 份的格式债已由
 * ISSUE #3293 清掉）—— 谁碰谁迁）。
 *
 * @param {string} rel 仓库根相对 POSIX 路径
 */
function isChangedFaceFile(rel) {
  return GLOB_RES.some((re) => re.test(rel));
}

/** 本次提交是不是一个**待落地的合并提交**（`$GIT_DIR/MERGE_HEAD` 在场）。
 * 判据只有一份：`git-dir.mjs` 的 `hasInProgressMerge` —— 那里写清了为什么只有这一个
 * 信号算数（`merge-base` / `--is-ancestor` 都看不出来，HEAD 还没动），以及为什么
 * 不能硬拼 `<根>/.git/MERGE_HEAD`（链接工作树里 `.git` 是个文件，拼出来的路径永远读不到）。
 * `require(esm)` 与下面 `--changed` 那一档同形（Node 24 认得了），而 `git-dir.mjs`
 * 只依赖 node 内置 —— 沙箱夹具那份依赖抄得动。 */
function mergeInProgress() {
  const { hasInProgressMerge } = require("./git-dir.mjs");
  return hasInProgressMerge(ROOT);
}

/**
 * 改动面先算（这是 git 的事，与 oxfmt 装没装无关）：拿不到 ⇒ exit 2，
 * 「没判」不冒充「干净」—— 与 ci-affected-tests 同一口径（§13.6.2）。
 * 判据实现只有一份出处：`changed-scope.mjs`（基线选取 / 三点 diff / quotePath
 * / 改名两侧都收），这里不抄第二份（§12.18）。`require(esm)` 与
 * `check-doc-mirror-pairing.cjs` 同形，`copyGateDeps` 按这一形态补沙箱依赖。
 */
function changedFaceOrExit() {
  const { resolveChangedFiles } = require("./changed-scope.mjs");
  const changed = resolveChangedFiles({ cwd: ROOT });
  if (!changed.ok) {
    console.error(
      `[format] 改动面没算出来：${changed.reason}\n` +
        "[format]   按 fail-closed 判「没判」，以 exit 2 结束（不冒充「未触及扫描面」）。",
    );
    process.exit(2);
  }
  return changed;
}

/** 暂存改动清单(仓库根相对 POSIX 路径)。git 拿不到时返回 null —— 由调用方 fail-closed。 */
function stagedFiles() {
  /* `-c core.quotePath=false`:路径要原样(ISSUE #2272,机制见 scripts/changed-scope.mjs 的
   * 文件头「口径 ④」)。git 默认把含非 ASCII 字符的路径转义加引号,而本仓有 38 份文件名
   * 带非 ASCII 的文件(全在 docs/ 下)⇒ 转义过的路径认不出来,那些文件会**不进 oxfmt**。 */
  const res = spawnSync("git", ["-c", "core.quotePath=false", "diff", "--cached", "--name-only"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    return null;
  }
  return (res.stdout || "").split(/\r?\n/).filter(Boolean).map(toPosix);
}

/**
 * 暂存面里「index ⇄ 工作区还不一致」的那批路径（ISSUE #3259）。
 *
 * `--staged` 把 `hits` 交给 `oxfmt --check <targets…>`，oxfmt 按路径读的是**工作区**
 * 文件，不是 index blob。于是判据自称判「暂存的那一批」，真判的却是「这批路径此刻
 * 在工作区长什么样」：暂存了脏内容、又把工作区改干净（AM）就能拿一个假绿，而
 * 提交进历史的是那份没过 oxfmt 的 blob；反过来（index 干净、工作区又改脏）会假红。
 *
 * 这一格只回答「判据此刻能不能替**要提交的字节**背书」。两边一致时判工作区等价于
 * 判 index blob，判绿才成立；不一致时按 §13.6.3 不给结论，交回人把两边对齐。
 *
 * 为什么用一次不带 `--` 的 `git diff --name-only` 再求交集：① 命令短，不受 Windows
 * 32K 命令行上限约束（一次提交可以带几百份）；② `git diff` 不列未跟踪文件，正好
 * 不碰「只判暂存的那一批」那条形；③ 交集只取 `hits`，面外任何没暂存的改动都不
 * 进这一格 —— 收窄面（ISSUE #1747 / #2979）与合并态收窄（ISSUE #2747）都不受影响。
 *
 * 与 `stagedFiles()` 同一把尺子：`core.quotePath=false` + POSIX 路径。
 * 读不出来返回 null ⇒ 调用方 fail-closed（「判据没跑成」≠「判过了且没问题」）。
 *
 * @param {string[]} hits 本次暂存面 ∩ GLOBS 的路径
 * @returns {string[] | null} 不一致的路径（排序后），或 null = 没读到读数
 */
function unstagedOverlap(hits) {
  const res = spawnSync("git", ["-c", "core.quotePath=false", "diff", "--name-only"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    return null;
  }
  const dirty = new Set((res.stdout || "").split(/\r?\n/).filter(Boolean).map(toPosix));
  return hits.filter((rel) => dirty.has(rel)).sort();
}

/**
 * oxfmt 调一次 `--check <targets…>` 的**共通壳**：三条 fail-closed 规则 +
 * 剥 ANSI + 抽文件名（两条收集器共用这一份，§12.12）。
 *
 * 三条 **fail-closed** 规则（本函数过去只有前两条的一半，因而存在一条
 * 「命令没跑成 → 报全库干净」的出路，见台账 E11）：
 *   · 子进程被信号杀掉（`status === null`，含超时被杀）→ exit 2；
 *   · 退出码不属于 {0, 1} → exit 2（配置写错 / 解析失败，oxfmt 会走这一档）；
 *   · **退出 1 却一行文件都没列出来** → exit 2。
 * 第三条是关键：`--list-different` 返回 1 的含义是「有差异，清单在 stdout」，
 * 而清单为空与「命令根本没跑成」（例如 `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL
 * Command "prettier" not found`，退出码同样是 1 且 stdout 为空）在旧代码里
 * 长得一模一样 —— 于是门禁把「什么都没扫」读成「0 个文件未过（基线 0 个）/ OK」。
 *
 * @param {string} entry oxfmt 入口（已解析）
 * @param {string[]} targets 本次调用的目标（一个扫描根，或点名的一批文件）
 * @param {string} subject 报错/调试信息里的目标描述（如 `扫描根 src`、`点名的 7 份改动`）
 * @returns {string[]} 有差异的文件路径（oxfmt 原样交回的那批）
 */
function oxfmtCheckTargets(entry, targets, subject) {
  const args = ["--check", ...targets];
  const res = spawnSync(process.execPath, [entry, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    // 单文件清单在超大仓库里能到几百 KB；默认 1 MB 会把 stdout 截成空串，
    // 那正好落进上面第三条要拦的形态 —— 宁可显式给大。
    maxBuffer: 64 * 1024 * 1024,
    timeout: 600_000,
  });
  if (res.error) {
    console.error(
      `[format] 无法执行 oxfmt（${res.error.code ?? "UNKNOWN"}）：${res.error.message}\n` +
        `[format]   实际命令：${process.execPath} ${entry} ${args.join(" ")}`,
    );
    process.exit(2);
  }
  if (res.status === null) {
    console.error(
      `[format] oxfmt 被信号终止（${res.signal ?? "unknown"}），不是「没有差异」。\n` +
        `[format]   入口 ${entry}，${subject}。`,
    );
    process.exit(2);
  }
  /* 排查逃生口（默认关）：`COMFYAPP_FORMAT_DEBUG=1` 时把 oxfmt 的原始读数
   * 原样吐出来 —— 判据自测在「本地绿、CI 红」的形态下，没有这批读数就只能猜
   * （脏文件被判干净时，到底是没扫到还是没认出来，两种修法完全不同）。
   * 走 **stdout** 而不是 stderr：夹具把成功那档的 `output` 折成纯 stdout，
   * 打 stderr 这批读数在「判据成功退出」的用例里永远看不见。 */
  if (process.env.COMFYAPP_FORMAT_DEBUG) {
    /* `stdout` 实测在子进程起不来时是 `undefined`、失败时 `error` 才有值 —— 下面那个
     * `?? ver.error` 就是为这一支写的（`@types/node` 把它们按 `encoding` 声明成非空）。 */
    const ver = /** @type {{ stdout?: string, error?: unknown }} */ (
      spawnSync(process.execPath, [entry, "--version"], {
        encoding: "utf8",
      })
    );
    console.log(
      `[format][debug] ROOT=${ROOT}\n` +
        `[format][debug] oxfmt --version=${JSON.stringify(ver.stdout ?? ver.error)}\n` +
        `[format][debug] oxfmt status=${res.status} stdout=${JSON.stringify(res.stdout)}\n` +
        `[format][debug] oxfmt stderr=${JSON.stringify(res.stderr)}`,
    );
  }
  const lines = (res.stdout || "")
    // **先剥 ANSI 颜色码再解析**：oxfmt 会给文件名上色（实测 CI 侧
    // `\u001b[38;2;…msrc/lib/fresh.ts\u001b[0m (0ms)`），带码的「文件名」
    // 过不了 `isScanned` 的路径形态，整张清单会被悄悄滤成空 —— 门禁当场读成
    // 「命中 0 个」（本地 stdout 不着色，所以这一档只在 CI 形态下暴露）。
    .replaceAll(/\u001b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.trim())
    // 有差异行形如 `src/foo.ts (12ms)`；其余是 `Checking formatting...` /
    // `Format issues found in above N files.` / `Finished in ...` 这类摘要行，
    // 认不出的行一律丢掉（宁可漏报也不许把摘要行当成文件名）。
    .map((line) => line.match(/^(?<label>.+?)\s+\(\d+(?:\.\d+)?(?:ms|s)\)$/)?.groups?.label ?? null)
    .filter((line) => line && !line.startsWith("["));
  if (res.status !== 0 && res.status !== 1) {
    console.error(
      `[format] oxfmt 执行失败(exit ${res.status}):\n${res.stderr || res.stdout || ""}`,
    );
    process.exit(2);
  }
  if (res.status === 1 && lines.length === 0) {
    console.error(
      "[format] oxfmt 退出 1（「有差异」）却没有列出任何文件 —— 按 fail-closed 判定为\n" +
        "[format]   「命令没跑成」，不是「全库干净」。真实仓里出现这一行请贴出入口与\n" +
        "[format]   下面这段 stderr。",
    );
    if (res.stderr) {
      console.error(`[format]   stderr: ${String(res.stderr).trim()}`);
    }
    process.exit(2);
  }
  return lines;
}

/** 相对路径归一 + 白名单收口（两条收集器同一段，收在这里）。 */
function keepScanned(f, found) {
  const rel = toPosix(path.relative(ROOT, path.resolve(ROOT, f)));
  // 传目录给 oxfmt 会把它认识的语言（含 md / json / css）一并扫到，
  // 本格的面仍是 ts/tsx/js/jsx/mdx 减白名单 —— 用 isScanned 收口。
  if (!isScanned(rel)) {
    return;
  }
  found.add(rel);
}

/**
 * 全库档：逐扫描根跑（`SCAN_ROOTS`）。判据不变 —— 「未过 oxfmt 的文件一个都不许有」。
 */
function collectUnformatted(entry) {
  const found = new Set();
  for (const root of SCAN_ROOTS) {
    /* 不存在的根直接跳过：oxfmt 对「一个目标文件都没有」的根会报
     * `Expected at least one target file...` 并以退出 2 收场 —— 那不是「有差异」
     * 也不是「没跑成」，而是「这一根没有账可算」（判据自测的临时仓库就没有
     * `.storybook`，实测把整条门打成了 fail-closed 的 exit 2）。真实仓两个根都在，
     * 这条跳过不改真实仓的判决面。 */
    if (!fs.existsSync(path.join(ROOT, root))) {
      continue;
    }
    for (const f of oxfmtCheckTargets(entry, [root], `扫描根 ${root}`)) {
      keepScanned(f, found);
    }
  }
  return [...found].sort();
}

/**
 * 点名档：对**给定的一批文件**分批跑（`--changed` 与 `--staged` 共用）。
 *
 * 为什么要分批：改动面可以很大（实测一次注释批注 PR 带 717 份），Windows 的
 * 命令行长度上限约 32K 字符，整批塞一条命令会在半路被截 —— 200 份一批
 * （约 10K 字符）给足余量。fail-closed 规则**逐批**生效：任何一批被信号杀 /
 * 退出码越界 / 退出 1 却不交清单，整条门当场 exit 2，不许把「后半批没跑」
 * 读成「全干净」。
 */
function collectUnformattedFiles(entry, files) {
  const found = new Set();
  const CHUNK = 200;
  for (let i = 0; i < files.length; i += CHUNK) {
    const batch = files.slice(i, i + CHUNK);
    const subject = `点名 ${batch.length} 份（第 ${Math.floor(i / CHUNK) + 1} 批）`;
    for (const f of oxfmtCheckTargets(entry, batch, subject)) {
      /* 点名档的面 = `GLOBS` 减**空**（不过 `IGNORE_GLOBS`，ISSUE #2979）：
       * `IGNORE_GLOBS` 是**全量档的存量豁免**（#2710 的迁移账），不是「这类文件
       * 永远不许查」。这里若复用 `keepScanned()`，`scripts/**` / `tests/**` 的命中会被
       * 静默滤掉，整张清单悄悄变成「命中 0 个」—— 正是 #2979 要治的那一格
       * （单元用例 `tests/check-format.test.ts` 的「暂存 scripts/*.cjs」钉着）。 */
      const rel = toPosix(path.relative(ROOT, path.resolve(ROOT, f)));
      if (isChangedFaceFile(rel)) {
        found.add(rel);
      }
    }
  }
  return [...found].sort();
}

/** 入口解析失败的统一出口（原文一字不改：有测试钉着「找不到 oxfmt 入口」这句）。 */
function entryMissing() {
  /* 「取不到格式化器(oxfmt)」与「全库都格式化好了」是两种结论，必须走不同的门。
   * 旧代码在这一档会一路走到 `[format] OK`（空清单 = 0 个未过），
   * 也就是门禁在依赖缺失 / 形态选错的机器上**静默放行**（台账 E11）。 */
  console.error(
    "[format] 找不到 oxfmt 入口：本地 node_modules 里没有它，" +
      "`COMFYAPP_OXFMT_ENTRY` 也没给。\n" +
      "[format]   以 exit 2 结束 —— 判据没跑成不许读成「全库干净」。",
  );
  process.exit(2);
}

/** 三档共用的判决出口（红 ⇒ 退 1 并给修复出路；绿 ⇒ gatePass）。 */
function judge(current, scope) {
  if (current.length) {
    gateFail("oxfmt 格式", current, {
      detail: `${current.length} 个文件未过（${scope}）`,
      hint:
        "本判据是硬闸（无基线、无 --update）:存量已清零,新增即阻断（规范 §13.5）。\n" +
        "修复:pnpm exec oxfmt <上面列出的文件>（只格式化你改过的,别全库跑）。",
    });
    process.exit(1);
  }
  gatePass("oxfmt 格式", `扫描完成：命中 0 个（${scope}）`);
}

function main() {
  /* 两档收窄（`--staged` / `--changed`）的短路点都在**入口解析之前**：「这次根本
   * 没带来靶子内的文件」与「oxfmt 装没装」无关，不该被后者带崩（否则把依赖问题
   * 伪装成这一步的形态）。`--report` 与默认全库档照旧先解析入口。 */
  if (STAGED && !REPORT_ONLY) {
    const files = stagedFiles();
    if (files === null) {
      console.error(
        "[format] --staged 模式读不到暂存清单（git diff --cached 失败）—— 按 fail-closed\n" +
          "[format]   判定为「判据没跑成」，以 exit 2 结束（不冒充「未触及扫描面」）。",
      );
      process.exit(2);
    }
    /* 合并态下的暂存面**不是**「本次改动」（ISSUE #2747）：`git merge` 解完冲突、
     * 提交还没落地时，`git diff --cached` 是**相对第一父提交（合并前的自己）**的全量
     * 差异 —— 也就是整份主干的改动面（现场：901 份）。于是主干上任何存量未格式化文件
     * 都会被点名为「本次带来的」而阻断一次与本 PR 无关的解冲突（被点名的两份相对
     * `origin/master` 是**零 diff**）。同一判据的 `--changed` 档对此给出相反结论
     * （「0 个在靶子内」）—— 两个入口不可能都对，错的是这一头的输入面。
     *
     * 收窄到「本条分支相对目标分支带来的那一份」，与 `--changed` **同一个口径**
     * （`changedFaceOrExit()`，基线只有一份）。收窄后的面仍然**逐份判**：这不是降档，
     * 而是把面修回它自称的那个东西（「本次提交带进来的改动」）。剔掉多少必须念出来。 */
    let face = files;
    if (mergeInProgress()) {
      const changed = changedFaceOrExit();
      const mine = new Set(changed.files);
      face = files.filter((f) => mine.has(f));
      console.log(
        `[format] 合并态（MERGE_HEAD 在场）：暂存面 ${files.length} 份 → 收窄到本分支带来的` +
          ` ${face.length} 份（基线：${changed.via}）。被剔掉的 ${files.length - face.length} 份` +
          "是主干那边的改动，不随本次提交走 —— 判据没降，只是不再让主干存量替这次解冲突背书" +
          "（ISSUE #2747）。",
      );
    }
    const hits = face.filter(isChangedFaceFile);
    if (!hits.length) {
      console.log(
        `[format] ✓ 本次提交未触及扫描面（${face.length} 个暂存文件中 0 个在 oxfmt 靶子内），跳过。`,
      );
      process.exit(0);
    }
    /* ISSUE #3259：oxfmt 读的是这些路径在**工作区**的内容，不是 index blob。两者还
     * 不一致时，这一格没有资格替「要提交的字节」给结论 —— 不给绿、也不给红，
     * 按 §13.6.3 以 exit 2 收口并点名，让人先把两边对齐再提交。 */
    const overlap = unstagedOverlap(hits);
    if (overlap === null) {
      console.error(
        "[format] --staged 读不出「暂存区 ⇄ 工作区」的差异（git diff 失败）—— 按 fail-closed\n" +
          "[format]   判定为「判据没跑成」，以 exit 2 结束（不冒充「这一批都干净」）。",
      );
      process.exit(2);
    }
    if (overlap.length) {
      console.error(
        `[format] --staged 判不了：本次暂存面有 ${overlap.length} 份文件的「暂存内容」与「工作区内容」不一致` +
          " —— oxfmt 按路径读工作区，判绿推不出提交进去的字节干净。",
      );
      for (const line of indentItems(overlap)) {
        console.error(line);
      }
      console.error(
        "[format]   这一格不给结论（§13.6.3）：既不判绿，也不判红。先把两边对齐再提交：\n" +
          "[format]   重新 `git add <上面点名的文件>`，或把还没暂存的改动先 `git stash` 起来。",
      );
      process.exit(2);
    }
    /* 命中后判**暂存的那一批**，不再回落全库：printWidth 迁移期间全库档对
     * 未迁移的存量恒红（见文件头），而提交这一刻要判的是「这一批带进来干不干净」
     * —— 那批没被暂存的存量文件并不随本次提交走，不该由它背书。 */
    const entry = resolveOxfmtEntry();
    if (!entry) {
      entryMissing();
    }
    judge(collectUnformattedFiles(entry, hits), "暂存面");
    return;
  }

  if (CHANGED && !REPORT_ONLY) {
    /* 改动面走共通壳（`changedFaceOrExit()`：基线选取 / 三点 diff / quotePath /
     * 改名两侧都收都在 `changed-scope.mjs` 那一份里，这里不抄第二份，§12.18）。 */
    const changed = changedFaceOrExit();
    const hits = changed.files.filter(isChangedFaceFile);
    if (!hits.length) {
      console.log(
        `[format] ✓ 本次改动未触及扫描面（${changed.files.length} 个改动文件中 0 个在 oxfmt 靶子内，基线：${changed.via}），跳过。`,
      );
      process.exit(0);
    }
    const entry = resolveOxfmtEntry();
    if (!entry) {
      entryMissing();
    }
    /* 只看**已提交**的改动（`git diff <基线>...HEAD` 的定义边界）：没提交的新文件
     * 不在面里，它们由 pre-commit 的 `--staged` 档在提交那一刻判 —— 两档合起来
     * 才是完整的一条链，单独哪一档都不许被读成「全量」。 */
    judge(collectUnformattedFiles(entry, hits), "改动面");
    return;
  }

  const entry = resolveOxfmtEntry();
  if (!entry) {
    entryMissing();
  }
  console.log("[format] 运行 oxfmt --check（无缓存档，全量约 2s）…");
  const current = collectUnformatted(entry);

  if (REPORT_ONLY) {
    gatePass("oxfmt 格式", `未过 oxfmt ${current.length} 个文件（只出清单）`);
    for (const line of indentItems(current)) {
      console.log(line);
    }
    process.exit(0);
  }

  judge(current, "全库");
}

if (require.main === module) {
  main();
}

/** 供测试引用:判据实现共用一份(§12.18),不跑 oxfmt 的纯判定入口
 *  (main 守卫在,require 本文件不会触发扫描)。三个消费方都在 tests/ 下：
 *  `check-format.test.ts`（判据本体）、`ci-incremental-gates.test.ts`（收窄面 ⇄ 登记表）、
 *  `coverage-targets-exist.test.ts`（借 `globToRegExp` 同一把尺子）。
 *  这里曾另有一个消费方 —— 会「就地改文件」的那个外壳，已随 ISSUE #2610 删除。 */
module.exports = {
  globToRegExp,
  isIgnored,
  isChangedFaceFile,
  isScanned,
  collectUnformatted,
  resolveOxfmtEntry,
  IGNORE_GLOBS,
  GLOBS,
};
