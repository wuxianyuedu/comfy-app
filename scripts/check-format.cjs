#!/usr/bin/env node
// @ts-nocheck -- oxfmt 格式判据(判定型;执行者 = .githooks/pre-commit 的 D0(带 --staged) 与平台侧 .cnb.yml 的「oxfmt 格式」(全量),第三个出口 pnpm check:all)
/**
 * prettier 格式判据（**硬闸**）—— 规范见 docs/standards/13-提交与-code-review.md §13.5.1。
 *
 * ── 它在哪跑：本地 D0 判 + 平台侧判（ISSUE #2610，2026-10-29；中间那段历史见下）─────
 *
 * 现在有两个执行者，跑的是同一份实现、只差一个旗标：
 *   · `.githooks/pre-commit` 的 **D0** 带 `--staged`（「没碰到扫描面」就跳过并明说跳过，
 *     红了当场 `pnpm exec oxfmt <点名的文件>`，只点本次改的 —— 不必等一次 CI 往返）；
 *   · `.cnb.yml` 的「oxfmt 格式」跑**全量档**（不带 `--staged`：那边的工作区就是这次要判
 *     的那份源码，带上会读到空的暂存区 ⇒ 恒跳过、挂了等于没挂）。
 * 第三个出口是 `pnpm check:all`（`scripts/quality-gate.mjs` 的 `format` 项）。
 * 三处都由 `tests/doc-check-hook-wiring.test.ts` 钉（钩子里有 + 平台侧有 + 都指这一份脚本）。
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
 * 判据:**未过 prettier 的文件一个都不许有**(ISSUE #1811 收尾时从棘轮翻成硬闸)。
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
 * (Rust 壳),由**嵌套的** `src-tauri/.gitignore` 忽略。prettier 只按 cwd(仓库根)
 * 读 `.gitignore`,嵌套的忽略文件它看不到 —— 于是构建过一次的检出会把 target 下的
 * 生成脚本(out/__global-api-script.js)判成「新增未过格式的文件」,阻断每一次提交
 * (ISSUE #638 修好 pnpm 启动形态后本门禁才第一次真正扫到全库,这条才暴露;CI 的
 * 干净检出没有 target 目录,所以只有开发机踩得到)。产物既不该被格式化 ——
 * 下一次构建会覆盖它,也不该进棘轮计数。
 *
 * 为什么逐个 glob 调 prettier 而不是一次性:需要把 glob 交给 shell 展开或引号
 * 透传,而 Windows 上 cmd/pwsh 的展开语义与 POSIX 不同;逐个 glob 调用对平台
 * 无感,且 prettier 的 `--cache` 让重复调用几乎零成本。
 *
 * 用法:
 *   node scripts/check-format.cjs             # 检查(硬闸:命中即退 1) —— 平台侧用的就是这一档
 *   node scripts/check-format.cjs --report    # 只出清单不判失败(盘点用)
 *   node scripts/check-format.cjs --staged    # 仅当暂存改动落在扫描面内才扫(人的动作:提交前自查)
 *
 * ── `--staged`：全库扫描的「白付」与它的输入面 ────────────────────────────────
 *
 * 全库扫描实测 **17.6s**(热缓存,本机 8 核) —— 它在钩子的 D 组里曾是**单项最贵**的
 * 一步(这个读数正是 ISSUE #2010 里"挪到 CI"那笔账的一半)。
 *
 * 而它的扫描面其实**远小于全库**,且这两件事都不是这里手写的取舍、是既有配置
 * 算出来的(实测:`git ls-files` 跟踪 5940 份,落在扫描面内的只有 **1596** 份):
 *   · `GLOBS` 只收 `.ts/.tsx/.js/.jsx/.mdx` —— 连 `.md` 都不在其内,所以
 *     `docs/**` `changelog.d/**` `README.md` **本来就一份都不扫**;
 *   · `IGNORE_GLOBS` 又把 `scripts/` `tests/` `tools/` `e2e/` `public/`
 *     `docs/api/**` `docs/generated/**` `src-tauri/target/**` 与根级 `*.js` /
 *     `*.config.*` 整类剔掉;
 *   · 剩下的是 **`src/**`(1586 份)+ `.storybook/**`(10 份)**。
 *
 * 于是「只加了 changelog 碎片 / 只改文档 / 只动 `scripts/` / 只碰 `tests/`」
 * 这一大类提交,在这一步上**白付**:那些文件根本不在 prettier 的靶子里,扫多少遍
 * 结论都一样(这一层收窄是 ISSUE #1747 加的,手法与 `check-docs-api.cjs --staged`
 * 逐字同源)。**而它省不掉的另一半正是这次挪执行者的理由**:`src/**` 是最常见的提交类别,
 * 命中即扫全库 —— `--staged` 只买到了「不命中时 ~30ms」那半。
 * 所以这一档现在归平台侧(不带 `--staged`),`--staged` 留给人的提交前自查。
 *
 * 判据面由 **`IGNORE_GLOBS` 自己现算**(`GLOBS` 展成的候选文件逐个过
 * `isIgnored`),**不另抄第二份「哪些目录算输入面」的清单** —— 抄一份就会与
 * `IGNORE_GLOBS` 漂移(§12.12 / §12.18 的口径),而漂移的形态是静默的:白名单
 * 多收一个目录,这里就永远不触发、那类文件的格式从此没人查。
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

/* prettier 的调用**不再经 pnpm 层**（口径同台账 E10：平台 shim 那一层正是
 * 「命令没跑成却被读成没问题」的藏身处）。三级解析：
 *   1. `COMFYAPP_PRETTIER_ENTRY` —— 门禁自己的用例在临时目录里搭沙箱，那里没有
 *      `node_modules`，不给这条接缝就只能撞「Command "prettier" not found」；
 *   2. 本地安装的 `prettier/bin/prettier.cjs`（按扫描根解析，与真实门禁一致）；
 *   3. 两者都没有 → exit 2 并说明「没跑成」。
 * **任何一档都不许回落成「0 个文件未过」** —— 那正是本脚本过去的 fail-open 形态。
 *
 * 取 ESM 判据模块（`launcher-core/shell.mjs`）的那段动态 import 随之删除：
 * 本脚本不再需要 pnpm 形态判定，`main()` 保持 async 只为收尾顺序不变。 */

