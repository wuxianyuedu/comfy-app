#!/usr/bin/env node
// @ts-nocheck
/**
 * check-doc-references.cjs — 文档引用一致性校验（pnpm doc:check）
 *
 * 解决 ISSUE #242「文档里的硬编码值/路径与代码脱钩，改动易遗漏」。
 * 核心思路（单一事实）：真实值只存在于源码/配置，本脚本运行时从权威源动态提取，
 * 再与文档比对。不依赖任何"手工登记值"。
 *
 * 校验模式：
 *   - kind 'placeholder'（文件名值，如 exe 名 / splash）：文档应使用占位符替代裸值；
 *     若文档出现裸值 → 报错引导改用占位符（防回潮）。占位符语义可读（见登记表 meaning）。
 *   - kind 'verify'（端口/地址）：文档保留直观原样（如 localhost:3100，可读性最佳），
 *     脚本提取文档里出现的 `host:port` 形态，与权威源当前端口族比对；不一致 → 报错。
 *   - kind 'path'：文档保留路径原文，脚本核对路径指向的文件确实存在。
 *   - 台账命令口径：SCOPED_DOCS 里不得出现 npm run / npx 可执行命令
 *     （AGENTS 硬规则 1「只用 pnpm」；说明性引用需带纠正词，见 checkLedgerCommands）。
 *   - 门禁步骤引用口径：规范文档/索引里不得用「第 N 步」引用 pre-commit 或已删除的平台流水线，
 *     须写日志里打印的标签（ISSUE #1374；见 checkGateStepIndexRefs）。
 *
 * 接入方式：`.githooks/pre-commit` D 组的静态判据之一（`pnpm doc:check` 是同一条命令的手动入口，
 * `pnpm doc:gen` 也把它放在第 1 步）。**曾是「手动档」**，脚本此处旧写「不接 pre-commit（避免
 * 过度打扰提交）」—— 那个理由撑不住：实测 0.64s、零网络、纯本地文本，而 §13.5.4 把「不进钩子」
 * 的依据记在网络与耗时上（`dependencyAudit` 才是那一档）。真正的代价在别处：AGENTS 规定的必跑
 * 口令是 `pnpm doc:render`，而它只做「源 → 生成物」、不跑本校验，于是按规范走的人一路绿灯，
 * 存量要靠事后单独一刀清（`c4d414d5`）。签字翻档见 ISSUE #1371。
 * 人类可读映射见 docs/reference-facts.md；FACTS 与提取逻辑见 scripts/doc-facts.cjs
 * （本脚本与 doc:render 共用，避免第二事实）。
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  ROOT,
  SCOPED_DOCS,
  SCOPED_DOC_DIRS,
  SCOPED_DOC_EXEMPTIONS,
  FACTS,
  readText,
  exists,
  extractDevHostPort,
  extractFallbackPorts,
} = require("./doc-facts.cjs");

const problems = [];

// 代理自动加载的唯一导航文件（AGENTS 硬规则 15 前置阅读的第一站）。
// 与 docs/** 不同：它不含 {{占位符}}、也不进 render-doc-placeholders 的生成面；
// 台账命令口径守卫（C4）与 checkAgentsMdDrift（C1/C2/C3）都以它为判据对象。
const AGENTS_MD_PATH = "AGENTS.md";

function checkFactKeysMatchDocs() {
  if (!exists("docs/reference-facts.md")) {
    problems.push("缺少 docs/reference-facts.md 登记表");
    return;
  }
  const md = readText("docs/reference-facts.md");
  for (const f of FACTS)
    if (!md.includes(f.key)) problems.push(`登记表缺少事实 key：${f.key}`);
  const mdKeys = [...md.matchAll(/\| `([a-z][a-z0-9_.]+)` \|/g)].map(
    (m) => m[1],
  );
  for (const k of mdKeys)
    if (!FACTS.some((f) => f.key === k))
      problems.push(`登记表有多余/脚本未支持 key：${k}`);
}

/* ── 校验范围守卫（ISSUE #316）─────────────────────────────────────────
 * 目的：让「新增规范文档忘了登记 → 静默不校验」这件事变成硬错误。
 *
 * 判定：遍历 SCOPED_DOC_DIRS 下的每个 .md，
 *   - 在 SCOPED_DOCS 里 → 正常校验；
 *   - 在 SCOPED_DOC_EXEMPTIONS 里 → 跳过（但必须附了理由）；
 *   - 两者都不在 → 报错，提示「登记进 SCOPED_DOCS」或「写进豁免名单并附理由」。
 * 同时校验豁免名单本身：理由为空、或指向不存在的文件 → 也算问题（防止名单
 * 变成张贴过期条目的垃圾桶）。
 */
