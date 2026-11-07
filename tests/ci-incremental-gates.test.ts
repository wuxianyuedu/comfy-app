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
import { SCAN_ROOTS, TRIGGER_GLOBS } from "../scripts/file-structure-rules.cjs";
import { globToRe } from "../scripts/vitest-projects.cjs";
import { stageBlock } from "./no-platform-ci-config.test";

const CONFIG = readCnbConfig();

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
      expect(gate.script, `${gate.name} 没写它守的是哪份脚本`).toMatch(
        /^scripts\/.+\.(?:cjs|mjs)$/,
      );
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
      /* ⚠️ 文档面里**只剩一条**在这一列（ISSUE #1981）：
       * · `生成态文档与源同步` —— 两侧输入面都能点清（`SCOPED_DOCS` 全在 `docs/**`，`FACTS` 源是 `src/**` 与三份配置），
       *   且带 `--autofix`（§13.5.19）；`文档引用与权威源一致` 判全库，收窄成子集即漏判。
       * · `API 文档生成与自检` 2026-11-05 **撤到每日档**（ISSUE #2537：新面 98% 触发率、
       *   中位 40.9s、占 30.6%），名字仍留在这一列 —— 它防的是「有人把它加回 push 并顺手挂
       *   `ifModify`」（那一跑会红）。它的每日档新名同样在这一列：每日档那一格也不许收窄。 */
      "文档引用与权威源一致",
      "API 文档生成与自检",
      "每日 API 文档生成与自检",
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

  it("`API 文档生成与自检` 已降到每日档：PR/合并侧不再判它，每日档每跑必判", () => {
    /* ISSUE #2537（事故 #2528）的收口：这一格的触发面不再是 PR/合并侧的 `ifModify`
     * （面本身仍由 `docsApiTriggerGlobs()` 从 typedoc 解析根派生）。2026-11-05 起它不再在
     * PR 侧即时判 —— 旧面 40% / 新面 98% 触发率（回放同 40 次 master 改动）、中位 40.9s、
     * 占 140.2s 串行流水线的 30.6%；降频到每日档（最晚次日 01:00 暴露，窗口 ≤24h）。
     * 本条判三件事：
     *   ① PR/合并侧的触发面里**不再有它**（谁把它加回 push 并挂 `ifModify` 要红）；
     *   ② 每日档里**有**这一格、判定门逐字在，且**不带 `ifModify`**（每日档是重跑语义）；
     *   ③ 触发面的派生与对账**没被削弱**：`INPUT_RES` 仍是 `INPUT_GLOBS` 的机械转换，
     *      判据认的每一类输入面照旧（逐文件「面罩得住事实面」的对账在
     *      `tests/docs-api-input-closure.test.ts`，不在本条）。
     */
    const stageName = "API 文档生成与自检";
    expect(
      INCREMENTAL_GATE_NAMES.has(stageName),
      "登记表里又出现了「API 文档生成与自检」—— 它 2026-11-05 已撤到每日档（无 ifModify）；" +
        "加回 push 收窄面就是把 98% 触发率的成本重新背回关键路径（ISSUE #2537）",
    ).toBe(false);
    expect(
      parseStageIfModify(CONFIG).has(stageName),
      "`API 文档生成与自检` 又带上了 `ifModify` —— PR/合并侧不该再即时判它（ISSUE #2537）",
    ).toBe(false);

    const dailyName = "每日 API 文档生成与自检";
    const block = stageBlock(CONFIG, dailyName);
    expect(
      block,
      `配置里解析不出「${dailyName}」这一格 —— 每日档没有执行者，等于把这条判据删了`,
    ).toBeTruthy();
    expect(block).toContain("scripts/check-docs-api.cjs");
    expect(
      parseStageIfModify(CONFIG).has(dailyName),
      "每日档那一格挂上了 `ifModify` —— 每日档是「重跑一遍」的语义，按改动面跳过就不是每日档",
    ).toBe(false);
    /* 判定门不带 `--autofix`（ISSUE #2231）：产物不进 git，没有「自动修完再提交」的对象，
     * 而「自动修 + 再判」正是让产物陈旧在 CI 上隐形的那一格。
     * 核的是**那一行的 `script:`**，不是整块 —— 注释里出现旗标字面量不算「带着那个旗标」。 */
    const scriptLine = parseStageScripts(CONFIG).get(dailyName) ?? "";
    expect(scriptLine, `配置里解析不出「${dailyName}」那一行的 script`).not.toBe("");
    expect(scriptLine).toContain("scripts/check-docs-api.cjs");
    expect(
      scriptLine,
      "那一格又带上了 `--autofix` —— 产物不进 git，没有「自动修完再提交」的对象（#2231）",
    ).not.toContain("--autofix");
    /* 判据认的每一类输入面（解析根覆盖的目录 + 根级文件 + 锁文件）都得被认下来 ——
     * 这一半是「判据自己的触发面声明还在」的读数，与它挂在哪一格无关。 */
    for (const f of [
      "src/lib/a.ts",
      "src/server/a.ts",
      "src/trpc/a.ts",
      /* ISSUE #2537：这些文件也在 typedoc 的解析面里，旧面漏判的就是它们。 */
      "src/app/page.tsx",
      "tests/publish-desktop-bundle.test.ts",
      "scripts/publish-desktop-bundle.mjs",
      "e2e/a.ts",
      "typedoc.json",
      "package.json",
      "pnpm-lock.yaml",
      "scripts/check-docs-api.cjs",
      "scripts/typedoc-run.mjs",
    ]) {
      expect(matchedInputs([f]), `判据不认 ${f}，这条用例的样本已经过期`).toEqual([f]);
    }
    /* 只改文档的 PR 不许被「顺带」认成输入面（ISSUE #2537：不得把面放宽成全库）。 */
    expect(matchedInputs(["docs/standards/13-提交与-code-review.md", "README.md"])).toEqual([]);
    /* 形态同源：`INPUT_RES` 是 `INPUT_GLOBS` 的机械转换，不另写一份窄面 —— 两份会漂，
     * 漂的形态就是「判据改了触发面、配置没跟」（ISSUE #2223 的漏判形态）。逐条对上。
     * 「面罩得住事实面」的逐文件对账在 `tests/docs-api-input-closure.test.ts`（那边算 TS 程序）。 */
    expect(INPUT_RES).toEqual(INPUT_GLOBS.map((g) => globToRe(g)));
  });

  it("`oxfmt 格式` 的判据面自洽，且 2026-11-05 起由 GA 每次 PR 跑（无收窄）", () => {
    /* 这一档自 ISSUE #2010 从本地钩子挪到平台侧；2026-11-05 薄化把 CNB 那一格整格搬到
     * `.github/workflows/pr-gate.yml`，于是「配置里的手写 glob 要盖住判据面」这条对账
     * **失去对象**：GA 上没有 `ifModify`，每次 PR 都跑，收窄面由判据自己算（改动面 ∩ `GLOBS`）。
     * 留下的是判据面的自检：`GLOBS` / `IGNORE_GLOBS` 增删时这里当场红，防止
     * `check-format.cjs` 的两份判面（全量 / 改动面）自己漂开。 */
    const workflow = fs.readFileSync(
      path.join(process.cwd(), ".github", "workflows", "pr-gate.yml"),
      "utf8",
    );
    expect(
      workflow,
      "`.github/workflows/pr-gate.yml` 里没有 `check-format.cjs --changed` —— 撤出 CNB 后" +
        "它是这条判据唯一的执行者，两边都没有 = 没人跑它",
    ).toContain("node scripts/check-format.cjs --changed");
    /* ISSUE #3291：同一 job 里还有第二格全量档（不带旗标）—— 两格互补：`--changed`
     * 判这次 PR 带来的改动面，全量档判全库不变式。缺了它，「PR 自己扩判面 / 删
     * `IGNORE_GLOBS` / 改 `.oxfmtrc.json`」又只剩人手动盘点这一条路。 */
    expect(
      /^[ \t]*run:\s*node scripts\/check-format\.cjs\s*$/m.test(workflow),
      "`.github/workflows/pr-gate.yml` 里没有不带旗标的全量档 —— 全库不变式没有自动执行者",
    ).toBe(true);
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
        ? braced.replaceAll("*", "probe")
        : braced.replace(/\*\*$|\*$/, "probe.ts");
      expect(
        fmt.isScanned(probe),
        `\`IGNORE_GLOBS\` 里的 ${glob} 没能把 ${probe} 剔出全量扫描面 —— 判据面与登记表漂了`,
      ).toBe(false);
    }
  });

  it("文件结构硬规则的扫描根与判据同源，且 GA 每次 PR 都跑它（无收窄）", () => {
    /* 2026-11-05 之前这条钉的是「`.cnb.yml` 的 `ifModify` globs ⇄ `TRIGGER_GLOBS`」；
     * 那一格搬到 GA 后没有 `ifModify`，对账失去对象，剩下两件仍然会坏的事：
     * ① 判据真的遍历每一个扫描根（源码里的读取点是唯一证据）；
     * ② `TRIGGER_GLOBS` 覆盖根目录那几种入口扩展名（万一以后有人把它接回某份配置，
     *    「根目录多了一个 .cmd」不能漏）。另加一条：GA 上确实有无条件执行者。 */
    const workflow = fs.readFileSync(
      path.join(process.cwd(), ".github", "workflows", "pr-gate.yml"),
      "utf8",
    );
    expect(
      workflow,
      "`.github/workflows/pr-gate.yml` 里没有 `check-file-structure.cjs` —— 撤出 CNB 后" +
        "它是这条判据唯一的执行者",
    ).toContain("node scripts/check-file-structure.cjs");
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
        /^(?:scripts\/.+\.(?:cjs|mjs)|node_modules\/.+)$/,
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
