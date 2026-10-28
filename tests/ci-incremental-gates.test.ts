/**
 * 平台侧门禁的**增量收窄**：`.cnb.yml` 的 `ifModify` ⇄ 登记表双向同源。
 *
 * ── 这条判据守的是什么（ISSUE #1981）─────────────────────────────────────
 *
 * 背景是用户的一句质疑：「CI 里的检查能否增量，而不是没有改动也重跑」。
 * 本地钩子早就有这一层（`scripts/gate-scan-read.cjs` 的
 * `skipUnlessStagedTouches()`：暂存改动一点都没落在扫描面里就跳过），
 * 而平台侧那条流水线不知道「扫描面」这回事 —— 改一行 README 也要把
 * 「函数长度」「跨文件重复块」「ComfyUI 端口口径」这些**只扫 `src/**`** 的判据
 * 重跑一遍。`.cnb.yml` 的 stage 支持 `ifModify: [glob…]`，语义与它逐字同义。
 *
 * ── 这条判据判的**不是**「哪几条该收窄」（那是收益判断，要实测），而是
 * **「收窄名单只有一处出处」**：
 *
 *   ① 登记表里每条 ⇒ 配置里同名 stage 必须带着那组逐字相同的 `ifModify`
 *      （写漏 / 写错一个 glob 都红）；
 *   ② 配置里带 `ifModify` 的 stage ⇒ 必须在登记表里（绕过登记表直接收窄也红）。
 *
 * 少了任一半都会退化成「**看着在收窄、其实收窄了什么没人知道**」：
 * 只有①时，有人可以直接在 YAML 里给一个全仓级判据（如 `文件结构硬规则`）挂上
 * `ifModify`，判据强度当场被削而没有任何信号；只有②时，登记表会慢慢变成一份
 * 与配置无关的文档。
 *
 * ── 为什么它进固定清单（`scripts/fixed-structural-tests.mjs`）──────────────
 *
 * 它守的是「**哪些 stage 被允许跳过**」这件事本身 —— 一次误收窄（给一条全仓级
 * 判据挂上窄 glob）不会让任何别的判据变红，只会让下一次真回归**静默漏过**。
 * 而触发它的改动面恰好是 `.cnb.yml`：只改它在静态 import 图里追不到任何用例，
 * 于是「只在受影响时才跑」等于让它随下一次配置改动过去。
 *
 * 口径与边界见规范 §13.5.18。
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  COMPOUND_EXECUTORS,
  INCREMENTAL_GATES,
  INCREMENTAL_GATE_NAMES,
  checkIncrementalGates,
  parseStageIfModify,
  readCnbConfig,
} from "../scripts/ci-incremental-gates.mjs";
import { HEAVY_GATES } from "../scripts/ci-heavy-gates.mjs";
import { parseStageScripts } from "../scripts/ci-autofix-duties.mjs";
import {
  INPUT_GLOBS,
  INPUT_RES,
  matchedInputs,
} from "../scripts/check-docs-api.cjs";
import { filesUnder } from "../scripts/docs-api-input-closure.mjs";
import { SCAN_ROOTS, TRIGGER_GLOBS } from "../scripts/file-structure-rules.cjs";
import { globToRe } from "../scripts/vitest-projects.cjs";
import { stageBlock } from "./no-platform-ci-config.test";

const CONFIG = readCnbConfig();

/**
 * 一个路径是否被某条 glob 罩住。
 *
 * glob → 正则**复用** `scripts/vitest-projects.cjs` 已导出的那一份（同一套 `**` / `*` /
 * `{a,b}` 口径，且带锚点）—— 不在本文件写第二套 glob 匹配（§12.12 / §12.18）。
 *
 * @param rel 仓库相对路径
 * @param globs glob 清单
 * @returns 是否被某一条罩住
 */
function coveredBy(rel: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRe(g).test(rel));
}