function checkScopeCoverage() {
  const scoped = new Set(SCOPED_DOCS);
  for (const dir of SCOPED_DOC_DIRS) {
    const absDir = path.join(ROOT, dir);
    if (!fs.existsSync(absDir)) {
      problems.push(
        `校验范围守卫：目录不存在 ${dir}（SCOPED_DOC_DIRS 需与仓库结构一致）`,
      );
      continue;
    }
    const walk = (abs) => {
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const full = path.join(abs, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".md")) continue;
        const rel = path.relative(ROOT, full).split(path.sep).join("/");
        if (scoped.has(rel) || rel in SCOPED_DOC_EXEMPTIONS) continue;
        problems.push(
          `校验范围守卫：${rel} 既未登记进 SCOPED_DOCS、也不在豁免名单里——` +
            `新增规范文档必须二选一（登记则参与校验；豁免则须在 scripts/doc-facts.cjs 的 ` +
            `SCOPED_DOC_EXEMPTIONS 里写明理由），不允许静默跳过。见 docs/reference-facts.md §3。`,
        );
      }
    };
    walk(absDir);
  }
  for (const [rel, reason] of Object.entries(SCOPED_DOC_EXEMPTIONS)) {
    if (!reason || !reason.trim()) {
      problems.push(
        `校验范围守卫：豁免名单条目 ${rel} 没有写理由（豁免必须可核验）`,
      );
    }
    if (!exists(rel)) {
      problems.push(
        `校验范围守卫：豁免名单条目 ${rel} 指向的文件不存在——过期条目应删除`,
      );
    }
  }
}

function bareValueOccurs(text, value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w.-])${escaped}(?![\\w.-])`, "g").test(text);
}

function extractDocHostPorts(text) {
  const ports = new Set();
  const re = /(?:localhost|127\.0\.0\.1):(\d+)/g;
  let m;
  while ((m = re.exec(text))) ports.add(Number(m[1]));
  return [...ports];
}

function checkVerify(text, docPath, f) {
  const kind = f.key;
  try {
    if (kind === "dev.host") return; // host 双形态等价
    if (kind === "dev.port.derived") {
      // 解析链（`pnpm dev` / `pnpm start`：.env → 检出路径推导 → 兜底 3100）的端口。
      // 描述 pnpm dev 语境的文档必须写**本检出真实推导值**，写静态 devUrl 值（兜底
      // 3100）会让人照着打开一个没人监听的端口 = ERR_CONNECTION_REFUSED（ISSUE #489）。
      const derivedPort = String(f.extract());
      const docPorts = extractDocHostPorts(text);
      if (!docPorts.length) return; // 本文档没写具体地址，跳过
      if (!docPorts.map(String).includes(derivedPort)) {
        problems.push(
          `[${docPath}] 文档 dev 地址端口 ${docPorts.join(" / ")} 未包含本检出按路径推导的端口 ${derivedPort}` +
            `（pnpm dev / pnpm start 的实际监听端口，见 scripts/app-port.mjs）。` +
            `照文档地址打开会 ERR_CONNECTION_REFUSED；请改为 ${derivedPort} 或写成「解析值」而非固定数字。`,
        );
      }
      return;
    }
    if (kind === "dev.port" || kind === "dev.port.fallback") {
      const { port } = extractDevHostPort();
      const candidates = extractFallbackPorts().map(Number);
      const allowed = new Set([port, ...candidates]);
      const docPorts = extractDocHostPorts(text);
      if (!docPorts.length) return;
      const hasDevFam = docPorts.some((p) => allowed.has(p));
      if (hasDevFam && !docPorts.includes(port)) {
        problems.push(
          `[${docPath}] 文档 dev 地址端口 ${docPorts.filter((p) => allowed.has(p)).join(" / ")} 未包含权威主端口 ${port}。请核对端口是否变更。`,
        );
      }
    }
    if (kind === "mcp.http.port") {
      // 仅当文档确实出现了 MCP 端口时才核对一致性；MCP 与 dev 端口族碰撞会
      // 让端口清理/监听检测把 MCP 误判成 dev server 实例——这是该 fact 的防回归点。
      const mcpPort = Number(f.extract());
      const docPorts = extractDocHostPorts(text);
      if (!docPorts.includes(mcpPort)) return; // 本文档未引用 MCP 端口，跳过
      const { port } = extractDevHostPort();
      const candidates = extractFallbackPorts().map(Number);
      const devFam = new Set([port, ...candidates]);
      if (devFam.has(mcpPort)) {
        problems.push(
          `[${docPath}] MCP HTTP 端口 ${mcpPort} 与 dev 端口族 ${[port, ...candidates].join("/")} 冲突，会将 MCP 监听误判成 dev server。请为 MCP 换独立端口。`,
        );
      }
    }
  } catch (e) {
    problems.push(`[${docPath}] 无法核对 ${f.key}（${e.message}）`);
  }
}

/* ── 台账命令口径守卫（AGENTS 硬规则 1 / §8.4 事实性漂移专项）──────────
 * 目的：让「台账里写着 npm run / npx，而项目只用 pnpm」这件事变成硬错误。
 *
 * 为什么单列一条：AGENTS 硬规则 1「包管理只用 pnpm，禁止 npx / npm run」，
 * 但文档里的命令不会编译、不会报错，只会静静过期——复核时就得靠人肉逐行读。
 * 台账（guides/ 下的清单/指南类文档）被反复引用为「怎么做」的依据，
 * 过期命令会直接误导执行者（历史上 PRODUCTION-GAPS.md 就写过 npm run test:e2e）。
 *
 * 豁免：允许**描述性引用**——即明确写出「原记录写作 npm 形式」「一律改为 pnpm」
 * 这类说明当前规则的上下文。判据：该行同时出现纠正词（改为/修正/pnpm/禁止/违反）
 * 即视为说明而非可执行命令。
 */
const NPM_CMD_RE = /(^|[\s`(（])(npm\s+run|npx)\b/;
const NPM_CMD_EXPLAIN_RE =
  /改为|修正|修正为|pnpm|禁止|违反|原记录|不要用|应使用/;

