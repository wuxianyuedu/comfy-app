#!/usr/bin/env node
// @ts-nocheck
/**
 * check-doc-gate-refs.cjs — 「文档怎么引用门禁」那三条判据（由 check-doc-references.cjs 调用）
 *
 * 拆出来的理由只有一条：这些判据与 `check-doc-references.cjs` 判的**不是一件事**——
 * 那一半判「文档里的硬编码值 / 路径 / 端口与权威源一致」，这一半判「文档怎么引用门禁」：
 * 不写「第 N 步」（序号在「组 0 + A/B/C/D」上无唯一解释，ISSUE #1374）、
 * 不写步数（数字会静默过期，ISSUE #1407）、§13.1 清单与钩子 D 组逐条一致（ISSUE #1404）。
 * 两半合住一份文件时它越过了 §12.6 R5 的 900 行硬闸。
 *
 * 调用约定：三条入口都往传入的 `problems` 数组里 `push`，错误话术与
 * `[文件:行]` 前缀一个字都没搬动 —— 那是判据的读者面。声明层（`STEP_INDEX_RE` 一族、
 * `HOOK_PATH` / `GATE_CHECKLIST_DOC` / `NON_D_GROUP_COMMANDS`）跟着判据一起搬：
 * 留在原处会变成「两处各说各话」。
 */
const { SCOPED_DOCS, readText, exists } = require("./doc-facts.cjs");

/** 代理自动加载的唯一导航文件。与 `check-doc-references.cjs` 里的同名常量是同一个判据面：
 *  `AGENTS.md` 与两份索引都写「哪条判据在哪跑」，而它们不在 SCOPED_DOCS 里。 */
const AGENTS_MD_PATH = "AGENTS.md";

/**
 * 门禁步骤的引用口径：规范文档与索引里引用 `.githooks/pre-commit`（或已删除的平台流水线） * 的某一步，一律写**钩子日志里打印的标签**（`── check: <标签>`）或那一步跑的脚本名，
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
  /不写|别再|不要写|禁止|应写|应改|一律|改成|序号|没有唯一|已删|已随|历史|不再|过期/;

/** 门禁口径的遍历集合：钩子与「哪条判据在哪跑」不只写在 SCOPED_DOCS 里。 */
function gateReferenceDocs() {
  return [
    ...new Set([
      AGENTS_MD_PATH,
      "docs/README.md",
      "README.md",
      "docs/reference-facts.md",
      ...SCOPED_DOCS,
    ]),
  ];
}

