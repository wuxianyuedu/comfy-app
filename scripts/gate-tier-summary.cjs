#!/usr/bin/env node
/**
 * 降档收尾那几句话的**唯一实现**（ISSUE #2154；口径见规范 §13.5.25）。
 *
 * 为什么从 `.githooks/pre-commit` 里挪出来：那四行 echo 有一句把「本地没跑哪些」的**清单
 * 写死成全集**（`（tsc / eslint / 受影响用例 / 静态判据全量）`），而它上面刚打印完
 * `[ok] ── 组 A：tsc --noEmit` / `组 B` / `组 D`。于是 `COMFY_HEAVY_GATES=1` 那一跑会
 * 当场推翻自己的上一行 —— 而那一跑恰恰是「有人主动把全套跑了」的一次。同段还有一句
 * 「本地要 A/B/D 全套：`COMFY_HEAVY_GATES=1` …」在同一次运行里也已不适用；
 * 收尾那句 `入选档位全部通过 ✓（D0 形态档；重档见平台）` 里的「D0 形态档」与「重档见平台」
 * 同样是写死的。这三处是**同一个病**：措辞不住在事实旁边，事实变了它不变。
 *
 * 同族的前两次（都不是巧合）：ISSUE #2145 修的是 ship 合并那一段「被自己的下一行推翻」；
 * ISSUE #2149 修的是体积预算红话把人指给一个不存在的签字者。本条按同一个修法：**念这一轮
 * 实际跑了什么**，并且**把话术放进有执行者的地方** —— 钩子里就地的 echo 一条用例都测不到它
 * （那正是 §13.5.25 记过的「配置里的逻辑没有本地执行者」那一族，`ci-toolchain-selfcheck.mjs`
 * 是同一家族的搬法）。
 *
 * 标签的**唯一出处仍是钩子**：这里不抄一份名单，而是当场从 `run_group <id> "<说明>"` 那几行
 * 取（取不到就明说取不到，不静默降级成一个空句子 —— 少一句免责声明会被读成「全套过了」）。
 *
 * 用法（由钩子调用；三个参数都是钩子当场量到的组号，不含任何中文 ⇒ 不经受 MSYS 路径与
 * 引号这两层考验）：
 *   node scripts/gate-tier-summary.cjs --ran "D0 A B D" --skipped "A B D" --moved "C"
 * 另有 `--hook <路径>`（默认就是本仓那份钩子）—— 给用例证明「标签来自被解析的那一侧」，
 * 同一个注入形态见 `check-tsc-artifact-hint.cjs --file`。
 *
 * 恒退 0：它是**措辞档**，不参与判决（判决仍住在钩子里，见那里 `rc` 那一串）。
 */
const { readFileSync } = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const HOOK = path.join(ROOT, ".githooks", "pre-commit");

/** `run_group <id> "<说明>"` 的单行形态（五个调用点都是这一形，包括多行 `sh -c` 的那三个）。 */
const GROUP_CALL = /^run_group ([A-Z0-9]+) "([^"]*)"/gm;

/**
 * 从钩子文本取各组自己的说明（**不**在脚本里另立一份名单 —— 那正是 §12.12 要拦的孪生形态）。
 *
 * @param {string} hookText 钩子全文
 * @returns {Map<string,string>} 组号 → 说明
 */
function groupLabels(hookText) {
  const labels = new Map();
  for (const [, id, desc] of hookText.matchAll(GROUP_CALL)) {
    labels.set(id, desc);
  }
  return labels;
}

/**
 * 把钩子传来的组号串切成数组（空格分隔；空串 → 空数组）。
 *
 * @param {string | undefined} raw `--ran` / `--skipped` / `--moved` 的值
 * @returns {string[]} 组号
 */
function ids(raw) {
  return String(raw ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * 取一个 `--<flag> <值>` 形态的参数。
 *
 * @param {string[]} argv 进程参数（不含 node 与脚本名）
 * @param {string} flag 旗标名
 * @returns {string} 值；没给就回空串（对这三张名单来说「没给」与「给了空的」是同一件事，
 *   而标签那一格由调用方用 `|| 默认值` 兜 —— 所以这里不区分 null 与空串）
 */
function arg(argv, flag) {
  const at = argv.indexOf(flag);
  return at === -1 ? "" : (argv[at + 1] ?? "");
}

/**
 * 收尾那几句话：按这一轮**实际跑了什么**逐组念。
 *
 * @param {{ran:string[],skipped:string[],moved:string[],labels:Map<string,string>}} state
 *   钩子当场量到的三组名单 + 从钩子文本取到的说明
 * @returns {string[]} 要打印的行（顺序即输出顺序）
 */
function summaryLines({ ran, skipped, moved, labels }) {
  const out = [];
  const name = (/** @type {string} */ id) =>
    `组 ${id}：${labels.get(id) ?? "(钩子里读不到这一组的说明)"}`;

  /* 只有**被档位跳过的**才进这句 —— 挪去平台的那一组不算「降档」，它单独念一句
   * （旧形态把 C 混在「组 A B C D」里，读起来像「下一台机器上还会跑」）。 */
  if (skipped.length > 0) {
    out.push(`[pre-commit] ⚠ 本次提交本地**没跑**：${skipped.map(name).join("、")}`);
    out.push("[pre-commit] ⚠ 上面那句不是「已通过」——它等价于「这次没测行为面」（与 §13.6.2 那个");
    out.push(
      "[pre-commit] ⚠   inconclusive 同一口径）。兜底两层：推送那一跳跑复算（check:premerge",
    );
    out.push(
      "[pre-commit] ⚠   的 base 段），平台 PR 流水线是第二层（含「受影响用例」那一格）—— 见规范 §13.5.25。",
    );
    out.push(
      "[pre-commit] ⚠ 本地要 A/B/D 全套：COMFY_HEAVY_GATES=1 git commit …（或 pnpm check:all）。",
    );
  }
  for (const id of moved) {
    out.push(
      `[pre-commit] ⚠ 组 ${id}（受影响用例）本地不再执行：执行者是平台侧 PR 流水线的「受影响用例」一格`,
    );
    out.push(
      "[pre-commit] ⚠   （scripts/ci-affected-tests.mjs → run-affected-tests.mjs，同一条判决链）。",
    );
  }
  /* 「重档见平台」这一句只在**真把重档降下来**的时候念；跑了的就直接列出跑了哪几组。 */
  const heavySkipped = skipped.length > 0;
  out.push(
    `[pre-commit] 入选档位全部通过 ✓（跑了：${ran.join(" ")}${heavySkipped ? "；重档见平台" : ""}）`,
  );
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  /* 钩子路径可注入（同一个形态见 `check-tsc-artifact-hint.cjs --file`）：用例要靠它证明
   * 「标签来自被解析的那一侧」，而不是脚本里另抄了一份表。 */
  const hookPath = arg(argv, "--hook") || HOOK;
  /* 读不到钩子（不在 git 检出里 / 文件被移走）时**不**降级成「只念名单不念说明」：
   * 说明那一半正是这句话的承重位（读者要知道没跑的到底是哪几件事）。 */
  let labels = new Map();
  try {
    labels = groupLabels(readFileSync(hookPath, "utf8"));
  } catch {
    /* 留空表：下面按「读不到这一组的说明」逐组点名。 */
  }
  for (const line of summaryLines({
    ran: ids(arg(argv, "--ran")),
    skipped: ids(arg(argv, "--skipped")),
    moved: ids(arg(argv, "--moved")),
    labels,
  })) {
    console.log(line);
  }
  return 0;
}

process.exit(main());