function checkLedgerCommands() {
  // AGENTS.md 是**代理自动加载**的仓库根导航文件，历史上「npm run test:e2e」这类
  // 硬规则 1 的违反最容易出现在这里；但它不含 {{占位符}}、不进 render-doc-placeholders
  // 的生成面，所以刻意不塞进 SCOPED_DOCS——在这里显式并入遍历集合。
  const ledgerDocs = [AGENTS_MD_PATH, ...SCOPED_DOCS];
  for (const doc of ledgerDocs) {
    if (!exists(doc)) continue;
    const lines = readText(doc).split("\n");
    lines.forEach((line, i) => {
      if (!NPM_CMD_RE.test(line)) return;
      if (NPM_CMD_EXPLAIN_RE.test(line)) return; // 说明性引用，放行
      problems.push(
        `[${doc}:${i + 1}] 出现 npm/npx 命令（AGENTS 硬规则 1「包管理只用 pnpm」）。` +
          `请改为 pnpm（如 npm run test → pnpm test）；若是在描述该规则本身，` +
          `补上「改为/修正/pnpm」等纠正词以标明是说明而非可执行命令。`,
      );
    });
  }
}

/**
 * 门禁步骤的引用口径：规范文档与索引里引用 `.githooks/pre-commit`（或已删除的平台流水线）
 * 的某一步，一律写**钩子日志里打印的标签**（`── check: <标签>`）或那一步跑的脚本名，
 * 不写「第 N 步」（ISSUE #1374）。
 *
 * 为什么单列一条：钩子早已是「组 0 + A/B/C/D 四个并行组」，「第 N 步」在这份形状上
 * **没有唯一解释**（同一份文档里混着「branch-guard 算第 1 步」与「判据从第 1 条起算」两种口径），
 * 而序号又不属于任何现有事实核（本脚本管硬编码值、路径存在性、端口、npm 命令字样）。
 * 结果是：每给 D 组追加一步，文档里那批数字就整体错位一次，表现不是红，是**指到别的判据上**。
 * 立案时的实测样本：UI 基元复用棘轮写作「第 12 步」（实际第 9 条）、生成态文档同步写作
 * 「第 26 步」（实际第 21 条）、三处把 C 组固定清单里的用例称作「第 23 步」。
 *
 * 判据范围刻意窄：同一行既要出现「第 N 步」，也要出现 pre-commit / `.githooks` / CI，
 * 所以「§2.2 第 5 步」「`prepare-local-run.ps1` 第 3 步」这类**有主人的过程序号**不受影响
 * —— 那种序号正是推荐形态（引用一份有顺序的程序的第几步）。
 *
 * 不扫 `changelog.d/**` 与 `CHANGELOG.md`：碎片是**当时那次变更的记录**，里面的序号是历史事实，
 * 改写历史等于伪造证据（AGENTS 硬规则 14 / §13.10.5）。边界由用例
 * `tests/check-doc-references.test.ts` 的「历史碎片不改写」钉住。
 *
 * 豁免：描述这条规则本身的句子（带 不写 / 别再 / 禁止 / 应写 / 一律 / 序号 / 已删 等纠正词）。
 */