/**
 * 一条输入面正则的「字面前缀」= 第一个通配符之前的那段（正则锚定到仓库根）。
 *
 * `/^src\/lib\/.*\.ts$/` → `src/lib`；`/^typedoc\.json$/` → `typedoc.json`
 * （整条都是字面量 ⇒ 前缀就是那个文件本身）。
 *
 * @param re 输入面正则
 * @returns 目录前缀 / 字面文件路径；通配出现在第一段里时返回 `null`（没法枚举）
 */
function literalPrefixOf(re: RegExp): string | null {
  const src = re.source.replace(/^\^/, "").replace(/\$$/, "");
  let out = "";
  let sawWildcard = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src.charAt(i);
    /* 转义符把下一个字符当**字面量**（`\/` 是斜杠、`\.` 是点），不是通配。 */
    if (ch === "\\") {
      const next = src[i + 1];
      if (next === undefined) break;
      out += next;
      i += 1;
      continue;
    }
    if (".*+?()[]{}|^$".includes(ch)) {
      sawWildcard = true;
      break;
    }
    out += ch;
  }
  if (!sawWildcard) return out;
  const cut = out.lastIndexOf("/");
  return cut < 0 ? null : out.slice(0, cut);
}

/**
 * 目录枚举的缓存 —— 同一次运行里同一个前缀只列一次（三根加起来 600 多个文件，
 * 而这条用例是**每次提交都跑**的固定清单成员）。
 */
const filesUnderCache = new Map<string, string[]>();

/**
 * 一条输入面正则命中的、**盘上真实存在**的文件清单。
 *
 * 字面前缀是文件 ⇒ 就是它；是目录 ⇒ 把那个目录下的候选文件列出来逐个过正则
 * （目录遍历复用 `scripts/docs-api-input-closure.mjs` 已导出的 `filesUnder`，
 * 不在本文件抄第二份遍历）。
 *
 * @param re 输入面正则
 * @returns 仓库相对路径清单
 */
function filesMatchedBy(re: RegExp): string[] {
  const prefix = literalPrefixOf(re);
  if (prefix === null || prefix === "") return [];
  const abs = path.join(process.cwd(), prefix);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return re.test(prefix) ? [prefix] : [];
  let listed = filesUnderCache.get(prefix);
  if (listed === undefined) {
    listed = filesUnder(prefix);
    filesUnderCache.set(prefix, listed);
  }
  return listed.filter((f) => re.test(f));
}