/** oxfmt 入口的三级解析（见上）。取不到返回 null，由 `main()` 以 exit 2 收尾。 */
function resolveOxfmtEntry() {
  const fromEnv = process.env.COMFYAPP_OXFMT_ENTRY;
  if (fromEnv) return fs.existsSync(fromEnv) ? fromEnv : null;
  try {
    // 按扫描根解析：门禁在仓库根被调用，本地 `node_modules/oxfmt` 就是它的依赖。
    // 取 `oxfmt/package.json` 而不是直接 resolve `oxfmt/bin/oxfmt`：后者可能被包的
    // `exports` 字段挡住（子路径不导出），前者是常见可解析面；两者都失败时退回按
    // 扫描根拼路径（与 prettier 时代「任何一档都不许回落成 0 个未过」同口径）。
    const pkg = createRequire(path.join(ROOT, "noop.js")).resolve(
      "oxfmt/package.json",
    );
    return path.join(path.dirname(pkg), "bin", "oxfmt");
  } catch {
    const fallback = path.join(ROOT, "node_modules", "oxfmt", "bin", "oxfmt");
    return fs.existsSync(fallback) ? fallback : null;
  }
}

/* 扫描根取 cwd:门禁在仓库根被调用,而 prettier / git 都按 cwd 解析仓库
 * (与 check-circular-deps.cjs 同口径)。基线取 __dirname 旁,与脚本同目录。 */
const ROOT = process.cwd();
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const STAGED = ARGS.has("--staged");

/** 扫描范围与 package.json 的 format:check 逐字一致。 */
const GLOBS = ["**/*.{ts,tsx,js,jsx,mdx}"];

/** oxfmt 的扫描根：`GLOBS` 减白名单后收口出的面就是 `src/**` + `.storybook/**`
 * （根上的 `*.config.*` / `scripts/**` / `tests/**` 等都在 IGNORE_GLOBS 里）。
 * 传目录而非 glob：oxfmt 认 glob，但 glob 形态会把白名单里的目录也带进来，
 * 交给下面的 `isScanned()` 收口更直白（同一份真源，不另抄一份名单）。 */
const SCAN_ROOTS = ["src", ".storybook"];

/** 白名单(glob,相对仓库根):① 高频 churn 路径;② 非源码产物(构建输出)。见文件头注释。 */
const IGNORE_GLOBS = [
  "scripts/**",
  "tests/**",
  "tools/**",
  "e2e/**",
  "public/**",
  "docs/api/**",
  "docs/generated/**",
  /* ② 非源码产物:Rust 壳的构建输出(被嵌套的 src-tauri/.gitignore 忽略)。 */
  "src-tauri/target/**",
  "*.config.{js,ts,mjs,cjs}",
  "*.js",
];

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
      if (close < 0) {
        out += "\\{";
        continue;
      }
      out +=
        "(?:" +
        glob
          .slice(i + 1, close)
          .split(",")
          .map(escapeRe)
          .join("|") +
        ")";
      i = close;
    } else if (c === "/") {
      out += "/";
    } else {
      out += escapeRe(c);
    }
  }
  return new RegExp(out + "$");
}