const STEP_INDEX_RE = /第\s*\d+(?:\s*\/\s*\d+)?\s*步/;
const GATE_STEP_REF_RE = /pre-commit|\.githooks|\bCI\b/;
const STEP_INDEX_EXPLAIN_RE =
  /不写|别再|不要写|禁止|应写|应改|一律|改成|序号|没有唯一|已删|已随|历史/;

function checkGateStepIndexRefs() {
  // AGENTS.md 与两份索引（docs/README.md、README.md）都带「哪条判据在哪跑」这类表述，
  // 但都不在 SCOPED_DOCS 里（AGENTS 无占位符、索引不属于 docs/standards|guides 目录扫描面），
  // 所以在这里显式并入遍历集合 —— 与 checkLedgerCommands 同一手法。
  // `docs/reference-facts.md` 同理：它是**登记表本身**（FACTS 通过
  // `ASCII_ONLY_FACT_DOCS` 读它，不通过 SCOPED_DOCS），而「哪条判据在哪跑」正是写在这份文件里的，
  // 不并进来看不到它自己举例时用的旧序号。
  const gateDocs = [
    AGENTS_MD_PATH,
    "docs/README.md",
    "README.md",
    "docs/reference-facts.md",
    ...SCOPED_DOCS,
  ];
  for (const doc of [...new Set(gateDocs)]) {
    if (!exists(doc)) continue;
    const lines = readText(doc).split("\n");
    lines.forEach((line, i) => {
      if (!STEP_INDEX_RE.test(line)) return;
      if (!GATE_STEP_REF_RE.test(line)) return; // 过程序号（§x.y 第 N 步）与本条无关
      if (STEP_INDEX_EXPLAIN_RE.test(line)) return; // 描述这条规则本身，放行
      const hit = line.match(STEP_INDEX_RE)?.[0] ?? "第 N 步";
      problems.push(
        `[${doc}:${i + 1}] 用「${hit}」引用门禁步骤 —— 钩子已是组 0 + A/B/C/D 四个并行组，` +
          `序号没有唯一解释，追加一步就会整体错位（ISSUE #1374）。` +
          `请改写为标签形态：pre-commit 的 <组>「<标签>」（标签就是日志里 \`── check: <标签>\` 那一行），` +
          `或直接写那一步跑的脚本名；若这一行正是在描述本条口径，补「不写/禁止/序号」等纠正词。`,
      );
    });
  }
}

/**
 * §13.1「本地提交前必须通过」那份清单必须与 `.githooks/pre-commit` 的 D 组逐字一致
 * （ISSUE #1404 顺带收的那格漂移）。
 *
 * 为什么要有这条：那份清单是人 / 代理手跑全套门禁的唯一入口，而它已经漂了 ——
 * 立案时实测：钩子 D 组 27 步，清单里只有 21 步对得上（`check-ps1-consistency.mjs`、
 * `check-import-alias.cjs`、`check-ui-customizations.cjs`、`check-doc-references.cjs`、
 * `storybook-check.mjs` 五步进了钩子没进清单）。更要紧的是 **flag 层面的漂移**：
 * 清单写 `node scripts/check-file-structure.cjs`（不带 `--strict`），而钩子跑的是带它的那一档 ——
 * 照清单手跑的人会得出「R5 不拦」的结论，而同一节还写着「上面那份清单就是全文」。
 *
 * 所以比对的是**整条命令**（含 flag），不是脚本名：只比名字就正好漏掉上面那一格。
 * 组 0 / A / B / C 那四条命令没有 `  run "<标签>" <命令>` 形态（走 `run_group` 或直接调用），
 * 它们在清单里、不在 D 组里是事实，所以列进豁免集合，而不是把清单删成只剩 D 组。
 */
