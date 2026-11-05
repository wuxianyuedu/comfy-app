#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:用例的环境档与「环境早退」形态(供 .githooks/pre-commit 调用)
/**
 * 用例跑在哪个环境，不许靠**猜** —— 规范见 docs/standards/11-测试与可观测性.md §11.17。
 *
 * 现场（ISSUE #1485）：`vitest.config.ts` 是一条全局 `environment: "node"`，
 * 要 DOM 的用例各自在文件头写 `// @vitest-environment jsdom`。两件都对，
 * 但**第二件从来没人判过**：少写一行不报错，只是让用例留在 node 档下跑。
 * 表现分两种，而坏的那种是静默的：
 *
 *   · **响的**：真碰 `document` / `window`，当场 `ReferenceError`。这种会被人修掉。
 *   · **静默的**：用例自己写着 `if (typeof window !== "undefined") return;`
 *     这类**环境早退**——在 node 档下它已经「过了」，于是换个默认档（或本文件
 *     被挪进另一个 project）之后，它照样报绿，**而一条断言都没跑**。
 *     绿有两种含义，这一条恰好是坏的那种（同 §11.13.1 的「判据在场 ≠ 判据在跑」）。
 *
 * 本脚本判两件事，都不需要跑用例（纯文本，零网络，实测 < 1s）：
 *
 *   ① **环境早退**：用例体内出现「按环境决定跑不跑」的裸 return —— 一律阻断。
 *      正解是**把条件造出来**（`vi.stubGlobal("window", undefined)`，仓里
 *      `src/lib/app-events.test.ts` 已是这个形状），而不是把结论挂在环境的
 *      一个**全局默认值**上。判据故意**不认**「这个文件有 jsdom 文件头」：
 *      文件头只说明此刻跑在哪一档，管不住「以后谁改了默认档 / 谁把它挪进
 *      另一个 project」—— 那正是这条用例要防的事。
 *
 *   ② **文件头与目录档的一致性**：`vitest.config.ts` 的 `projects` 按目录声明了
 *      默认档，本脚本核「DOM 档的用例声明 node / node 档的用例声明 DOM」这类
 *      **互相矛盾**的组合。它守的是「挪目录 / 改档」这类改动的可见性，
 *      不替用例决定该跑在哪。
 *
 *   ③ **冗余文件头**：文件头与它所属的档给出**同一个结论**（两处都说 DOM /
 *      两处都说 node）—— 同一件事写了两个来源，改一处漏一处无人察觉。
 *      判据与 ② 同源（同一份解析出来的 glob + 同一个 glob 引擎），
 *      **不需要跑 vitest**：所属档由 `include` / `exclude` 的匹配直接算出来。
 *      它把「哪一份头是冗余的」从「谁手工跑一遍 `vitest list` 逐份比」变成钩子里的一次判定
 *      —— ISSUE #1485 那轮删掉的 147 份就是这么找出来的，但当时**没有判据**，
 *      于是收尾时漏了 1 份（`tests/sidebar-selected-state.test.tsx`，`.test.tsx` 已由目录档覆盖）。
 *
 * 用法：
 *   node scripts/check-test-environment.cjs            # 检查
 *   node scripts/check-test-environment.cjs --report   # 只出清单不判失败（盘点用）
 *
 * 退出码 0 = 通过，1 = 阻断。
 */
const path = require("node:path");
const { readForScan, walkForScan, vanishedNote } = require("./gate-scan-read.cjs");
const { loadProjects, matchesAny } = require("./vitest-projects.cjs");

const ROOT = path.resolve(__dirname, "..");
const REPORT_ONLY = new Set(process.argv.slice(2)).has("--report");

/** 扫描范围：与 `vitest.config.ts` 的 `include` 同口径。 */
const SCAN_DIRS = ["src", "tests"];
const TEST_FILE_RE = /\.test\.tsx?$/;