const IGNORE_RES = IGNORE_GLOBS.map(globToRegExp);
const GLOB_RES = GLOBS.map(globToRegExp);

function isIgnored(rel) {
  return IGNORE_RES.some((re) => re.test(rel));
}

/**
 * 扫描面的**正形态**:先由 `GLOBS` 认出「prettier 会看的文件」,再剔掉
 * `IGNORE_GLOBS`。两者是同一份白名单的两个方向,所以这里不重复任何目录名。
 * @param {string} rel 仓库根相对 POSIX 路径
 */
function isScanned(rel) {
  return GLOB_RES.some((re) => re.test(rel)) && !isIgnored(rel);
}

/** 暂存改动清单(仓库根相对 POSIX 路径)。git 拿不到时返回 null —— 由调用方 fail-closed。 */
function stagedFiles() {
  /* `-c core.quotePath=false`:路径要原样(ISSUE #2272,机制见 scripts/changed-scope.mjs 的
   * 文件头「口径 ④」)。git 默认把含非 ASCII 字符的路径转义加引号,而本仓有 38 份文件名
   * 带非 ASCII 的文件(全在 docs/ 下)⇒ 转义过的路径认不出来,那些文件会**不进 prettier**。 */
  const res = spawnSync(
    "git",
    ["-c", "core.quotePath=false", "diff", "--cached", "--name-only"],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  if (res.status !== 0) return null;
  return (res.stdout || "").split(/\r?\n/).filter(Boolean).map(toPosix);
}

/**
 * 找出未过 prettier 的文件(仓库根相对 POSIX 路径,已排序,已剔除白名单)。
 *
 * 三条**fail-closed** 规则（本函数过去只有前两条的一半，因而存在一条
 * 「命令没跑成 → 报全库干净」的出路，见台账 E11）：
 *   · 子进程被信号杀掉（`status === null`，含超时被杀）→ exit 2；
 *   · 退出码不属于 {0, 1} → exit 2（配置写错 / 解析失败，prettier 会走这一档）；
 *   · **退出 1 却一行文件都没列出来** → exit 2。
 * 第三条是关键：`--list-different` 返回 1 的含义是「有差异，清单在 stdout」，
 * 而清单为空与「命令根本没跑成」（例如 `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL
 * Command "prettier" not found`，退出码同样是 1 且 stdout 为空）在旧代码里
 * 长得一模一样 —— 于是门禁把「什么都没扫」读成「0 个文件未过（基线 0 个）/ OK」。
 */
function collectUnformatted(entry) {
  const found = new Set();
  for (const root of SCAN_ROOTS) {
    /* 不存在的根直接跳过：oxfmt 对「一个目标文件都没有」的根会报
     * `Expected at least one target file...` 并以退出 2 收场 —— 那不是「有差异」
     * 也不是「没跑成」，而是「这一根没有账可算」（判据自测的临时仓库就没有
     * `.storybook`，实测把整条门打成了 fail-closed 的 exit 2）。真实仓两个根都在，
     * 这条跳过不改真实仓的判决面。 */
    if (!fs.existsSync(path.join(ROOT, root))) continue;
    /* oxfmt 只列**有差异**的文件（形如 `src/foo.ts (12ms)`），随后给一行
     * `Format issues found in above N files.`；退出码 1 = 有差异、0 = 全干净。
     * 没有 `--cache` 这一档：oxfmt 在本仓实测 1.9s（prettier 全热 234s），
     * 为它再养一套缓存键不划算 —— 何况 prettier 那条缓存键本就因绝对路径恒 miss。 */
    const args = ["--check", root];
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
          `[format]   入口 ${entry}，扫描根 ${root}。`,
      );
      process.exit(2);
    }
    /* 排查逃生口（默认关）：`COMFYAPP_FORMAT_DEBUG=1` 时把 oxfmt 的原始读数
     * 原样吐出来 —— 判据自测在「本地绿、CI 红」的形态下，没有这批读数就只能猜
     * （脏文件被判干净时，到底是没扫到还是没认出来，两种修法完全不同）。
     * 走 **stdout** 而不是 stderr：夹具把成功那档的 `output` 折成纯 stdout，
     * 打 stderr 这批读数在「判据成功退出」的用例里永远看不见。 */
    if (process.env.COMFYAPP_FORMAT_DEBUG) {
      const ver = spawnSync(process.execPath, [entry, "--version"], {
        encoding: "utf8",
      });
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
      .replace(/\u001b\[[0-9;]*m/g, "")
      .split("\n")
      .map((line) => line.trim())
      // 有差异行形如 `src/foo.ts (12ms)`；其余是 `Checking formatting...` /
      // `Format issues found in above N files.` / `Finished in ...` 这类摘要行，
      // 认不出的行一律丢掉（宁可漏报也不许把摘要行当成文件名）。
      .map(
        (line) => line.match(/^(.+?)\s+\(\d+(?:\.\d+)?(?:ms|s)\)$/)?.[1] ?? null,
      )
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
      if (res.stderr)
        console.error(`[format]   stderr: ${String(res.stderr).trim()}`);
      process.exit(2);
    }
    for (const f of lines) {
      const rel = toPosix(path.relative(ROOT, path.resolve(ROOT, f)));
      // 传目录给 oxfmt 会把它认识的语言（含 md / json / css）一并扫到，
      // 本格的面仍是 ts/tsx/js/jsx/mdx 减白名单 —— 用 isScanned 收口。
      if (!isScanned(rel)) continue;
      found.add(rel);
    }
  }
  return [...found].sort();
}

