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
  INCREMENTAL_GATES,
  INCREMENTAL_GATE_NAMES,
  checkIncrementalGates,
  parseStageIfModify,
  readCnbConfig,
} from "../scripts/ci-incremental-gates.mjs";
import { matchedInputs } from "../scripts/check-docs-api.cjs";
import { SCAN_ROOTS, TRIGGER_GLOBS } from "../scripts/file-structure-rules.cjs";

const CONFIG = readCnbConfig();

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
       *   · `API 文档生成物与源同步` —— 它**自己**就声明了触发面（`check-docs-api.cjs`
       *     的 `INPUT_RES`，文件头第 4 条：「触发面 = typedoc 的输入面」），所以那一档的
       *     globs 由那份常量机械反推，不是第二份会漂的副本。它是本档最贵的一格
       *     （实测 201.8s / 整条 12m14s 的 27.5%），而绝大多数 PR 一行
       *     `src/lib|server|trpc` 都没碰。
       *   · `文档引用与权威源一致` —— 这一条判的是**全库**文档里的引用与权威源，
       *     域不是某几个目录，收窄成任何子集都是漏判。 */
      "文档引用与权威源一致",
      "core 骨架单一事实源",
      "零消费导出",
      "core 出口纪律与基类纯度",
      "生产构建",
      "浏览器安装",
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

  it("`API 文档生成物与源同步` 的 globs 与判据自己的输入面同源（不是手抄的副本）", () => {
    /* 这一档的 globs 由 `check-docs-api.cjs` 的 `INPUT_RES` 反推（`globFromInputRe`）。
     * 抓的是一种很难被看见的漂：有人改了判据的输入面（比如 typedoc 多了一条
     * entryPoint），而配置那边**看起来一切正常** —— 新的入口目录一次都不会触发这一步，
     * 于是产物漂了、判据没跑、没有任何信号。
     *
     * 全部用注入样本复算，不靠「读实现」：配置里每一条 glob 都要能找到一个样本，
     * 而那个样本确实被判据自己认作输入面。 */
    const gate = INCREMENTAL_GATES.find(
      (g) => g.name === "API 文档生成物与源同步",
    );
    expect(gate, "登记表里没有这一档").toBeDefined();
    const globs = gate?.globs ?? [];
    expect(globs.length).toBeGreaterThan(0);
    /* 判据认的每一类输入面（三条 entryPoint 目录 + 两份配置 + 锁文件），配置里都得覆盖。
     * 这里点名而不是遍历 `INPUT_RES`：遍历会让「判据删掉一条输入面、配置也跟着少一条」
     * 恒绿 —— 那正是本判据要拦的那种漂。 */
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
      const dir =
        f.includes("/") && f.endsWith(".ts") && !f.startsWith("scripts/")
          ? `${f.slice(0, f.lastIndexOf("/"))}/**`
          : f;
      expect(
        globs,
        `判据认 ${f}，但 .cnb.yml 那一档的 ifModify 里没有 ${dir}`,
      ).toContain(dir);
    }
  });

  it("`prettier 格式` 的扫描面就是 `check-format.cjs` 剩下的那两棵树（ISSUE #2010）", () => {
    /* 这一档是 ISSUE #2010 从本地钩子**挪过来**的，它的 globs 是**手写的上界**：
     * `check-format.cjs` 的判据面是「`GLOBS` 展成候选 → `IGNORE_GLOBS` 剔掉」,
     * 剩下 `src/**` 与 `.storybook/**` 两棵 —— globs 写窄了就是「改了却没人查格式」，
     * 而那种漏判**没有任何别的判据**会看见（钩子里那一步已经撤了）。
     *
     * 判法不走「读实现」：把 `IGNORE_GLOBS` 里每一条逐个喂给 `isScanned()`，
     * 断言它们确实在面外；再把两棵树的样本喂进去，断言它们确实在面内 ——
     * 于是「`IGNORE_GLOBS` 增删目录」这个动作会在这里当场红（要求同批回来看 globs）。 */
    const gate = INCREMENTAL_GATES.find((g) => g.name === "prettier 格式");
    expect(
      gate,
      "登记表里没有「prettier 格式」这一档 —— 它已随 ISSUE #2010 挪到平台侧，" +
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