describe("平台侧门禁的增量收窄（.cnb.yml ifModify ⇄ 登记表）", () => {
  it("真仓一致：登记表与 .cnb.yml 逐字同源", () => {
    const problems = checkIncrementalGates(CONFIG);
    expect(
      problems,
      `平台侧增量登记与配置不一致：\n${problems.join("\n")}`,
    ).toEqual([]);
  });

  it("登记表非空（清单被掏空时这条会红，而不是让上面那条恒绿）", () => {
    /* 反向验证：没有这一条，把 INCREMENTAL_GATES 清空会让上面那条变成恒真 ——
     * 「判据不是空转」的同一形态（见 tests/no-platform-ci-config.test.ts 的头注）。 */
    expect(INCREMENTAL_GATES.length).toBeGreaterThan(0);
    for (const gate of INCREMENTAL_GATES) {
      expect(gate.globs.length, `${gate.name} 的 globs 是空的`).toBeGreaterThan(
        0,
      );
      expect(gate.script, `${gate.name} 没写它守的是哪份脚本`).toMatch(
        /^scripts\/.+\.(cjs|mjs)$/,
      );
      expect(
        gate.why.length,
        `${gate.name} 没写「为什么这条收窄安全」`,
      ).toBeGreaterThan(20);
    }
  });

  it("解析出的 stage 数 == 配置里 `ifModify:` 出现次数（解析器不空转、也不误吞）", () => {
    /* 这一条抓的是**解析器失灵**：`.cnb.yml` 换了缩进 / 换了 `ifModify` 的写法
     * （单行标量 ↔ 列表）时，`parseStageIfModify` 可能静默漏掉几条，而上面那条
     * 会以「配置里没有它」的名义报红 —— 那是个**误导人的红**（人以为要补配置，
     * 其实要修解析器）。用「配置里 `ifModify:` 这个 token 出现了几次」做独立复算。 */
    const occurrences = (CONFIG.match(/^ {4}ifModify:/gm) ?? []).length;
    expect(
      parseStageIfModify(CONFIG).size,
      `配置里有 ${occurrences} 处 4 空格缩进的 \`ifModify:\`，解析出 ${parseStageIfModify(CONFIG).size} 个 stage`,
    ).toBe(occurrences);
  });

  it("收窄判据只收「扫描面封闭」的那一类：全仓级 stage 一条都不许带 ifModify", () => {
    /* 这一组名字是**刻意点名**的：它们判的是全库级不变量或本次流水线的前提，
     * 任何一处改动都可能破坏它们 —— 收窄成任何子集都是漏判。
     * 加这一条是因为上面两条只能保证「登记表 ⇄ 配置」一致，而**登记表自己**
     * 可能被误扩（有人把 `文件结构硬规则` 写进表里，再在配置里补上 ifModify，
     * 前两条会一起放行）。 */
    const MUST_ALWAYS_RUN = [
      "工具链自证",
      /* 镜像是**前提类**的一条读数（ISSUE #1993）：它答「这台机长自哪一版」，
       * 而那个答案描述的是**本次流水线跑在哪台机上**，不是某几个文件的性质。
       * 收窄成任何 glob 都等于「只在这几类改动上才记录环境身份」—— 那正好丢掉
       * 它存在的理由（环境是隐形的，每一跑都该被看见）。 */
      "镜像身份",
      "Python 可用性",
      "环境前提",
      "Install dependencies",
      "分支守卫",
      "同步数据库表结构",
      "类型检查",
      /* ⚠️ `文件结构硬规则` **从这一列挪进登记表了**（ISSUE #2010）：用户点名的
       * 三格耗时项之一（实测 2~4s，看起来最便宜，但它是每次 PR 都跑的全库遍历）。
       * 它扫的是**盘上的某一组目录**（`src/` + `scripts/` + `tools/` + 仓库根的
       * 入口类文件），不是「跨全仓的单一事实源」那类不变量 —— 后者不可收窄的理由是
       * 「任何一处改动都可能破坏它」，而这里违规只可能出现在扫描面内的文件里。
       * 触发面由 `file-structure-rules.cjs` 的 `TRIGGER_GLOBS` 机械导出，
       * 所以「收窄了但扫描面变了」这种漂也会当场红（见文件头最后一条用例）。 */
      "UI/逻辑分离",
      "lib Node-only 声明",
      /* ⚠️ `格式化提交分离` **2026-10-17 从这一列挪出去了**（ISSUE #1993）：它判的是
       * 「这次提交里有多少个文件只是被 prettier 重排过」，判据本体是**逐文件跑一次
       * prettier** —— 而它的面是「源文件扩展名」，不是「全仓任何一处改动」。
       * 一份图 / 一个 YAML 的提交不可能是「格式化提交」（判据连文件都列不出来），
       * 所以它属于「扫描面封闭」那一档，已登记进 `INCREMENTAL_GATES`。
       * 这一格是**收窄口径本身的回归面**：谁再把它挪回这一列，反向那条会红。 */
      /* ⚠️ 文档面三条里**只剩一条**在这一列（ISSUE #1981）：
       *
       *   · `生成态文档与源同步` —— 两侧输入面都能点清（`SCOPED_DOCS` 全在 `docs/**`，
       *     `FACTS` 的提取源是 `src/**` 与三份配置），且它带 `--autofix`（§13.5.19）；
       *   · `API 文档生成与自检` —— 它**自己**就声明了触发面（`check-docs-api.cjs`
       *     的 `INPUT_RES`，文件头第 4 条：「触发面 = typedoc 的输入面」），所以那一档的
       *     globs 由那份常量机械反推，不是第二份会漂的副本。它是本档最贵的一格
       *     （实测 201.8s / 整条 12m14s 的 27.5%），而绝大多数 PR 一行
       *     `src/lib|server|trpc` 都没碰。
       *     ⚠️ 2026-10-23 起它的**产物面 `docs/api/**` 已从收窄面里去掉**（ISSUE #2231）：
       *     产物不再进 git ⇒ 既不在变更文件清单里、也不会被谁改坏。
       *   · `文档引用与权威源一致` —— 这一条判的是**全库**文档里的引用与权威源，
       *     域不是某几个目录，收窄成任何子集都是漏判。 */
      "文档引用与权威源一致",
      "core 骨架单一事实源",
      "零消费导出",
      "core 出口纪律与基类纯度",
      /* ⚠️ `生产构建` **2026-10-18 从 PR 那一条撤了**（挪进每日档，§13.5.23），而这个名字
       * 刻意留在这一列：`parseStageIfModify()` 判的是「配置里带 `ifModify` 的 stage」，
       * 所以这一列防的是**将来有人把它加回 PR 并顺手收窄** —— 那一跑它会红，而这是
       * 唯一还看得见那件事的地方。
       * ⚠️ **这一列今天真的也管得到每日那七格**：它们 2026-10-19 从「写在 crontab 流水线
       * 内部（8 空格）」搬到了顶层锚点 `.daily-gates`（两空格，两个触发口共用一份），
       * 于是 `parseStageIfModify()` 从此看得见它们 —— 顺带修掉一个一直没被注意的盲区：
       * 搬动之前那七格根本不在这一列的扫描面里，「有人给每日档挂 `ifModify`」这件事
       * 没有任何判据会响。每日清单的在场与入口仍由
       * `tests/no-platform-ci-config.test.ts` 双向钉。 */
      "生产构建",
      "浏览器安装",
      /* `E2E 关键流程` 与 `生产构建` 同批离开 PR（2026-10-19，撤档说明在 `.cnb.yml`），
       * 名字同样**留在这一列**：它防的还是「将来有人把它加回 PR 并顺手挂 `ifModify`」。
       * 而这一格比 `生产构建` 多一条前提 —— 它需要 `next build` 的产物，恢复它必须
       * **同批**把构建也放回 PR（`tests/no-platform-ci-config.test.ts` 那条判住）。 */
      "E2E 关键流程",
    ];
    const gated = parseStageIfModify(CONFIG);
    const wronglyGated = MUST_ALWAYS_RUN.filter((n) => gated.has(n));
    expect(
      wronglyGated,
      `这些 stage 被判为「任何改动都要跑」，不许挂 ifModify：${wronglyGated.join(", ")}`,
    ).toEqual([]);
    // 反过来：登记表里也不许出现它们（两个方向都堵住）。
    const inRegistry = MUST_ALWAYS_RUN.filter((n) =>
      INCREMENTAL_GATE_NAMES.has(n),
    );
    expect(
      inRegistry,
      `登记表里混进了全仓级 stage：${inRegistry.join(", ")}`,
    ).toEqual([]);
  });

  it("`API 文档生成与自检` 自己占一格、收窄挂在**那一格**上，且输入面只有一处出处", () => {
    /* 这一条的三段历史值得留着，因为**每一段都留一个形状**：
     *
     *   · 2026-10-19：那一档被收进聚合档 `重档静态判据`（平台单 stage 20m 硬上限，
     *     摊成十几个 stage 时每格都在各付一次 job 开销）⇒ `ifModify` 这一层不再存在
     *     （它按**整格**跳过，一格装多条时只能表达「一起不跑」）。
     *   · 2026-10-20：那一档在 `.cnb.yml` 里的**原文被注释掉**（理由是「收进聚合档」），
     *     而聚合档读的是**钩子注册表** —— 那一档 2026-10-16 就已从钩子里撤走 ⇒
     *     **两次搬动方向相反、在中间对穿** ⇒ 那一档从 2026-10-20 起一个执行者都没有
     *     （`docs/api/**` 随后在无人看管下漂了 32 份）。
     *   · 2026-10-22：它**恢复成自己的活 stage**，收窄挂在**那一格**上 ——
     *     平台的 `ifModify` 只能按格算，而复合执行者一条都不许挂（格内扫描面不同的
     *     判据一起静默放行，见 `scripts/ci-incremental-gates.mjs` 的 `COMPOUND_EXECUTORS`）。
     *   · 2026-10-23（ISSUE #2231）：它**改了名、也改了判据对象** —— 产物不再进 git ⇒
     *     不再判「与源同不同步」，改判「这一轮生成的产物可不可用」⇒ **不再带 `--autofix`**，
     *     而**产物面 `docs/api/**` 也从收窄面里去掉**（产物既不在变更文件清单里、也不会
     *     被谁改坏）。原来的名字「API 文档生成物与源同步」里的「与源同步」从这一版起
     *     **没有对象**了 ⇒ 名字改成「API 文档生成与自检」。
     *
     * 于是本条判的是三件事：① 那一格**真的活着**（配置里不是注释形态）；
     * ② 它的收窄**逐字**等于判据自己声明的输入面（不是第二份手抄）；
     * ③ 判定门**不带 `--autofix`**（没有「自动修完再提交」的对象了 —— 而
     * 「自动修 + 再判」正是让「产物陈旧」在 CI 上隐形的那一格，#2231 的现场）。 */
    const stageName = "API 文档生成与自检";
    const globs = parseStageIfModify(CONFIG).get(stageName);
    expect(
      globs,
      `配置里没有「${stageName}」这一格的 \`ifModify\` —— 它要么被注释掉了（= 没有执行者），` +
        "要么收窄被摘了（那一格会每次都付 201.8s）",
    ).toBeDefined();
    /* 收窄的形状 = 判据自己那份声明（`INPUT_GLOBS`，**上界**形态）。
     * 判据改了输入面而这里没跟，当场红 —— 这就是「机械导出」的那道对账。
     * ⚠️ **产物面 `docs/api/**` 不在里面**（ISSUE #2231）：产物不再进 git。 */
    expect(
      globs,
      "那一格的收窄与判据自己声明的输入面不一致 —— 改判据的触发面时必须同批改这里",
    ).toEqual([...INPUT_GLOBS]);
    /* 判定门逐字在那一格里：只写不判 = 恒绿；而**不许带 `--autofix`** ——
     * 产物不进 git ⇒ 没有「自动修完再提交」的对象，自动修登记表也不认它了。
     * ⚠️ 核的是**那一行的 `script:`**，不是整块 —— 整块里还有注释，而注释里出现
     * 旗标字面量**不**等于「这一格带着那个旗标」。解析口径复用
     * `scripts/ci-autofix-duties.mjs` 的 `parseStageScripts()`（自动修登记表核的也是那一行）。 */
    const block = stageBlock(CONFIG, stageName);
    expect(block, `配置里解析不出「${stageName}」这一格`).toBeTruthy();
    expect(block).toContain("scripts/check-docs-api.cjs");
    const scriptLine = parseStageScripts(CONFIG).get(stageName) ?? "";
    expect(scriptLine, `配置里解析不出「${stageName}」那一行的 script`).not.toBe("");
    expect(
      scriptLine,
      "那一格又带上了 `--autofix` —— 产物不再进 git，没有「自动修完再提交」的对象；" +
        "而「自动修 + 再判」这个形状正是让「产物陈旧」在 CI 上隐形的那一格（#2231 的现场）",
    ).not.toContain("--autofix");
    /* 判据认的每一类输入面（三条 entryPoint 目录 + 两份配置 + 锁文件）都得被认下来 ——
     * 这一半是「判据自己的触发面声明还在」的读数，与它挂在哪一格无关。 */
    for (const f of [
      "src/lib/a.ts",
      "src/server/a.ts",
      "src/trpc/a.ts",
      "typedoc.json",
      "package.json",
      "pnpm-lock.yaml",
      "scripts/check-docs-api.cjs",
      "scripts/typedoc-run.mjs",
    ]) {
      expect(
        matchedInputs([f]),
        `判据不认 ${f}，这条用例的样本已经过期`,
      ).toEqual([f]);
    }
    /* ⚠️ 两侧形态不许分叉 —— 而且核的是「**罩住**」，不是「前缀沾边」
     * （ISSUE #2223 的现场：旧写法只比第一段前缀，于是
     * `scripts/db-backup-core.mjs` 的前缀 `scripts` 被 `scripts/check-docs-api.cjs`
     * 那条 glob 满足 ⇒ 任何 `scripts/` 下的新文件都「已覆盖」⇒ 面判窄了而没人看见）。
     *
     * 现在核的是**逐个文件**：判据的窄面（`INPUT_RES`）命中的每一个文件，都必须被
     * 某条 glob 真的罩住。枚举不靠「读实现」，而是从每条正则里取出它锚定的
     * **字面前缀**（第一个通配符之前的那段），把那个前缀下的文件列出来逐个过。 */
    for (const re of INPUT_RES) {
      const prefix = literalPrefixOf(re);
      expect(
        prefix,
        `判据的输入面 \`${re.source}\` 没法枚举（通配出现在第一段里）—— ` +
          "请把它改成锚定到某个目录或某个文件的形式",
      ).not.toBeNull();
      for (const f of filesMatchedBy(re)) {
        expect(
          coveredBy(f, INPUT_GLOBS),
          `判据的输入面 \`${re.source}\` 命中的 ${f} 没有被任何一条 glob 罩住 —— ` +
            "改输入面时必须同批改 `INPUT_GLOBS`（面判窄了 = 漏判，而漏判是静默的）",
        ).toBe(true);
      }
    }
  });

  it("`oxfmt 格式` 的扫描面就是 `check-format.cjs` 剩下的那两棵树（ISSUE #2010）", () => {
    /* 这一档是 ISSUE #2010 从本地钩子**挪过来**的，它的 globs 是**手写的上界**：
     * `check-format.cjs` 的判据面是「`GLOBS` 展成候选 → `IGNORE_GLOBS` 剔掉」,
     * 剩下 `src/**` 与 `.storybook/**` 两棵 —— globs 写窄了就是「改了却没人查格式」，
     * 而那种漏判**没有任何别的判据**会看见（钩子里那一步已经撤了）。
     *
     * 判法不走「读实现」：把 `IGNORE_GLOBS` 里每一条逐个喂给 `isScanned()`，
     * 断言它们确实在面外；再把两棵树的样本喂进去，断言它们确实在面内 ——
     * 于是「`IGNORE_GLOBS` 增删目录」这个动作会在这里当场红（要求同批回来看 globs）。 */
    const gate = INCREMENTAL_GATES.find((g) => g.name === "oxfmt 格式");
    expect(
      gate,
      "登记表里没有「oxfmt 格式」这一档 —— 它已随 ISSUE #2010 挪到平台侧，" +
        "却没有登记收窄面 = 每一个 PR 都白付一次全库扫描（或反过来，改了却没人查）",
    ).toBeDefined();
    expect(gate?.script).toBe("scripts/check-format.cjs");
    /* `["src/**", ".storybook/**"]` 是那两棵树的写法；顺序不判（两棵树之间没有语义）。 */
    expect([...(gate?.globs ?? [])].sort()).toEqual([
      ".storybook/**",
      "src/**",
    ]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fmt = require("../scripts/check-format.cjs") as {
      isScanned: (rel: string) => boolean;
      IGNORE_GLOBS: readonly string[];
    };
    for (const rel of [
      "src/lib/a.ts",
      "src/app/b.tsx",
      ".storybook/preview.tsx",
    ]) {
      expect(fmt.isScanned(rel), `判据面应当包含 ${rel}`).toBe(true);
    }
    /* 反向：`IGNORE_GLOBS` 里每一条都把文件真正剔出扫描面 —— 这一步是自检，
     * 它红的含义是「`IGNORE_GLOBS` 失效了」，请先修判据再看 globs。 */
    for (const glob of fmt.IGNORE_GLOBS) {
      /* 造一个「一定长得像那个 glob 命中物」的探针：先展开花括号，再补上缺的路径与
       * 扩展名。`*.js` 那类「通配 + 扩展名」的条目展开后已经是真文件名，不能再改扩展名
       * —— 换成 `.ts` 会让它落回扫描面里，那测的是本函数而不是 `IGNORE_GLOBS`。 */
      const braced = glob.replace(/\{[^}]*\}/g, "ts");
      const probe = /\.\w+$/.test(braced.replace(/^\*/, "x"))
        ? braced.replace(/\*/, "probe")
        : braced.replace(/\*\*$|\*$/, "probe.ts");
      expect(
        fmt.isScanned(probe),
        `\`IGNORE_GLOBS\` 里的 ${glob} 没能把 ${probe} 剔出扫描面 —— 判据面与登记表漂了`,
      ).toBe(false);
    }
  });

  it("文件结构硬规则的触发面与判据自己的扫描根同源（不是手抄的一份）", () => {
    /* 这一条抓的漂与上一条同形，但对象是 `check-file-structure.cjs`：
     * 有人给它加了一个新的扫描根（比如 `e2e/`），而 `.cnb.yml` 的 `ifModify`
     * **看起来一切正常** —— 后续改动那个目录时这一步一次都不会跑，违规静默漏过。
     *
     * 全部用注入样本复算，不靠「读实现」：扫描根下的每一个目录、以及根目录的
     * 每一种入口扩展名，都要能被 `TRIGGER_GLOBS` 认下来。 */
    const gate = INCREMENTAL_GATES.find((g) => g.name === "文件结构硬规则");
    expect(gate, "登记表里没有这一档").toBeDefined();
    expect(gate?.globs).toEqual(TRIGGER_GLOBS);
    /* 判据真的遍历每一个扫描根（源码里那一句 `})("<dir>")` / `walk("<dir>")`
     * 是它的读取点）—— 少了这一半，`SCAN_ROOTS` 写错也不会有东西响。 */
    const src = fs.readFileSync(
      path.join(process.cwd(), "scripts", "check-file-structure.cjs"),
      "utf8",
    );
    for (const dir of SCAN_ROOTS) {
      /* 三种读取点形态：`})("<dir>")`（IIFE 从它起扫）、`walk("<dir>")`（递归入口）、
       * 以及 R7/R8 那一趟的 `walkScripts(dir)` —— 它从 `"."` 起递归、`SCAN_EXCLUDED`
       * 之外全走，于是 `scripts/` 与 `tools/` 也在这一趟里（名字在代码里，不在字符串里，
       * 所以这一支只认「那趟扫描还在」，不解析它到底走了哪些目录）。 */
      const walked =
        src.includes(`})("${dir}")`) ||
        new RegExp(`(walk\\w*)\\("${dir}"\\)`).test(src) ||
        (dir !== "src" && src.includes("(function walkScripts(dir) {"));
      expect(walked, `${dir} 在 SCAN_ROOTS 里，但判据并不遍历它`).toBe(true);
      expect(TRIGGER_GLOBS).toContain(`${dir}/**`);
    }
    /* 根目录那几种扩展名：R7（禁用 .bat/.cmd/.vbs）与 R9（根目录禁 .ps1）都扫在
     * `"."` 上，所以它们必须都在触发面里 —— 否则「根目录多了一个 .cmd」不会触发判据。 */
    for (const ext of [".ps1", ".bat", ".cmd", ".vbs", ".ts", ".tsx"]) {
      expect(TRIGGER_GLOBS, `根目录的 ${ext} 不在触发面里`).toContain(
        `*${ext}`,
      );
    }
  });

  it("复合执行者（`重档静态判据`）一条 `ifModify` 都不许挂，且条目表不许被掏空", () => {
    /* 这一条守的是 2026-10-19 那次合并的**边界**：十几条静态判据收进一格是为了让它们
     * 共享一次 job 开销（理由见 `scripts/ci-heavy-gates.mjs` 头注），但合起来之后
     * `ifModify` 就退化成「十条一起跑 / 十条一起不跑」—— 后者让格内那几条扫描面不同的
     * 判据一起静默放行，比不收窄坏得多。
     *
     * 三件事一起判：① 复合执行者本身不许带 ifModify、也不许进登记表（登记表只收
     * 「一个执行者一条判据」的形态）；② 条目表非空，且每条都点了一个仓库相对入口、
     * 那个入口真在盘上（条目表被掏空或写错路径时，这一格会变成一次什么都不做的空跑，
     * 而「空跑」与「跑了全绿」在配置上长得一样）。 */
    const gated = parseStageIfModify(CONFIG);
    expect(COMPOUND_EXECUTORS.length).toBeGreaterThan(0);
    for (const name of COMPOUND_EXECUTORS) {
      expect(
        gated.has(name),
        `\`${name}\` 挂了 \`ifModify\` —— 它是复合执行者（一格装多条判据），` +
          "整格跳过会让格内扫描面不同的判据一起静默放行；要省时间请从条目那一侧想办法",
      ).toBe(false);
      expect(
        INCREMENTAL_GATE_NAMES.has(name),
        `\`${name}\` 在登记表里 —— 登记表只收「一个执行者一条判据」的形态`,
      ).toBe(false);
    }
    expect(HEAVY_GATES.length).toBeGreaterThan(0);
    for (const gate of HEAVY_GATES) {
      expect(gate.name.length, "有一个条目没写名字").toBeGreaterThan(0);
      const entry = gate.argv[0] === "node" ? gate.argv[1] : gate.argv[0];
      expect(entry, `\`${gate.name}\` 没点入口`).toMatch(
        /^(scripts\/.+\.(cjs|mjs)|node_modules\/.+)$/,
      );
      expect(
        fs.existsSync(path.join(process.cwd(), entry ?? "")),
        `\`${gate.name}\` 点的入口不在盘上：${entry}`,
      ).toBe(true);
      expect(
        gate.why.length,
        `\`${gate.name}\` 没写「它判什么」`,
      ).toBeGreaterThan(10);
    }
  });

  it("每条被收窄的 stage 在 .cnb.yml 里都真实存在且能跑（不是登记了一条不存在的）", () => {
    /* `checkIncrementalGates` 只核对 `ifModify`，不核对「这条 stage 还在不在
     * `COMFYAPP_CI_GATES` 的顺序清单里」—— 有人把某条 stage 从 GATES 摘掉、
     * 又把 ifModify 留在原地时，上面几条会一起绿，而配置里多了一段死 YAML。 */
    /* 解析形态与 `tests/no-platform-ci-config.test.ts` 的 `registeredGateOrder` 同构 ——
     * 那里是它的**唯一权威**（本判据只借这份读数核对一行事实，不另立第二份清单定义）。
     * 写成显式两段而不是可选链连写：`?.[1].split()` 在 `noUncheckedIndexedAccess` 下
     * 会被判成「$1 可能是 undefined」，而它在正则命中时必然存在（tsc 抓不到这层语义）。 */
    const gateListBody =
      /^[ \t]*COMFYAPP_CI_GATES:[ \t]*>?-?[ \t]*\r?\n((?:[ \t]+(?!#)\S[^\n]*\r?\n)+)/m.exec(
        CONFIG,
      )?.[1];
    const order =
      gateListBody === undefined
        ? []
        : gateListBody
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean);
    for (const gate of INCREMENTAL_GATES) {
      expect(
        order.includes(gate.name),
        `\`${gate.name}\` 带着 ifModify，却不在 COMFYAPP_CI_GATES 的顺序清单里（死配置）`,
      ).toBe(true);
    }
  });
});