function checkGateStepIndexRefs(problems) {
  // AGENTS.md 与两份索引（docs/README.md、README.md）都带「哪条判据在哪跑」这类表述，
  // 但都不在 SCOPED_DOCS 里（AGENTS 无占位符、索引不属于 docs/standards|guides 目录扫描面），
  // 所以在这里显式并入遍历集合 —— 与 checkLedgerCommands 同一手法。
  // `docs/reference-facts.md` 同理：它是**登记表本身**（FACTS 通过
  // `ASCII_ONLY_FACT_DOCS` 读它，不通过 SCOPED_DOCS），而「哪条判据在哪跑」正是写在这份文件里的，
  // 不并进来看不到它自己举例时用的旧序号。
  for (const doc of gateReferenceDocs()) {
    if (!exists(doc)) {
      continue;
    }
    const lines = readText(doc).split("\n");
    lines.forEach((line, i) => {
      if (!STEP_INDEX_RE.test(line)) {
        return;
      }
      if (!GATE_STEP_REF_RE.test(line)) {
        return;
      } // 过程序号（§x.y 第 N 步）与本条无关
      if (STEP_INDEX_EXPLAIN_RE.test(line)) {
        return;
      } // 描述这条规则本身，放行
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
 * 门禁的**步数**也不许写进文档（ISSUE #1407，签字口径 (a)）—— 与 `checkGateStepIndexRefs`
 * 是同一条纪律的两个载体：序号会整体错位，数字会静默过期。
 *
 * 立案现场：`docs/standards/11` 那节写着「`.githooks/pre-commit`（24 步）」并抄了清单的前 6 行。
 * 那一天钩子的真实形状是 组 0 + A + B + C + D，**D 组 27 条**（这数字由
 * `tests/doc-check-hook-wiring.test.ts` 与钩子注释逐字核对）。也就是说那句数字不是「将来会过期」，
 * 是**当场就已经是错的**，而没有任何东西会变红 —— 它既不是序号也不属于任何事实核。
 *
 * 与序号那条的分工：命中「第 N 步」的行交给 `checkGateStepIndexRefs` 报（同一行不双报），
 * 本条只管裸计数形态（「24 步」「共 30 步」）。豁免集合与那条共用，所以描述本口径自身的句子不误伤。
 */
const STEP_COUNT_RE = /[0-9]+\s*步/;

function checkGateStepCounts(problems) {
  for (const doc of gateReferenceDocs()) {
    if (!exists(doc)) {
      continue;
    }
    const lines = readText(doc).split("\n");
    lines.forEach((line, i) => {
      if (STEP_INDEX_RE.test(line)) {
        return;
      } // 序号形态由 checkGateStepIndexRefs 报，不双报
      if (!STEP_COUNT_RE.test(line)) {
        return;
      }
      if (!GATE_STEP_REF_RE.test(line)) {
        return;
      } // 「prepare-local-run.ps1 第 3 步」这类有主人的过程计数
      if (STEP_INDEX_EXPLAIN_RE.test(line)) {
        return;
      } // 描述这条规则本身，放行
      const hit = line.match(STEP_COUNT_RE)?.[0] ?? "N 步";
      problems.push(
        `[${doc}:${i + 1}] 写了门禁的步数「${hit}」—— 钩子每追加一步这个数字就静默过期，` +
          `没有任何判据会因此变红（ISSUE #1407，同 13.5.10 的「不写序号」）。` +
          `请只写「清单的唯一出处是 §13.1 / .githooks/pre-commit」这种指针形态；` +
          `若这一行正是在描述本条口径，补「不写/别再/不再/过期」等纠正词。`,
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
 * 那时清单写 `node scripts/check-file-structure.cjs`（不带 `--strict`），而钩子跑的是
 * 带它的那一档 —— 照清单手跑的人会得出「R5 不拦」的结论，而同一节还写着「上面那份
 * 清单就是全文」。那个具体的 `--strict` 差异随 ISSUE #1811 收掉 R5 棘轮而不存在了，
 * 但**比对整条命令而不是脚本名**这条口径要一直留着：下一个 flag 层面的漂移会以
 * 别的形态出现（同一份「哪些一步带什么参数」的账）。
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
  if (start < 0) {
    return null;
  }
  const rest = docText.slice(start);
  const close = rest.indexOf("```");
  if (close < 0) {
    return null;
  }
  return rest
    .slice(0, close)
    .split("\n")
    .filter((l) => l.startsWith("✅ "))
    .map((l) => l.slice(2).split(/ +# /)[0].replace(/\s+/g, " ").trim());
}

function checkGateChecklistMatchesHook(problems) {
  if (!exists(HOOK_PATH) || !exists(GATE_CHECKLIST_DOC)) {
    return;
  }
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
    if (docSet.has(cmd)) {
      continue;
    }
    problems.push(
      `[${HOOK_PATH}] 这一步真的在跑 \`${cmd}\`，但 ${GATE_CHECKLIST_DOC} 的 §13.1 清单里没有这条 ` +
        "（或 flag 与钩子不一致）。清单是手跑全套的唯一入口，漏一格 = 照着清单跑的人以为它不存在。",
    );
  }
  for (const cmd of docCmds) {
    if (hookSet.has(cmd) || NON_D_GROUP_COMMANDS.has(cmd)) {
      continue;
    }
    problems.push(
      `[${GATE_CHECKLIST_DOC}] §13.1 清单写着 \`${cmd}\`，但 ${HOOK_PATH} 的 D 组没有这一步 —— ` +
        "「上面那份清单就是全文」这句话已经不成立。要么把这一步接回钩子，要么从清单里删掉。",
    );
  }
}
module.exports = { checkGateStepIndexRefs, checkGateStepCounts, checkGateChecklistMatchesHook };
