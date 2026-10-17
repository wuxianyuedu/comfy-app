/**
 * ci-incremental-gates.mjs — 平台侧（`.cnb.yml`）门禁的**增量判据登记表**
 *
 * 干什么：回答「哪些 stage 可以在『本次改动没碰到它的扫描面』时跳过」，并把这件事
 * 变成 `.cnb.yml` 里的 `ifModify` 与这张表**双向同源**的一条机器判据。
 *
 * 为什么需要它（用户的诉求，ISSUE #1981）：平台侧流水线此前**任何**改动都跑满
 * 全部 stage —— 改一行 README 也要重跑「函数长度」「跨文件重复块」「ComfyUI 端口
 * 口径」这些**只扫 `src/**`** 的判据。本地钩子早就解决了同一件事
 * （`scripts/gate-scan-read.cjs` 的 `skipUnlessStagedTouches()`：暂存改动一点都没
 * 落在扫描面内就跳过），而那条通道**只在本地存在** —— 平台侧那条流水线不知道
 * 「扫描面」这回事，于是它把同一份判据在同一个文件上重跑了一遍。
 *
 * ── 为什么平台侧的机制是 `ifModify` 而不是复用 `--staged` ───────────────
 *
 * `.cnb.yml` 的 stage 支持 `ifModify: [glob…]`（CNB 官方语法手册
 * `zh/build/grammar.md` 的 `#stage-ifmodify`），语义与 `skipUnlessStagedTouches()`
 * **逐字同义**：变更文件一个都不落在给定 glob 内 ⇒ 这一步不执行。
 * 官方明确它支持 `PR` 触发的事件（「PR 触发的事件，统计 PR 中的变更文件」），
 * 正是本流水线要跑的那一类。**新建分支的 push 事件忽略 `ifModify`**（没有对比基准）
 * ⇒ 全部照跑 —— 那是「宁可多跑」的方向，安全。
 *
 * ── 谁可以跳过、谁绝对不行（这张表只收前者）─────────────────────────────
 *
 * 收进这张表的门槛是**它的扫描面是封闭的**：判据只读一个（或几个）能穷举的目录，
 * 而这个目录与 `.cnb.yml` 里写的 glob 是同一件事。三条必要条件：
 *
 *   ① **扫描面封闭且可穷举** —— 脚本里有 `SCAN_DIR` / `SCAN_DIRS` / `SCAN_ROOTS`
 *      这类常量（也就是它本地那一档 `skipUnlessStagedTouches()` 用的同一份根）；
 *   ② **没人能「从别处」把它弄红** —— 判据的违规只可能出现在扫描面内的文件里；
 *   ③ **它自己不判全库级不变量** —— 例如「日志实现只有一处」「仓储只有一种取用法」
 *      这类判的是**跨全仓的单一事实源**，任何一处改动都可能破坏它。
 *
 * 反过来说，下面这些**一律不进表**（它们的域要么是全仓、要么是本次流水线的前提）：
 *
 *   · 前提类（`工具链自证` / `Python 可用性` / `Python 探针读数` / `环境前提` /
 *     `Install dependencies` / `分支守卫` / `同步数据库表结构`）—— 后面每一步都
 *     依赖它们，跳过等于让「没跑」看起来像「过了」；
 *   · 全仓不变量（`类型检查` / `文件结构硬规则` / `UI/逻辑分离` / `零消费导出` /
 *     `lib Node-only 声明` / `core` 那三条 / `格式化提交分离`）—— 它们的扫描面是
 *     整个 `src/**` + `scripts/**` + `tests/**`，收窄成任何子集都是漏判；
 *   · 文档面三条 —— 判的是 `docs/**` 与 `docs/api/**`、`docs/generated/**` 生成物
 *     与源码同不同步，**源码与产物两边都要看**，域不是「改了 `src`」而是「两边都得对」；
 *   · `生产构建` / `浏览器安装` / `E2E 关键流程` —— 产物与端到端链路，任何改动都可能
 *     影响（`next build` 的失败可以由一个 import 引起），且它们判的正是「整仓能不能
 *     起来」；`浏览器安装` 是 E2E 的前提、`E2E` 依赖它。
 *
 * ── 这张表怎么被守（不许静默漂移）─────────────────────────────────────────
 *
 * `tests/ci-incremental-gates.test.ts` 双向核对：
 *   · 表里每一条 ⇒ `.cnb.yml` 里同名 stage **确实**带着那组 `ifModify`（写漏 / 写错
 *     glob 都红）；
 *   · `.cnb.yml` 里带 `ifModify` 的 stage ⇒ **必须在表里**（有人绕过登记表直接加一条
 *     `ifModify` 也红 —— 否则「谁被收窄了」这件事就没有唯一出处）。
 *
 * 顺带一个后果值得写清楚：**`.cnb.yml` 里没有 `ifModify` 的 stage 就是「任何改动都跑」**，
 * 这是默认档，也是这份表存在的意义 —— 它让「哪几条被收窄了」变成一份读得出来的清单，
 * 而不是散在 500 行 YAML 里的 10 处 `ifModify`。
 *
 * ── 能机械导出的就**不手抄**（ISSUE #1981 收尾）────────────────────────────
 *
 * 环境类的 globs 由上面的条件手写（「脚本里有 `SCAN_DIR`」正是它们的判据）；而
 * `API 文档生成物与源同步` 那一档**有**一份更硬的事实源：判据自己的 `INPUT_RES`
 * （`scripts/check-docs-api.cjs`，第 4 条写着「触发面 = typedoc 的输入面」）。
 * 手抄一份 glob 与它逐字等价，只会多一处会漂的副本 —— 所以那一档的 globs 由
 * `INPUT_RES` **反推**（`globFromInputRe`），改判据的触发面时配置跟着变，
 * 不需要有人记得改两份。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/* `API 文档生成物与源同步` 的触发面**不手抄**：判据自己的 `INPUT_RES` 才是它的事实源
 * （文件头第 4 条：「触发面 = typedoc 的输入面」）。`.cjs` 用 `require` 拿 —— 本文件是
 * `.mjs`，`createRequire` 是跨模块系统唯一不靠 `.default` 猜测的那条路。 */
