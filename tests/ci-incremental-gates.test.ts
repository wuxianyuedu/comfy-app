/**
 * 平台侧门禁的**增量收窄**：`.cnb.yml` 的 `ifModify` ⇄ 登记表双向同源（ISSUE #1981）。判的不是「哪几条该收窄」
 * （那是收益判断），而是「收窄名单只有一处出处」：登记表每条 ⇒ 配置里同名 stage 带逐字相同的 `ifModify`；配置里带
 * `ifModify` 的 stage ⇒ 必在登记表里。少任一半就退化成「看着在收窄、其实收窄了什么没人知道」（只有②时登记表会变成与配置无关的文档）；误收窄只会让下一次真回归静默漏过。
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
import { INPUT_GLOBS, INPUT_RES, matchedInputs } from "../scripts/check-docs-api.cjs";
import { filesUnder } from "../scripts/docs-api-input-closure.mjs";
import { SCAN_ROOTS, TRIGGER_GLOBS } from "../scripts/file-structure-rules.cjs";
import { globToRe } from "../scripts/vitest-projects.cjs";
import { stageBlock } from "./no-platform-ci-config.test";

const CONFIG = readCnbConfig();

/**
 * 一个路径是否被某条 glob 罩住。glob → 正则**复用** `scripts/vitest-projects.cjs` 已导出的那一份
 * （同一套 `**` / `*` / `{a,b}` 口径且带锚点）—— 不在本文件写第二套 glob 匹配（§12.12 / §12.18）。
 * @param rel 仓库相对路径；@param globs glob 清单
 */
function coveredBy(rel: string, globs: ReadonlyArray<string>): boolean {
  return globs.some((g) => globToRe(g).test(rel));
}

/**
 * 一条输入面正则的「字面前缀」= 第一个通配符之前的那段（正则锚定到仓库根）：例如 `src/lib/a.ts` 那条的前缀是
 * `src/lib`；整条都是字面量时（如 `typedoc.json`）前缀就是那个文件本身。通配出现在第一段里时返回 `null`（没法枚举）。
 * @param re 输入面正则
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
      if (next === undefined) {
        break;
      }
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
  if (!sawWildcard) {
    return out;
  }
  const cut = out.lastIndexOf("/");
  return cut === -1 ? null : out.slice(0, cut);
}

/**
 * 目录枚举的缓存 —— 同一次运行里同一个前缀只列一次（三根加起来 600 多个文件，
 * 而这条用例是**每次提交都跑**的固定清单成员）。
 */
const filesUnderCache = new Map<string, Array<string>>();

/**
 * 一条输入面正则命中的、**盘上真实存在**的文件清单：前缀是文件 ⇒ 就是它；是目录 ⇒ 把该目录下候选文件逐个过正则
 * （目录遍历复用 `scripts/docs-api-input-closure.mjs` 已导出的 `filesUnder`，不在本文件抄第二份遍历）。
 * @param re 输入面正则
 */