const HOOK_PATH = ".githooks/pre-commit";
const GATE_CHECKLIST_DOC = "docs/standards/13-提交与-code-review.md";
const CHECKLIST_MARKER = "本地提交前必须通过";
/** D 组之外的四条：组 0 分支守卫、组 A tsc、组 B eslint、组 C 受影响用例启动器。 */
const NON_D_GROUP_COMMANDS = new Set([
  "node scripts/check-branch-guard.cjs",
  "pnpm exec tsc --noEmit",
  "pnpm run lint",
  "node scripts/run-affected-tests.mjs",
]);

/** 钩子 D 组的命令（行首锚定 = 只认真调用，被 `# ` 注掉的行不算在场）。 */
function hookDGroupCommands(hookText) {
  return [...hookText.matchAll(/^ {2}run "([^"]+)" (.+)$/gm)].map((m) =>
    (m[2] ?? "").replace(/\s+/g, " ").trim(),
  );
}

/** §13.1 代码块里 `✅ <命令>  # 说明` 那份清单的命令部分。
 *  marker 那句「本地提交前必须通过…」本身就写在围栏**里面**，所以取 marker 之后
 * 遇到的**第一个** ``` 就是这份清单的收尾（别再往回找开围栏，那会切到散文上）。 */
function checklistCommands(docText) {
  const start = docText.indexOf(CHECKLIST_MARKER);
  if (start < 0) return null;
  const rest = docText.slice(start);
  const close = rest.indexOf("```");
  if (close < 0) return null;
  return rest
    .slice(0, close)
    .split("\n")
    .filter((l) => l.startsWith("✅ "))
    .map((l) => l.slice(2).split(/ +# /)[0].replace(/\s+/g, " ").trim());
}

function checkGateChecklistMatchesHook() {
  if (!exists(HOOK_PATH) || !exists(GATE_CHECKLIST_DOC)) return;
  const hookCmds = hookDGroupCommands(readText(HOOK_PATH));
  const docCmds = checklistCommands(readText(GATE_CHECKLIST_DOC));
  // 读不到清单本身就是红：静默返回 0 条会让这条判据空转
  // （下一节改了 marker 措辞或代码块形状，它就再也不比对任何东西）。
  if (!docCmds || docCmds.length === 0) {
    problems.push(
      `[${GATE_CHECKLIST_DOC}] 取不到「${CHECKLIST_MARKER}」那份命令清单 —— ` +
        "§13.1 与钩子的一致性判据没有比对对象。marker / 代码块形状变了就同步改这里。",
    );
    return;
  }
  const docSet = new Set(docCmds);
  const hookSet = new Set(hookCmds);
  for (const cmd of hookCmds) {
    if (docSet.has(cmd)) continue;
    problems.push(
      `[${HOOK_PATH}] 这一步真的在跑 \`${cmd}\`，但 ${GATE_CHECKLIST_DOC} 的 §13.1 清单里没有这条 ` +
        "（或 flag 与钩子不一致）。清单是手跑全套的唯一入口，漏一格 = 照着清单跑的人以为它不存在。",
    );
  }
  for (const cmd of docCmds) {
    if (hookSet.has(cmd) || NON_D_GROUP_COMMANDS.has(cmd)) continue;
    problems.push(
      `[${GATE_CHECKLIST_DOC}] §13.1 清单写着 \`${cmd}\`，但 ${HOOK_PATH} 的 D 组没有这一步 —— ` +
        "「上面那份清单就是全文」这句话已经不成立。要么把这一步接回钩子，要么从清单里删掉。",
    );
  }
}

function shouldApplyFactToDoc(f, docPath) {
  // onlyDocs：事实的主适用文档组（未命中即跳过）；otherDocs：额外适用文档，
  // 与主文档组取并集（同一值在另一篇文档里以别的形态出现时用，见 doc-facts.cjs）。
  if (
    f.onlyDocs &&
    !f.onlyDocs.includes(docPath) &&
    !(f.otherDocs || []).includes(docPath)
  )
    return false;
  if (f.excludeDocs && f.excludeDocs.includes(docPath)) return false;
  return true;
}

function checkDoc(docPath) {
  if (!exists(docPath)) {
    problems.push(`试点文档不存在：${docPath}`);
    return;
  }
  const text = readText(docPath);
  for (const f of FACTS) {
    if (!shouldApplyFactToDoc(f, docPath)) continue; // 事实声明了适用文档范围，未命中则跳过
    if (f.kind === "placeholder") {
      let realValue;
      try {
        realValue = f.extract();
      } catch (e) {
        problems.push(`[${docPath}] 无法提取 ${f.key}（${e.message}）`);
        continue;
      }
      const vals = Array.isArray(realValue) ? realValue : [realValue];
      for (const rv of vals) {
        if (!rv) continue;
        if (bareValueOccurs(text, rv)) {
          problems.push(
            `[${docPath}] 发现裸值 "${rv}"（对应 ${f.key}，应改用占位符 ${f.placeholder}）。见 docs/reference-facts.md。`,
          );
        }
      }
    } else if (f.kind === "verify") {
      checkVerify(text, docPath, f);
    }
  }
}

function checkPaths() {
  for (const f of FACTS) {
    if (f.kind === "path" && !exists(f.source)) {
      problems.push(`路径引用失效：${f.source}（key ${f.key}）。请核对登记表`);
    }
  }
}

/* ── AGENTS.md ↔ standards 漂移守卫 ────────────────────────────────────
 * 目的：让「AGENTS.md 里复述的路径 / 文件 / 章节锚点与实际仓库状态脱钩」
 *      这件事变成硬错误。
 *
 * 起因（2026-09-20 那次评审抓到两处具体漂移，同型问题至今仍在攒）：
 *   - AGENTS.md 声称门禁在 CI 跑而 §13.5 已随 ISSUE #623 下线；
 *   - 硬规则 22 里 `src/lib/workflow-io-types.ts` 示例路径实际在 workflow/ 子目录；
 *   - 本次上线时首跑又抓到一处：硬规则 12 表格里 `scripts/start_tauri_launcher.py`
 *     已随 #784 移除（启动器进壳、`shell_launch.rs` 自编排），AGENTS.md 未同步。
 *
 * 这类问题的共性：**不是规范条款错了，而是 AGENTS.md 的复述落后于源码/规范**。
 * 现有 SCOPED_DOCS 覆盖 docs/standards/**、docs/guides/**，AGENTS.md 恰好是
 * 代理自动加载却不在校验范围里的唯一导航文件——它一旦被机器读进 context，
 * 里面的过期路径就会直接把代理误导到错误位置。
 *
 * 判据（与 AGENTS 硬规则 24「复用优先」一致，不新写独立门禁）：
 *   C1/C3：AGENTS.md 里出现的**仓库相对路径**（反引号内、或 markdown 链接目标）
 *          必须存在于文件系统。仅当路径以允许前缀（scripts/、src/、tests/、
 *          docs/、tools/、.githooks/、src-tauri/、changelog.d/、public/、e2e/）
 *          开头，或属于允许根配置文件白名单（package.json / README.md / 等）
 *          时才纳入核对；其他形态（通配 `**` / 占位符 `<x>` / range `01~18` /
 *          `§` 章节号 / 代码符号 / 简称文件名）自动跳过。
 *   C2：3 行窗口内同一 bullet 里同时出现 `docs/standards/NN-*.md` 与 `§NN.M`
 *       时，去目标 standards 文件里定位 `^#{1,6}\s+(§)?NN.M\b` 锚点。仅覆盖
 *       「文件 + 章节号双写、但 §号在该文件里不存在」这一种确定性缺陷。
 *       launch-and-build.md（无 NN 前缀）、跨文件同名编号（§9.5 同时属于
 *       standards/09 与 launch-and-build）都不进入 C2 的匹配面。
 *   C4：checkLedgerCommands 把 AGENTS.md 与 SCOPED_DOCS 合并遍历，防 npm/npx
 *       命令表述漂移（AGENTS.md 不进 SCOPED_DOCS——它没有 {{占位符}}，
 *       进 SCOPED_DOCS 会被 render-doc-placeholders 生成一份 docs/generated/AGENTS.md
 *       副本，反而误导读者）。
 *
 * 不覆盖：同章节号存在但内容语义漂移（比如 §13.5 标题仍在但表述从「CI 兜底」
 *         改成「按需召唤」）——这类属于 review/人读，机器只挡「找不到」。
 */
const AGENTS_PATH_PREFIXES = [
  "scripts/",
  "src/",
  "tests/",
  "docs/",
  "tools/",
  ".githooks/",
  "src-tauri/",
  "changelog.d/",
  "public/",
  "e2e/",
];
const AGENTS_ROOT_FILES = new Set([
  "AGENTS.md",
  "README.md",
  "CHANGELOG.md",
  "package.json",
  "pnpm-workspace.yaml",
  "next.config.js",
  "eslint.config.js",
  "tsconfig.json",
  "vitest.config.ts",
  ".env.example",
  ".nvmrc",
  ".mcp.json",
  "db.sqlite",
]);

/* ── 运行期产物不该被要求存在（.gitignore 是判据，不靠人工记名单）────────
 * C1/C3 的语义是「AGENTS.md 里那个路径**指向的文件确实在仓库里**」。而
 * `db.sqlite` 这类是**运行期产物**：它被 `.gitignore` 忽略，任何干净检出
 * （CI / 新克隆 / 评审容器）都不存在，只有跑过 `pnpm db:push` 的开发机才有。
 * 把它登记进 AGENTS_ROOT_FILES 等于要求门禁恒红——实测 62283f41 加了这一项后
 * `pnpm doc:check` 一直报这一条，而「按提示去改 AGENTS.md」是错的：那句话本来就
 * 该提这个文件名（它讲的是「构建会把它复制进产物」，不是「仓库里有这个文件」）。
 *
 * 判据因此落在 `.gitignore` 上而不是「再列一份豁免名单」：被忽略 = 不进版本库 =
 * 不能要求存在。名单会漏、会随 .gitignore 漂移，.gitignore 不会。
 */
function gitignoredRootNames() {
  const gi = exists(".gitignore") ? readText(".gitignore") : "";
  const names = new Set();
  for (const raw of gi.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    // 只认「根级单名」形态（`db.sqlite` / `/db.sqlite`）：带斜杠的是子路径规则，
    // 与 AGENTS_ROOT_FILES（全是根级文件名）不同口径，别混进来。
    const name = line.replace(/^\//, "");
    if (name.includes("/")) continue;
    names.add(name);
  }
  return names;
}

/** `.gitignore` 里的根级单名集合（每次进程只算一次）。 */
const GITIGNORED_ROOT_NAMES = gitignoredRootNames();

/** 把一段反引号内容或链接 URL 判成「仓库相对路径」→ 返回规范化后的相对路径；不是则返回 null。 */
function looksLikeRepoPath(raw) {
  const p = raw.trim();
  if (!p) return null;
  // 通配、占位符、range、章节号、代码符号、URL、锚点、配置对、带参数的调用形态
  if (/[<>*~§()=\s]/.test(p)) return null;
  if (p.startsWith("#")) return null;
  if (/^[a-z]+:\/\//i.test(p)) return null;
  if (/^::?1$/.test(p) || /^[\d.]+$/.test(p)) return null; // ::1 或 IP
  const hasSlash = p.includes("/");
  if (!hasSlash) {
    return AGENTS_ROOT_FILES.has(p) ? p : null;
  }
  // 有斜杠：必须以允许前缀开头，避免误伤「简称文件名 / 抽象目录名」
  const allowed = AGENTS_PATH_PREFIXES.some((pre) => p.startsWith(pre));
  if (!allowed) return null;
  // 末尾斜杠表目录形态；去掉再交给 fs.existsSync
  const normalized = p.endsWith("/") ? p.slice(0, -1) : p;
  return normalized || null;
}

function checkAgentsMdPaths() {
  if (!exists(AGENTS_MD_PATH)) {
    problems.push(
      "AGENTS.md 漂移守卫：仓库根应存在 AGENTS.md（AGENTS 硬规则 15 前置阅读的第一站）",
    );
    return;
  }
  const text = readText(AGENTS_MD_PATH);
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  lines.forEach((line, idx) => {
    const lineno = idx + 1;
    const candidates = [];
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      candidates.push({ raw: m[1], source: "backtick" });
    }
    for (const m of line.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
      // 链接目标允许带 #fragment；只核对 fragment 之前的路径部分
      candidates.push({ raw: m[1].split("#")[0], source: "md-link" });
    }
    for (const c of candidates) {
      const p = looksLikeRepoPath(c.raw);
      if (!p) continue;
      // 运行期产物（被 .gitignore 忽略）不参与「文件必须存在」判定，见上节。
      if (GITIGNORED_ROOT_NAMES.has(p)) continue;
      const key = `${p}@L${lineno}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!exists(p)) {
        problems.push(
          `[AGENTS.md:L${lineno}] 反引号路径 \`${c.raw}\` 在仓库中不存在。` +
            `若该文件已删除/移动，请同步更新 AGENTS.md（AGENTS 硬规则 15 / §12.5.3）；` +
            `若是历史决策记录（如「随 ISSUE #N 已下线」句式），请去掉反引号或改写成不带路径的表述。`,
        );
      }
    }
  });
}

function checkAgentsMdSectionAnchors() {
  if (!exists(AGENTS_MD_PATH)) return;
  const text = readText(AGENTS_MD_PATH);
  const lines = text.split(/\r?\n/);
  // 「3 行窗口」：把当前行、上一行、下一行拼成一段——覆盖「同 bullet 跨行、
  // 文件在头行、§号在后行」这种 AGENTS.md 里常见的写法（如「改 src/lib/**
  // → docs/standards/18-lib层规范.md ... 尤其 §18.4 三选一的唯一口径」）。
  const fileRe = /docs\/standards\/(\d+)-[^\s`)\]~]+\.md/g;
  const sectionRe = /§(\d+(?:\.\d+){0,3})/g;
  // 已报告过的 (path + §num) 组合，避免窗口重叠导致重复计数
  const reported = new Set();
  const targetCache = new Map();
  const readTarget = (rel) => {
    if (targetCache.has(rel)) return targetCache.get(rel);
    const content = exists(rel) ? readText(rel) : "";
    targetCache.set(rel, content);
    return content;
  };

  for (let i = 0; i < lines.length; i++) {
    const window = [lines[i - 1] ?? "", lines[i], lines[i + 1] ?? ""].join(
      "\n",
    );
    const files = [];
    let m;
    fileRe.lastIndex = 0;
    while ((m = fileRe.exec(window))) {
      files.push({ num: m[1], path: m[0] });
    }
    if (!files.length) continue;
    sectionRe.lastIndex = 0;
    while ((m = sectionRe.exec(window))) {
      const full = m[1]; // 形如 "18" / "18.4" / "13.6.1"
      const major = full.split(".")[0];
      const target = files.find((f) => f.num === major);
      if (!target) continue; // 窗口里只有别的 standards 文件，跳过（避免误配）
      if (full === major) continue; // 单级 §N（如 §17）不校验——粒度太粗、易混淆
      if (!exists(target.path)) continue; // 文件本身缺失由 checkAgentsMdPaths 报，这里不重复
      const dedupKey = `${target.path}#${full}`;
      if (reported.has(dedupKey)) continue;
      const content = readTarget(target.path);
      const escaped = full.replace(/\./g, "\\.");
      const anchorRe = new RegExp(
        `^#{1,6}\\s+(?:§)?${escaped}(?:\\s|[^\\d]|$)`,
        "m",
      );
      if (!anchorRe.test(content)) {
        reported.add(dedupKey);
        problems.push(
          `[AGENTS.md:L${i + 1}] 章节引用 \`§${full}\` 在 \`${target.path}\` 中未找到对应标题锚点。` +
            `请核对章节号是否写错、该章节是否被合并/重编号；若目标文件里的标题格式与 \`§${full}\` 有出入，` +
            `请统一到 standards 惯例（\`## ${full} ...\` 或 \`### ${full} ...\`）。`,
        );
      }
    }
  }
}

function checkAgentsMdDrift() {
  checkAgentsMdPaths();
  checkAgentsMdSectionAnchors();
}

function main() {
  checkFactKeysMatchDocs();
  checkScopeCoverage();
  checkLedgerCommands();
  checkGateStepIndexRefs();
  checkGateChecklistMatchesHook();
  checkPaths();
  checkAgentsMdDrift();
  for (const doc of SCOPED_DOCS) checkDoc(doc);

  if (problems.length > 0) {
    console.error("\n[doc:check] 发现文档引用一致性问题：\n");
    for (const p of problems) console.error("  ✗ " + p);
    console.error(
      `\n共 ${problems.length} 项。请对照 docs/reference-facts.md 更新文档。`,
    );
    process.exit(1);
  }
  console.log("[doc:check] ✓ 文档引用与权威源一致。");
}

main();