const { INPUT_RES: DOCS_API_INPUT_RES } = createRequire(import.meta.url)(
  "./check-docs-api.cjs",
);

/**
 * 把一条「锚定到仓库根的输入面正则」反推成 `ifModify` glob。
 *
 * 只认本表实际出现过的两种形状，认不出的**直接抛**（比返回一个猜出来的 glob 强：
 * 猜窄了 = 静默漏跑，猜宽了 = 静默白跑，两种都没有任何信号）。两条与
 * `check-docs-api.cjs` 的 `INPUT_RES` 逐条对应：
 *
 *   /^src\/lib\/.*\.ts$/   ⇒ `src/lib/**`   —— 「目录 + 任意文件」那一支；
 *   /^typedoc\.json$/        ⇒ `typedoc.json` —— 单个文件那一支。
 *
 * 做法是**先去掉正则的转义再按字面读**：`INPUT_RES` 里的 `\\/` 与 `\\.` 是正则意义上的
 * 斜杠与点，转义留着会把它们读成「目录分隔符以外的什么东西」，反推出来的 glob 全是怪的。
 *
 * ⚠️ 单文件那支刻意返回**带扩展名的全名**：`package.json` 若写成 `package.*`，
 * glob 语义会把 `package-lock.json` 一起收进来，而它不是这一档的输入面。
 *
 * @param {RegExp} re 锚定到仓库根的输入面正则
 * @returns {string}
 */
function globFromInputRe(re) {
  const src = re.source
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    /* 去掉正则的转义前缀（`\\/` → `/`、`\\.` → `.`）：留下的是它**要匹配的字面文本**。 */
    .split(String.fromCharCode(92))
    .join("");
  const dir = /^([^*]+)\/\.\*\.\w+$/.exec(src);
  if (dir?.[1] !== undefined) return `${dir[1]}/**`;
  if (!src.includes("*")) return src;
  throw new Error(
    `ci-incremental-gates: 认不出这条输入面正则的形状（反推不出 ifModify glob）：${re}`,
  );
}

/**
 * stage 名 → 它的扫描面（`ifModify` glob 列表）。
 *
 * `globs` 里每一条都必须是 **`.cnb.yml` 里原样出现**的字符串：判据做的是字面比对，
 * 写在这里与写在那里是同一份事实的两个副本，漂了当场红。`why` 是给下一个人看的
 * 「为什么这条收窄是安全的」——它指向那份判据脚本里的常量名（那才是扫描面的
 * 唯一权威），别在这儿复述成第二份会过期的定义。
 *
 * @type {ReadonlyArray<{name: string, globs: readonly string[], why: string, script: string}>}
 */