/**
 * 「环境早退」的形状 —— 两种写法都认，因为它们都能让一条用例**不跑也绿**：
 *
 *   · `if (typeof window !== "undefined") return;` —— 在 node 档下早退；
 *   · `if (typeof window === "undefined") return;` —— 在 DOM 档下早退。
 *
 * ⚠️ **`typeof` 后面只认环境全局那几个名字**，不是任意标识符。首版写成
 * `typeof \w+` 时，`UseWorkshopPipelinePersistence.test.tsx` 的
 * `function requestUrl(input) { if (typeof input === "string") return input; }`
 * 被当场误报 —— 那是**类型收窄**，与环境档毫无关系。一个会误报的判据接下来
 * 的下场就是被整条放宽（§12.13 的原话：「清单变噪音，没人会照它排期」），
 * 所以这里的白名单是**判据能立住的前提**，不是优化。
 *
 * 名单的出处是「一个全局在 node 档下不存在、在 DOM 档下存在」这件事本身：
 * `window` / `document` / `navigator` / `localStorage` / `sessionStorage` 是
 * jsdom 提供的（`navigator` 在 Node 24 也**存在**，所以它单独列出来是给
 * 「按浏览器语义用它」的用例留的；真要判它请配 `vi.stubGlobal`）。
 */
const ENV_GLOBALS =
  "window|document|navigator|localStorage|sessionStorage|self|HTMLCanvasElement|MutationObserver|ResizeObserver";

/**
 * ⚠️ 只认「守卫紧跟着裸 `return`」这一形态。**带了断言的守卫不算**
 * （`if (typeof window === "undefined") { expect(x).toBeNull(); return; }` 是
 * 正确的「两个分支各判各的」写法），所以正则要求 `)` 与 `return` 之间只有空白与分号。
 *
 * ⚠️ 平台早退（`if (process.platform !== "win32") return;`）**刻意不在这一档**：
 * 它另有登记机制（`tests/conditional-skip-registry.test.ts` 管
 * `describe.runIf` / `it.skipIf`），而这里管的是「绕开机制、用裸 return 让用例
 * 悄悄不跑」那条**没有登记要求**的路。两条判据各自有执行者，不重叠也不留缝。
 */
const EARLY_RETURN_RES = [
  new RegExp(
    String.raw`if\s*\(\s*typeof\s+(?:` +
      ENV_GLOBALS +
      String.raw`)\s*[!=]==?\s*""\s*\)\s*\{?\s*return\s*;?`,
  ),
];

/**
 * 剥掉注释后再判 —— 否则「说明这条写法的注释」自己会被判违规（仓里已经有几处
 * 注释在讲这个反模式），而判据一旦开始误报就会被人整条放宽。
 *
 * ⚠️ **字符串只换成占位符，不删掉**：本判据要判的那一行里恰恰有个字符串
 * （`typeof window !== "undefined"`）—— 早期版本把字符串内容**删空**，
 * 于是剥完变成 `typeof window !== ) return;`，正则连同它的哨兵一起失配，
 * **变异测试当场证明它认不出自己最想认的那个形状**。换成 `""` 占位既挡住
 * 「注释里的示例代码」，又保住这一行的可匹配性。
 */
function stripCommentsAndStrings(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let state = "code"; // code | line | block | str | tpl
  let open = ""; // 当前字符串用的引号（`"` / `'` / `` ` ``）
  while (i < n) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (state === "code") {
      if (c2 === "//") {
        state = "line";
        i += 2;
        continue;
      }
      if (c2 === "/*") {
        state = "block";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") {
        state = "str";
        open = c;
        i += 1;
        continue;
      }
      if (c === "`") {
        state = "tpl";
        open = c;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        out += c;
      }
      i += 1;
      continue;
    }
    if (state === "block") {
      if (c2 === "*/") {
        state = "code";
        i += 2;
        continue;
      }
      if (c === "\n") {
        out += c;
      }
      i += 1;
      continue;
    }
    if (state === "str" || state === "tpl") {
      /* 转义序列整体吃掉（含 `\\"` 与 `\\\n`），不让它提前闭合。 */
      if (c === "\\") {
        i += 2;
        continue;
      }
      const closer = state === "str" ? (open === '"' ? '"' : "'") : "`";
      if (c === closer) {
        state = "code";
        /* 占位符：保住「这里原本有一个非空字符串字面量」这个事实，
         * 但抹掉它的内容 —— 判据要的是形状，不是那个词写的是什么。 */
        out += '""';
        i += 1;
        continue;
      }
      if (c === "\n") {
        out += c;
      } /* 模板串里的换行要留着，行号才对得上 */
      i += 1;
      continue;
    }
  }
  return out;
}