function filesMatchedBy(re: RegExp): Array<string> {
  const prefix = literalPrefixOf(re);
  if (prefix === null || prefix === "") {
    return [];
  }
  const abs = path.join(process.cwd(), prefix);
  if (!fs.existsSync(abs)) {
    return [];
  }
  if (fs.statSync(abs).isFile()) {
    return re.test(prefix) ? [prefix] : [];
  }
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
    expect(problems, `平台侧增量登记与配置不一致：\n${problems.join("\n")}`).toEqual([]);
  });

  it("登记表非空（清单被掏空时这条会红，而不是让上面那条恒绿）", () => {
    /* 反向验证：没有这一条，把 INCREMENTAL_GATES 清空会让上面那条变成恒真 ——
     * 「判据不是空转」的同一形态（见 tests/no-platform-ci-config.test.ts 的头注）。 */
    expect(INCREMENTAL_GATES.length).toBeGreaterThan(0);
    for (const gate of INCREMENTAL_GATES) {
      expect(gate.globs.length, `${gate.name} 的 globs 是空的`).toBeGreaterThan(0);
      expect(gate.script, `${gate.name} 没写它守的是哪份脚本`).toMatch(/^scripts\/.+\.(cjs|mjs)$/);
      expect(gate.why.length, `${gate.name} 没写「为什么这条收窄安全」`).toBeGreaterThan(20);
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
      /* ⚠️ `文件结构硬规则` **从这一列挪进登记表了**（ISSUE #2010）：用户点名的三格耗时项之一
       * （实测 2~4s），扫的是盘上某组目录（`src/` + `scripts/` + `tools/` + 根入口类文件），不是「跨全仓单一事实源」
       * 那类不可收窄的不变量。触发面由 `file-structure-rules.cjs` 的 `TRIGGER_GLOBS` 机械导出，「收窄了但扫描面变了」
       * 的漂会当场红（见文件头最后一条用例）。 */
      "UI/逻辑分离",
      "lib Node-only 声明",
      /* ⚠️ `格式化提交分离` **2026-10-17 从这一列挪出去了**（ISSUE #1993）：它判「这次提交里有多少文件只是被 prettier
       * 重排过」，本体是逐文件跑一次 prettier，面是「源文件扩展名」而非全仓 ⇒ 属「扫描面封闭」那一档，已登记进
       * `INCREMENTAL_GATES`。这一格是收窄口径本身的回归面：谁把它挪回这一列，反向那条会红。 */
      /* ⚠️ 文档面三条里**只剩一条**在这一列（ISSUE #1981）：
       * · `生成态文档与源同步` —— 两侧输入面都能点清（`SCOPED_DOCS` 全在 `docs/**`，`FACTS` 源是 `src/**` 与三份配置），
       *   且带 `--autofix`（§13.5.19）；`API 文档生成与自检` 由 `INPUT_RES` 机械反推收窄面（最贵一格，201.8s / 12m14s
       *   的 27.5%；2026-10-23 起产物面 `docs/api/**` 已去掉，#2231）；`文档引用与权威源一致` 判全库，收窄成子集即漏判。 */
      "文档引用与权威源一致",
      "core 骨架单一事实源",
      "零消费导出",
      "core 出口纪律与基类纯度",
      /* ⚠️ `生产构建` **2026-10-18 从 PR 那一条撤了**（挪进每日档，§13.5.23），名字刻意留在这一列：`parseStageIfModify()`
       * 判「配置里带 `ifModify` 的 stage」⇒ 这列防的是将来有人把它加回 PR 并顺手收窄（那一跑会红，也是唯一还看得见那件
       * 事的地方）。这一列今天也管得到每日那七格：它们 2026-10-19 搬到顶层锚点 `.daily-gates` 后进入扫描面，顺带修掉
       * 「每日档挂 ifModify 没判据响」的盲区；每日清单的在场与入口仍由 `tests/no-platform-ci-config.test.ts` 双向钉。 */
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
    const inRegistry = MUST_ALWAYS_RUN.filter((n) => INCREMENTAL_GATE_NAMES.has(n));
    expect(inRegistry, `登记表里混进了全仓级 stage：${inRegistry.join(", ")}`).toEqual([]);
  });

  it("`API 文档生成与自检` 自己占一格、收窄挂在**那一格**上，且输入面只有一处出处", () => {
    /* 三段历史各留一个形状：2026-10-19 收进聚合档 `重档静态判据` ⇒ `ifModify` 按整格跳过、这层不再存在；10-20 原文被
     * 注释而聚合档读钩子注册表（该档 10-16 已从钩子撤走）⇒ 两次搬动对穿，这一档无人执行，`docs/api/**` 漂了 32 份；
     * 10-22 恢复成独立 stage、收窄挂在**那一格**（复合执行者一条都不许挂，见 `COMPOUND_EXECUTORS`）；10-23（#2231）
     * 改名并改判产物可用性、不再带 `--autofix`。于是本条判三件事：① 那一格真的活着（不是注释形态）；② 收窄逐字等于
     * `INPUT_RES`；③ 判定门不带 `--autofix`（「自动修 + 再判」正是让产物陈旧在 CI 上隐形的那一格）。 */
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
      expect(matchedInputs([f]), `判据不认 ${f}，这条用例的样本已经过期`).toEqual([f]);
    }
    /* ⚠️ 两侧形态不许分叉 —— 核的是「**罩住**」而非「前缀沾边」（ISSUE #2223 的现场：旧写法只比第一段前缀，
     * `scripts/db-backup-core.mjs` 的 `scripts` 前缀被 `scripts/check-docs-api.cjs` 的 glob 满足 ⇒ 任何 `scripts/` 下文件
     * 都「已覆盖」⇒ 面判窄而没人看见）。现在逐文件核：每条正则取它锚定的字面前缀，前缀下的文件逐个过正则，
     * `INPUT_RES` 命中的每个文件都必须被某条 glob 真罩住。 */
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

  it("`oxfmt 格式` 的触发面盖住判据面（改动面 ∩ GLOBS，ISSUE #2979）", () => {
    /* 这一档自 ISSUE #2010 从本地钩子挪来；ISSUE #2979 起 `check-format.cjs` 有两份判面：全量 = `GLOBS` −
     * `IGNORE_GLOBS`（只剩 `src/**` 与 `.storybook/**`），改动面（`--changed` / `--staged`）= 改动面 ∩ `GLOBS`
     * （不过 `IGNORE_GLOBS` —— `scripts/**` 从前无人拦）。平台那格带 `--changed`，故手写 globs 必须盖住 GLOBS
     * 每个目录，写窄即「改了却没人查格式」且无别的判据可见。判法不读实现：全量用 `isScanned()`、改动面用
     * `isChangedFaceFile()` —— `GLOBS` 扩展名或 `IGNORE_GLOBS` 增删会在这里当场红。 */
    const gate = INCREMENTAL_GATES.find((g) => g.name === "oxfmt 格式");
    expect(
      gate,
      "登记表里没有「oxfmt 格式」这一档 —— 它已随 ISSUE #2010 挪到平台侧，" +
        "却没有登记收窄面 = 每一个 PR 都白付一次全库扫描（或反过来，改了却没人查）",
    ).toBeDefined();
    expect(gate?.script).toBe("scripts/check-format.cjs");
    /* 顺序不判（条目之间没有语义），逐条要对上。 */
    expect([...(gate?.globs ?? [])].sort()).toEqual(
      [
        "src/**",
        ".storybook/**",
        "scripts/**",
        "tests/**",
        "tools/**",
        "e2e/**",
        "*.config.js",
        "*.config.ts",
        "*.config.mjs",
        "*.config.cjs",
      ].sort(),
    );
    /* SAFETY: 类型断言已复核 */
    // oxlint-disable-next-line typescript/no-require-imports
    const fmt = require("../scripts/check-format.cjs") as {
      IGNORE_GLOBS: ReadonlyArray<string>;
      isChangedFaceFile: (rel: string) => boolean;
      isScanned: (rel: string) => boolean;
    };
    /* 全量档的两棵树照旧在面内。 */
    for (const rel of ["src/lib/a.ts", "src/app/b.tsx", ".storybook/preview.tsx"]) {
      expect(fmt.isScanned(rel), `判据面应当包含 ${rel}`).toBe(true);
    }
    /* 改动面两档的面：scripts / tests / tools / e2e 与根级 config 都要认 ——
     * 那是 #2979 的本旨（本仓自己的脚本与用例也在格式判据的量程里）。 */
    for (const rel of [
      "scripts/probe.cjs",
      "tests/anything.test.ts",
      "tools/start/x.mjs",
      "e2e/fixture.spec.ts",
      "next.config.js",
      "drizzle.config.ts",
    ]) {
      expect(fmt.isChangedFaceFile(rel), `改动面应当包含 ${rel}`).toBe(true);
    }
    /* 反向（全量档）：`IGNORE_GLOBS` 里每一条都把文件真正剔出**全量**面 —— 这一步是
     * 自检，它红的含义是「`IGNORE_GLOBS` 失效了」，请先修判据再看 globs。 */
    for (const glob of fmt.IGNORE_GLOBS) {
      /* 造一个「一定长得像那个 glob 命中物」的探针：先展开花括号，再补上缺的路径与
       * 扩展名。`*.js` 那类「通配 + 扩展名」的条目展开后已经是真文件名，不能再改扩展名
       * —— 换成 `.ts` 会让它落回扫描面里，那测的是本函数而不是 `IGNORE_GLOBS`。 */
      const braced = glob.replaceAll(/\{[^}]*\}/g, "ts");
      const probe = /\.\w+$/.test(braced.replace(/^\*/, "x"))
        ? braced.replace(/\*/, "probe")
        : braced.replace(/\*\*$|\*$/, "probe.ts");
      expect(
        fmt.isScanned(probe),
        `\`IGNORE_GLOBS\` 里的 ${glob} 没能把 ${probe} 剔出全量扫描面 —— 判据面与登记表漂了`,
      ).toBe(false);
    }
  });

  it("文件结构硬规则的触发面与判据自己的扫描根同源（不是手抄的一份）", () => {
    /* 与上一条同形的漂，对象是 `check-file-structure.cjs`：有人加了新扫描根（比如 `e2e/`）而 `.cnb.yml` 的 `ifModify`
     * 看起来一切正常 ⇒ 后续改动那目录时这一步一次都不跑，违规静默漏过。全部用注入样本复算：扫描根下每个目录、根
     * 目录的每种入口扩展名，都要被 `TRIGGER_GLOBS` 认下。 */
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
      expect(TRIGGER_GLOBS, `根目录的 ${ext} 不在触发面里`).toContain(`*${ext}`);
    }
  });

  it("复合执行者（`重档静态判据`）一条 `ifModify` 都不许挂，且条目表不许被掏空", () => {
    /* 守 2026-10-19 那次合并的**边界**：十几条静态判据收进一格为共享一次 job 开销（见 `ci-heavy-gates.mjs` 头注），
     * 但合起来后 `ifModify` 退化成「十条一起跑 / 一起不跑」，后者让扫描面不同的判据一起静默放行。三件事一起判：
     * ① 复合执行者不许带 ifModify、不许进登记表；② 条目表非空、每条点了仓库相对入口且入口真在盘上（掏空或写错
     * 路径会让这一格变成空跑，而「空跑」与「跑了全绿」在配置上长得一样）。 */
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
      expect(gate.why.length, `\`${gate.name}\` 没写「它判什么」`).toBeGreaterThan(10);
    }
  });

  it("每条被收窄的 stage 在 .cnb.yml 里都真实存在且能跑（不是登记了一条不存在的）", () => {
    /* `checkIncrementalGates` 只核对 `ifModify`，不核对「这条 stage 还在不在哪一份
     * 顺序清单里」—— 有人把某条 stage 从清单摘掉、又把 ifModify 留在原地时，
     * 上面几条会一起绿，而配置里多了一段死 YAML。 */
    /* 解析形态与 `tests/no-platform-ci-config.test.ts` 的 `registeredGateOrder` 同构 —— 那里是唯一权威（本判据只借
     * 读数核对一行事实，不另立清单定义）。写成显式两段而非可选链：`?.[1].split()` 在 `noUncheckedIndexedAccess` 下被
     * 判「$1 可能 undefined」，而正则命中时必然存在。2026-10-28 起核对面是三份档位清单的并集（PR / push / 每日），
     * 「死配置」指三份里都不在。 */
    const folded = (key: string): Array<string> => {
      const body = new RegExp(
        `^[ \\t]*${key}:[ \\t]*>?-?[ \\t]*\\r?\\n((?:[ \\t]+(?!#)\\S[^\\n]*\\r?\\n)+)`,
        "m",
      ).exec(CONFIG)?.[1];
      return body === undefined
        ? []
        : body
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean);
    };
    const order = new Set([
      ...folded("COMFYAPP_CI_GATES"),
      ...folded("COMFYAPP_CI_PUSH_GATES"),
      ...folded("COMFYAPP_CI_DAILY_GATES"),
    ]);
    for (const gate of INCREMENTAL_GATES) {
      expect(
        order.has(gate.name),
        `\`${gate.name}\` 带着 ifModify，却不在 PR / push / 每日任何一份顺序清单里（死配置）`,
      ).toBe(true);
    }
  });
});