export const INCREMENTAL_GATES = [
  {
    name: "标题行让位",
    globs: ["src/components/**", "src/app/**"],
    script: "scripts/check-title-bar-clearance.cjs",
    why: '扫描面是 SCAN_DIRS = ["src/components", "src/app"]（本档唯一入口 full-screen-layer 的消费方也只能在这两处）。它判的是「顶层浮层必须让出标题行」，而浮层只可能写在视图层。',
  },
  {
    name: "import 别名统一",
    globs: ["src/**", "e2e/**"],
    script: "scripts/check-import-alias.cjs",
    why: '扫描面是 SCAN_DIRS = ["src", "e2e"]（只看静态模块说明符，只可能出现在这两个目录的 .ts/.tsx 里）。',
  },
  {
    name: "ComfyUI 端口口径",
    globs: [
      "src/lib/comfyui/**",
      "src/lib/app-settings/**",
      "src/lib/endpoints.ts",
    ],
    script: "scripts/check-comfyui-port-contract.cjs",
    why: "读的是 CLIENT / LIFECYCLE / DERIVE / DESKTOP 四份 comfyui 文件与 SETTINGS_PURE / SETTINGS_IO / ENDPOINTS 三处端口来源 —— 域就是这几个点，故 globs 列出它们所在的目录与文件。",
  },
  {
    name: "内联样式注入",
    globs: ["src/**"],
    script: "scripts/check-inline-style.cjs",
    why: '扫描面是 SCAN_DIR = "src"（渲染出的 <style> 只可能写在 src 下的 .ts/.tsx 里）。',
  },
  {
    name: "跨文件重复块",
    globs: ["src/**"],
    script: "scripts/check-code-duplication.cjs",
    why: '扫描面是 SCAN_DIR = "src"（孪生对只在 src 的应用代码里找，测试与快照被排除）。',
  },
  {
    name: "函数长度 TS",
    globs: ["src/**"],
    script: "scripts/check-function-length.cjs",
    why: '扫描面是 SCAN_DIR = "src"（脚本与用例的自查由 check-infra-file-size.cjs 另管，不在本判据里）。',
  },
  {
    name: "函数长度 Rust",
    globs: ["src-tauri/src/**"],
    script: "scripts/check-rust-function-length.cjs",
    why: "扫描面是 src-tauri/src/**（Rust 壳的源码，TS 侧文件一个都不看）。",
  },
  {
    name: "模块循环依赖",
    globs: ["src/**"],
    script: "scripts/check-circular-deps.cjs",
    why: '扫描面是 SCAN_DIRS = ["src"]（import 图只在 src 内求强连通分量）。',
  },
  {
    name: "主题色扫描",
    globs: ["src/**"],
    script: "scripts/check-theme-colors.cjs",
    why: '扫描面是 SCAN_DIR = "src"（写死的色值只可能出现在 src 下的 .ts/.tsx）。',
  },
  {
    name: "跨平台动作对照",
    globs: [
      "package.json",
      "tools/**",
      "scripts/**",
      "src-tauri/**",
      "README.md",
      "docs/standards/launch-and-build.md",
    ],
    script: "scripts/check-ps1-consistency.mjs",
    why: "它核对的是「§9.5 对照表（住在 docs/standards/launch-and-build.md）⇄ 盘上的 .ps1 / .mjs 入口 / package.json 脚本 / tools 索引 / README 速查节」这几边，故域含那份文档与 README —— 少列一处就会在「只改 README 那一节」时漏跑。",
  },
  {
    name: "CHANGELOG 碎片",
    globs: ["changelog.d/**", "CHANGELOG.md"],
    script: "scripts/check-changelog-fragments.cjs",
    why: "只看 changelog.d/** 的碎片形态与 CHANGELOG.md 有没有被直接改（`[Unreleased]` 段落）。与本次代码改动无关时不该重跑。",
  },
  {
    name: "API 文档生成物与源同步",
    /* ⚠️ 这一档的 globs **不手抄** —— 由判据自己的 `INPUT_RES` 反推（见文件头
     * 「能机械导出的就不手抄」）。于是「产物由哪些输入决定」只有一处出处：
     * `scripts/check-docs-api.cjs` 的 `INPUT_RES`。 */
    globs: DOCS_API_INPUT_RES.map(globFromInputRe),
    script: "scripts/check-docs-api.cjs",
    why:
      "它的触发面本来就是判据自己声明的那一份：`check-docs-api.cjs` 的 `INPUT_RES`（typedoc 的 entryPoints 三条 glob + `typedoc.json` + 依赖声明），文件头第 4 条写的就是「触发面 = typedoc 的输入面」。" +
      "本条的 globs 由那份常量机械反推（`globFromInputRe`），所以它不是第二份会漂的副本 —— 改判据的输入面时配置跟着变。" +
      "收窄安不安全：输入没变，typedoc 的产物不可能漂（判据比的是「重生成结果 ⇄ docs/api」），所以「一行 src 都没碰的 PR」不该为它付那 200 秒 ——" +
      "它是本档在自托管节点上最贵的一格（实测 201.8s，占整条流水线 12m14s 的 27.5%）。",
  },
  {
    name: "覆盖率上报",
    globs: ["src/**", "tests/**", "vitest.config.ts"],
    script: "scripts/ci-coverage-report.mjs",
    why:
      "它**不判任何东西**（ISSUE #1990）：只把 `coverage/lcov.info` 交给平台的上报通道，" +
      "而那份产物只可能由这三处决定 —— 用例与源码（`src/**` / `tests/**`）与覆盖率面声明（`vitest.config.ts`），" +
      "三者一个都没碰时报告（如果有）与上一次逐字节同源，重报一遍不会写出新的读数。" +
      "收窄的方向是安全的：它缺报告时**跳过而不是判红**（`单元测试` 被临时停用时报告本来就不存在），" +
      "所以「本不该跑却跑了」与「该跑没跑」都不会改变任何代码结论。",
  },
  {
    name: "生成态文档与源同步",
    globs: [
      "docs/**",
      "src/**",
      "package.json",
      "pnpm-workspace.yaml",
      "next.config.js",
    ],
    script: "scripts/render-doc-placeholders.cjs",
    why:
      "它判的是「编辑态文档 ⇄ docs/generated/** 产物」，而两侧的输入面都能点清：产物只由 SCOPED_DOCS（都在 docs/**）与 FACTS 的提取源决定，后者是源码 / 配置里的真实值（src/**、package.json、pnpm-workspace.yaml、next.config.js）。" +
      "README.md / AGENTS.md 刻意**不在** globs 里：它们不在 SCOPED_DOCS 中（AGENTS.md 不进生成面，见 §13.5.5 那条注释），改了它们不可能让这一步红。" +
      "⚠️ 代价写在明处：FACTS 新增一条读别的文件的事实、而那个文件不在这份 globs 里时，改它不会触发本步 —— 所以新增事实要同批回来看这一行（`doc-facts.cjs` 的提取源就是这份清单的权威）。" +
      "这一步同时是 `--autofix` 档（ISSUE #1981），收窄之后「只改了代码、一次都没碰文档」的那类 PR 也不再为它付钱。",
  },
];