/**
 * 枚举扫描面。**点开头的目录**不进去，但点开头的**文件**照收 —— 并发探针
 * （`tests/.setup-cleanup-probe-*.test.tsx`）正是后者，跳掉它等于判据在最该看着它的
 * 那一刻转身不看。消失容错的口径见 `gate-scan-read.cjs`（这一度是本文件自己的一份
 * `try { readdirSync } catch { return out }` —— 那一份把**所有**错误都吞掉）。
 */
function walk(dir) {
  return walkForScan(dir, TEST_FILE_RE, { skipHiddenDirs: true });
}

/** 用例文件里声明的环境（文件头 `// @vitest-environment <name>`）。 */
function declaredEnv(text) {
  const m = /^\/\/\s*@vitest-environment\s+(?<env>\S+)\s*$/m.exec(text);
  return m ? (m.groups?.env ?? null) : null;
}

/**
 * `vitest.config.ts` 的 `projects` 里按目录声明的档，与每个档的 `environment`。
 *
 * 解析与 glob 引擎抽在 `vitest-projects.cjs`（`check-test-inventory.cjs` 共用同一份）——
 * 判「用例归属」的判据有两份，各自抄一遍 `indexOf("projects:")` 的代价是静默的：
 * 配置里 `DOM_TEST_GLOBS` 加一条目录时只有一份跟着变，另一份照旧报 OK。
 *
 * 形状不认识 ⇒ `found` 不增，由下面 `found < 2` 兜住（**不许**退回「没有目录档」
 * ＝ 判据静默消失，同 §11.13.1「判据在场 ≠ 判据在跑」）。
 */