async function main() {
  /* `--staged` 的短路点在**所有**工作之前：未命中扫描面时连 prettier 入口都不解析
   * —— 那条解析在依赖缺失时会 exit 2，而「本次提交没碰扫描面」与「prettier 装没装」
   * 无关，不该被后者带崩（否则把依赖问题伪装成这一步的形态）。
   * 只作用于 check 档：`--report` 照旧全库（见文件头）。 */
  if (STAGED && !REPORT_ONLY) {
    const files = stagedFiles();
    if (files === null) {
      console.error(
        "[format] --staged 模式读不到暂存清单（git diff --cached 失败）—— 按 fail-closed\n" +
          "[format]   判定为「判据没跑成」，以 exit 2 结束（不冒充「未触及扫描面」）。",
      );
      process.exit(2);
    }
    const hits = files.filter(isScanned);
    if (!hits.length) {
      console.log(
        `[format] ✓ 本次提交未触及扫描面（${files.length} 个暂存文件中 0 个在 prettier 靶子内），跳过。`,
      );
      process.exit(0);
    }
  }

  const entry = resolveOxfmtEntry();
  if (!entry) {
    /* 「取不到 prettier」与「全库都格式化好了」是两种结论，必须走不同的门。
     * 旧代码在这一档会一路走到 `[format] OK`（空清单 = 0 个未过），
     * 也就是门禁在依赖缺失 / 形态选错的机器上**静默放行**（台账 E11）。 */
    console.error(
      "[format] 找不到 oxfmt 入口：本地 node_modules 里没有它，" +
        "`COMFYAPP_OXFMT_ENTRY` 也没给。\n" +
        "[format]   以 exit 2 结束 —— 判据没跑成不许读成「全库干净」。",
    );
    process.exit(2);
  }
  console.log("[format] 运行 oxfmt --check（无缓存档，全量约 2s）…");
  const current = collectUnformatted(entry);

  if (REPORT_ONLY) {
    gatePass(
      "oxfmt 格式",
      `未过 oxfmt ${current.length} 个文件（只出清单）`,
    );
    for (const line of indentItems(current)) console.log(line);
    process.exit(0);
  }

  if (current.length) {
    gateFail("oxfmt 格式", current, {
      detail: `${current.length} 个文件未过`,
      hint:
        "本判据是硬闸（无基线、无 --update）:存量已清零,新增即阻断（规范 §13.5）。\n" +
        "修复:pnpm exec oxfmt <上面列出的文件>（只格式化你改过的,别全库跑）。",
    });
    process.exit(1);
  }

  gatePass("oxfmt 格式", `扫描完成：命中 0 个`);
}

if (require.main === module) main();

/** 供测试引用:判据实现共用一份(§12.18),不跑 oxfmt 的纯判定入口
 *  (main 守卫在,require 本文件不会触发扫描)。三个消费方都在 tests/ 下：
 *  `check-format.test.ts`（判据本体）、`ci-incremental-gates.test.ts`（收窄面 ⇄ 登记表）、
 *  `coverage-targets-exist.test.ts`（借 `globToRegExp` 同一把尺子）。
 *  这里曾另有一个消费方 —— 会「就地改文件」的那个外壳，已随 ISSUE #2610 删除。 */
module.exports = {
  globToRegExp,
  isIgnored,
  isScanned,
  collectUnformatted,
  resolveOxfmtEntry,
  IGNORE_GLOBS,
  GLOBS,
};