/** 表里登记的名字集合（判据与自测都用它，避免各处重算）。 */
export const INCREMENTAL_GATE_NAMES = new Set(
  INCREMENTAL_GATES.map((g) => g.name),
);

/**
 * 从 `.cnb.yml` 原文里解析出**每个 stage 的 `ifModify` 清单**。
 *
 * 解析口径与 `tests/no-platform-ci-config.test.ts` 的 `stageTimeouts()` 同构
 * （那一条已经在解析 `.cnb.yml`）：stage 列表项 = 恰好两空格缩进的 `- name: X`，
 * 它下面的 `ifModify:` 与随后的列表项属于它. `ifModify` 既可能是单行字符串，
 * 也可能是 `- glob` 形态的列表 —— 两种都读。
 *
 * 本函数只回答「配置里写了什么」，判据（该不该写、写得对不对）在测试那一侧。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {Map<string, string[]>} stage 名 → `ifModify` globs
 */
export function parseStageIfModify(text) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  const lines = text.split("\n");
  let current = null;
  let mode = null; // "list" | "scalar"

  for (const raw of lines) {
    // stage 列表项：恰好两空格缩进的 `- name: X`（`stages:` 的直接子项）。
    const item = /^ {2}-\s+name:\s*(\S.*?)\s*$/.exec(raw);
    if (item?.[1] !== undefined) {
      current = item[1];
      mode = null;
      continue;
    }
    // 同级或更浅的键 = 这一项结束了（`env:`、顶层 `master:` 等）。
    if (current !== null && /^\S/.test(raw)) current = null;
    if (current === null) continue;

    // `ifModify:` 开一行（缩进 4 空格，与 `script:` / `timeout:` 同级）。
    const head = /^ {4}ifModify:\s*(.*?)\s*$/.exec(raw);
    if (head) {
      const inline = head[1];
      if (inline && !inline.startsWith("#")) {
        // 单行标量形态（`ifModify: "src/**"`）—— 去掉可能有的引号。
        mode = null;
        out.set(current, [inline.replace(/^["']|["']$/g, "")]);
      } else {
        // 列表形态，后续 6 空格缩进的 `- glob` 属于它。
        mode = "list";
        out.set(current, []);
      }
      continue;
    }
    if (mode === "list") {
      const li = /^ {6}-\s+(\S.*?)\s*$/.exec(raw);
      if (li?.[1] !== undefined) {
        out.get(current)?.push(li[1].replace(/^["']|["']$/g, ""));
        continue;
      }
      /* 非列表项的行 = 这一段结束了（下一键 / 缩进变化 / 注释）。注释行不算结束 ——
       * 清单里的注释是说明，夹在中间很正常。 */
      if (!/^\s*#/.test(raw) && raw.trim() !== "") mode = null;
    }
  }
  return out;
}

/**
 * 读仓库根上的 `.cnb.yml`（判据与自测的唯一入口，别各自拼路径）。
 * @returns {string}
 */
export function readCnbConfig(root = ROOT) {
  return fs.readFileSync(path.join(root, ".cnb.yml"), "utf8");
}

/**
 * 校验 `.cnb.yml` 与登记表是否双向同源。
 *
 * 这一份是**判据本体**，`tests/ci-incremental-gates.test.ts` 与 `--check` 档
 * 共用同一次结论（不造第二轮子，§12.18）。返回空数组 = 一致。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {string[]} 逐条不一致（人读的话术）
 */
export function checkIncrementalGates(text) {
  const actual = parseStageIfModify(text);
  /** @type {string[]} */
  const problems = [];

  // 方向一：表里每条 ⇒ 配置里必须有同名 stage 且 globs 逐字一致。
  for (const gate of INCREMENTAL_GATES) {
    const got = actual.get(gate.name);
    if (got === undefined) {
      problems.push(
        `\`${gate.name}\` 在登记表里，但 .cnb.yml 里没有它的 \`ifModify\` —— ` +
          `「收窄名单」与配置漂了：要么补上 \`ifModify\`（${gate.globs.join(", ")}），` +
          `要么把它从 scripts/ci-incremental-gates.mjs 的 INCREMENTAL_GATES 里删掉`,
      );
      continue;
    }
    const want = [...gate.globs];
    if (got.length !== want.length || got.some((g, i) => g !== want[i])) {
      problems.push(
        `\`${gate.name}\` 的 \`ifModify\` 与登记表不一致：配置 [${got.join(", ")}] ` +
          `≠ 表 [${want.join(", ")}]（${gate.script}）`,
      );
    }
  }

  // 方向二：配置里带 `ifModify` 的 stage ⇒ 必须在表里（不许绕过登记表直接收窄）。
  for (const name of actual.keys()) {
    if (!INCREMENTAL_GATE_NAMES.has(name)) {
      problems.push(
        `\`${name}\` 在 .cnb.yml 里带着 \`ifModify\`，但不在登记表里 —— ` +
          `「哪几条被收窄了」必须只有一处出处：把它登记进 ` +
          `scripts/ci-incremental-gates.mjs（含「为什么这条收窄是安全的」），` +
          `或者去掉那条 \`ifModify\`（默认档 = 任何改动都跑，这是安全方向）`,
      );
    }
  }

  return problems;
}

/**
 * `--check` 档：把上面那份结论转成退出码（CI / 本地随手跑）。
 * 逻辑只在 `checkIncrementalGates()` 一处，本函数不重写判据。
 */
function main() {
  const problems = checkIncrementalGates(readCnbConfig());
  if (problems.length === 0) {
    console.log(
      `[ci-incremental] ✓ .cnb.yml 与登记表一致：${INCREMENTAL_GATES.length} 条 stage 带 ifModify（其余任何改动都跑）`,
    );
    return 0;
  }
  console.error(
    `[ci-incremental] ✗ 平台侧门禁的增量登记与配置不一致（${problems.length} 条）：`,
  );
  for (const p of problems) console.error(`[ci-incremental]   · ${p}`);
  return 1;
}

/* 「是不是被直接执行」按 Node 自己的口径判 —— 这条踩过（ISSUE #1961 最后一格：
 * `file://${path.resolve(...)}` 在 Windows 上恒不相等，main() 一次都不跑、进程退 0）。
 * 用 argv[1] 与当前文件的 realpath 比较，平台无关。 */
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main());
}