function projectGlobs() {
  return loadProjects(ROOT);
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function main() {
  const listed = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
    .map((abs) => ({ abs, rel: toPosix(path.relative(ROOT, abs)) }))
    .sort((a, b) => a.rel.localeCompare(b.rel));

  /* **每份文件只读一次**：下面三条判据走的是同一张 `files`，各读一遍时一份消失的文件
   * 会被记成三条「未读」—— 而真正没读的只有一份。收在一处读取顺便去掉重复 IO。
   * 消失容错、「只降级 ENOENT」与「不许静默」的口径都在 `gate-scan-read.cjs`。 */
  const rawByRel = new Map();
  const files = [];
  let vanished = 0;
  for (const f of listed) {
    const raw = readForScan(f.abs);
    if (raw === null) {
      vanished += 1;
      continue;
    }
    rawByRel.set(f.rel, raw);
    files.push(f);
  }
  const note = vanishedNote(vanished);

  const problems = [];

  /* ① 环境早退 —— 判据本体。 */
  for (const { rel } of files) {
    const raw = rawByRel.get(rel);
    /* 判据跑在**剥过注释**的文本上，但**报错回原文那一行** —— 否则
     * `typeof window !== "undefined"` 会被打成 `typeof window !== ""`
     * （字符串换成占位符的代价），读报错的人得先猜一遍自己的代码长什么样。 */
    const strippedLines = stripCommentsAndStrings(raw).split("\n");
    const rawLines = raw.split("\n");
    for (let i = 0; i < strippedLines.length; i += 1) {
      for (const re of EARLY_RETURN_RES) {
        if (re.test(strippedLines[i])) {
          problems.push({
            rel,
            line: i + 1,
            kind: "环境早退",
            detail: (rawLines[i] ?? strippedLines[i]).trim(),
          });
          break;
        }
      }
    }
  }

  /* ②③ 需要先知道「哪个档负责哪些用例」。 */
  const { tiers, found, environments: envOfTier, configText } = projectGlobs();
  if (found < 2) {
    console.error(
      `[ERROR] 解析 \`vitest.config.ts\` 的 \`projects\` 失败（拿到 ${found} 个档，期望 2）。\n${
        configText === null
          ? "        连 `vitest.config.ts` 都没读到 —— 那本身就是要判失败的故障，\n" +
            "        不许当「配置里没有 projects」处理。\n"
          : ""
      }        本判据依赖那两个 project 的 \`include\` / \`exclude\` glob；\n` +
        `        配置形状改了就要同批改这里 —— 静默退回「没有目录档」等于这条判据消失。`,
    );
    return 1;
  }
  /* 档名 ⇄ 该档的 `environment`。**不写死**：配置里那一行才是权威，
   * 本脚本只保证「文件头说的环境」与「它所属档的环境」对得上。
   * 硬编码档名会让「给 DOM 档换一个环境实现」这类改动在不改本脚本的情况下
   * 静默失效（判据照旧报 OK，而比对的两边已经不同源）。 */

  /**
   * 一份用例**实际**会跑在哪个档：`exclude` 优先，其次按 `include` 命中。
   * 返回 `null` = 一个档都没命中或命中多个（配置自己有缝 / 有重叠）——
   * 那两种情况都**不归本判据**（②③ 都是「两个来源有没有打架」的判据，
   * 配置自己有缝时报任何一条都会把人带偏）。
   */
  function tierOf(rel) {
    const hits = [];
    for (const [name, g] of tiers) {
      const included = matchesAny(rel, g.include);
      const excluded = matchesAny(rel, g.exclude);
      if (included && !excluded) {
        hits.push(name);
      }
    }
    return hits.length === 1 ? hits[0] : null;
  }

  /* ② 目录档与文件头**互相矛盾**。
   *
   * ⚠️ 判据的口径是「**这一档声明了它会跑在 X，而文件头说 X 是错的**」，
   * 不是「文件头与所属 project 不同名」—— 后者会误报一整片：
   * `projects` 只决定**没写文件头**时跑在哪，所以「node 档里放一份写了 DOM
   * 头的用例」是完全正当的写法（文件头优先级更高，它照样跑在 DOM 环境）。
   * 实测：按后一种口径装上去，当场报 37 处「矛盾」，全是混合目录里那些**本来
   * 就该靠文件头指定 jsdom** 的 `.test.ts`（`src/lib/project-canvas/canvas-store`
   * 那些）—— 一条会误报 37 处的判据活不过一次评审。
   *
   * ⚠️ 分档现在是**三档**（`node` 档 + DOM 档，DOM 档基本档是 `happy-dom`、
   * 允许用文件头改到 `jsdom`），所以「矛盾」与「冗余」的定义跟着细化了一层：
   *
   * | 所属档的环境 | 文件头写的 | 判定 |
   * | ------------ | ---------- | ---- |
   * | `node`       | 任何 DOM   | **正当**（混合目录的唯一声明，不许收紧） |
   * | `node`       | `node`     | **冗余**（③） |
   * | DOM          | `node`     | **矛盾**（②） |
   * | DOM          | 基本档环境 | **冗余**（③） |
   * | DOM          | `jsdom`（基本档是别的 DOM 实现时） | **正当例外**，列入清单 |
   *
   * 最后一行是本档新增的那一格，也是唯一需要**额外**解释的一格：它既不是
   * 「两处说不同的话」（文件头在说「这份要 jsdom 的保真度」，目录档在说
   * 「默认跑便宜的 happy-dom」，两句都对），也不是「两处说同一句话」。
   * 判据把它**列出来**而不是判它违规 —— 它是正当写法，但必须看得见（见文末）。
   */
  const conflicts = [];
  /** 文件头声明了 jsdom 的用例 —— DOM 档的**例外档**，单独点名（见下）。 */
  const jsdomExceptions = [];
  const redundantHeads = [];

  for (const { rel } of files) {
    const tier = tierOf(rel);
    if (tier === null) {
      continue;
    }
    const tierEnv = envOfTier[tier];
    if (tierEnv === undefined) {
      console.error(
        `[ERROR] 档 \`${tier}\` 在 \`vitest.config.ts\` 里没有可识别的 \`environment\`。\n` +
          "        本判据按那个值比对文件头 —— 读不到就判失败，不静默放过（同 §11.17.4）。",
      );
      return 1;
    }
    const env = declaredEnv(rawByRel.get(rel));
    if (!env) {
      continue;
    }

    if (tierEnv === "node") {
      /* node 档：只有「文件头也写 node」才是冗余；写 DOM 头是正当写法。
       * ⚠️ 这里**不能**直接 `continue` —— 那会把「node 档里的 node 头」
       * 这条冗余漏掉（本轮改分档时当场漏过一次，由门禁自测逮住）。 */
      if (env === "node") {
        redundantHeads.push({
          rel,
          kind: "冗余文件头",
          detail:
            "目录档已经给出 node —— 文件头是同一个结论的第二个来源，删掉它（同一件事只留一个来源）",
        });
      }
      continue;
    }

    /* 到这里：该用例落在 DOM 档（基本档 `tierEnv`）里。 */
    if (env === "node") {
      conflicts.push({
        rel,
        kind: "目录档与文件头矛盾",
        detail: `该用例落在 ${tier} 档的 include 里（environment: ${tierEnv}），文件头却写着 node`,
      });
      continue;
    }
    if (env === tierEnv) {
      /* ③ 冗余文件头 —— 两处给出**同一个结论**。 */
      redundantHeads.push({
        rel,
        kind: "冗余文件头",
        detail:
          `目录档已经给出 ${tierEnv} —— 文件头是同一个结论的第二个来源，删掉它` +
          `（同一件事只留一个来源）`,
      });
      continue;
    }
    /* 剩下的那一格：DOM 档 + 文件头写了另一种 DOM 实现（`jsdom`）。
     * 这是本档的新增正当写法，**记账不判红**。 */
    jsdomExceptions.push(rel);
  }

  const all = [...problems, ...conflicts, ...redundantHeads];

  /* jsdom 例外清单**不是**待办，是**账**：DOM 档默认 happy-dom 的全部意义就是
   * 「只有真的需要 jsdom 时才付它的钱」，所以每一份例外都该看得见 ——
   * 否则它会悄悄涨成「半个套件都在 jsdom 上跑」而没人发现。
   * `--report` 与常规检查都打出来；**不参与退出码**（它们是正当写法）。 */
  if (jsdomExceptions.length > 0) {
    console.log(
      `\n[test-env] 本档例外：${jsdomExceptions.length} 份用例用文件头改到 jsdom` +
        `（DOM 档默认 happy-dom）——`,
    );
    for (const rel of jsdomExceptions) {
      console.log(`  · ${rel}`);
    }
    console.log(
      "  新增例外前先确认「happy-dom 真的做不到」（具体到哪一条 API / 行为），" +
        "口径见 docs/standards/11-测试与可观测性.md §11.17。",
    );
  }

  if (all.length === 0) {
    if (REPORT_ONLY) {
      console.log(`[test-env] 盘点：${files.length} 份用例，无问题。${note}`);
    } else {
      console.log(
        `[test-env] OK —— ${files.length} 份用例：无环境早退，无目录档矛盾，无冗余文件头。${note}`,
      );
    }
    return 0;
  }

  console.error(
    `${
      REPORT_ONLY
        ? `[test-env] 盘点：${all.length} 处待办（--report 不判失败）`
        : `[ERROR] 用例的环境档有 ${all.length} 处问题`
    }：\n`,
  );
  for (const p of all) {
    console.error(`  · ${p.rel}${p.line ? `:${p.line}` : ""}  [${p.kind}]`);
    console.error(`      ${p.detail}`);
  }
  console.error(
    `\n修法：` +
      `\n  · 「环境早退」：别把结论挂在环境的一个全局默认值上。要覆盖 SSR / 无 window 分支，\n` +
      `    就**把条件造出来**：\`vi.stubGlobal("window", undefined)\` + 断言（配 \`afterEach(vi.unstubAllGlobals)\`）。\n` +
      `    仓里现成样板：src/lib/app-events.test.ts 的「无 \`window\` 时订阅给一个空操作…」那条。\n` +
      `  · 「目录档与文件头矛盾」：两者必有一处过时 —— 要么用例挪错了目录，要么文件头该改。\n` +
      `    别只改一边凑绿：那正是这条判据要照出来的改动。\n` +
      `  · 「冗余文件头」：删掉这一行 \`// @vitest-environment …\` 即可（目录档已给出同结论）。\n` +
      `    列清单：\`node scripts/check-test-environment.cjs --report\`。\n` +
      `  口径见 docs/standards/11-测试与可观测性.md §11.17。${note}`,
  );
  return REPORT_ONLY ? 0 : 1;
}

process.exit(main());
