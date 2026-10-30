/**
 * `base-check.mjs` 的 **钩子解析层**(ISSUE #1811 拆 R5 超限文件)。
 *
 * 「被拦住的那条判据」怎么变成一条可执行的命令:钩子标签 → 钩子行 → argv,
 * 以及在这份检出上跑一条命令并回收它的输出。这里也是 `HOOK` 之所以跟着
 * `cwd` 走的地方 —— 标签 ⇄ 命令的对应关系必须来自**被复算的那份检出**。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { pnpmInvocation } from "../launcher-core/shell.mjs";
import { chainedSteps } from "./chained-steps.mjs";
import { cleanGitEnv, git, HOOK, resolveMergeBaseRef, ROOT } from "./git-ref.mjs";

/**
 * 把一个「门禁命令」参数数组规范化成 `{ label, argv }`。
 *
 * 接受三种写法（都在 §13.6.2 的现场出现过）：
 *   · 钩子标签：`check-ui-primitives`（唯一命中 `.githooks/pre-commit` 的
 *     `run "<标签>" <命令>` 那一行，命令从钩子里取，不抄第二份）；
 *   · 裸脚本名：`scripts/check-ui-primitives.cjs`（补 `node` 前缀）；
 *   · 完整命令：`node scripts/x.cjs --strict` / `pnpm exec vitest run …`（原样）。
 *
 * 标签匹配**必须唯一** —— 命中 0 条或多条都判失败并列出候选，别猜。
 *
 * @param {string[]} input
 * @param {string} [hookPath]
 * @returns {{ok: true, label: string, argv: string[]} | {ok: false, error: string}}
 */
export function resolveGateCommand(input, hookPath = HOOK) {
  const first = input[0];
  if (first === undefined) {
    return { ok: false, error: "没有给门禁命令（用法见脚本头）" };
  }
  // 只给一个词、且不以路径/命令形态出现 ⇒ 当成钩子标签查。
  if (input.length === 1 && !first.includes("/") && !first.includes(".")) {
    const steps = readHookSteps(hookPath);
    const hits = steps.filter((s) => s.label === first);
    if (hits.length === 1 && hits[0]) {
      return { ok: true, label: hits[0].label, argv: hits[0].argv };
    }
    if (hits.length === 0) {
      const labels = steps.map((s) => s.label).join("\n    ");
      return {
        ok: false,
        error: `钩子里没有标签「${first}」。可用的标签：\n    ${labels}`,
      };
    }
    return {
      ok: false,
      error: `标签「${first}」在钩子里命中 ${hits.length} 条，无法唯一确定`,
    };
  }
  /* 裸脚本名 ⇒ 补 `node`（仓库里 Node 是共同前提，§9.5）。
   *
   * 两个形态都要认对，否则每条判据都会被判成「没跑起来」（127）：
   *   · `scripts/x.cjs` —— 裸文件名；
   *   · `node scripts/x.cjs --flag` —— **整条命令当参数给进来**时它只有**一个**
   *     数组元素（`base-check "node scripts/x.cjs"` 与 `--base "…"` 两种走法都是这个
   *     形状），先按空白切成 argv，**不许**把整串当成一个路径（那会拼出
   *     `<cwd>/node scripts/x.cjs`、`existsSync` 恒假、整批读数变成 127）。
   *     分词复用 `tokenize()`（引号语义与其他步骤同一份），不另写切分。 */
  if (input.length === 1) {
    const words = tokenize(first);
    /* 已经是「命令形态」（`node x` / `pnpm exec …`）⇒ 按空白切成 argv。 */
    if (words.length > 1) {
      return { ok: true, label: first, argv: words };
    }
    if (/\.(cjs|mjs|js)$/.test(first)) {
      return { ok: true, label: first, argv: ["node", first] };
    }
  }
  return { ok: true, label: input.join(" "), argv: input };
}

/**
 * **合并前那一批**：把「这次 PR 准备并进去的判据面」从钩子里现算出来。
 *
 * ── 为什么这一档要存在（ISSUE #1591 立案的那个洞）──────────────────────
 *
 * 平台侧是 **squash 合并**，那一步**不跑本地钩子**；而 ISSUE #623 之后
 * **已无 CI 兜底**（§13.5.3）。于是「我的分支绿」到「master 绿」之间那一跳
 * **没有任何判据**：`tsc` 在本地钩子的 A 组里跑过、在 PR 分支上确实是绿的，
 * 但推上去 squash 进 `master` 时谁都没再看一眼。§13.6.2 的末段把这件事写成
 * 「合并前跑一遍 `pnpm check:all`：这一条没有自动执行者」—— 这一条就是那个空位。
 *
 * ── 它为什么不是「再抄一份判据清单」────────────────────────────────────
 *
 * 待复算的面从 **`.githooks/pre-commit` 的步骤行**里取（`readHookSteps`，同一个
 * 已存在的解析器），再按下面三条**形态**筛：
 *
 *   ① 有 `--staged` 的步骤**不收** —— 它们的语义就是「只看本次暂存改动」，
 *      拿它去复算上游快照等于问一个它回答不了的问题（上游那份没有你的暂存区）；
 *   ② 只在**暂存改动命中某个目录**时才做事的步骤（`shell-gate` /
 *      `storybook-check --changed`）不收 —— 同因：它们的判决**依赖本次改动**，
 *      在干净快照上跑要么立刻返回 0、要么判的是快照自己的形态，两种都不是
 *      「合并后会不会红」这个问题的答案；
 *   ③ `base-check` 自己**不收**（那会递归）。
 *
 * 剩下的就是 A 组那条 `tsc --noEmit`、B 组那条 `eslint`，与 D 组里一批**全仓判据**
 * （结构硬规则 / 棘轮 / 复用 / 文档同步）。它们在干净快照上跑出来的红绿，才是
 * 「并进去之后 `master` 会不会红」的直接读数 —— 与「被拦下时复算一条」用的是
 * 同一套事实与同一套话术，只是面从一条变成一批。
 *
 * **零参数就是「这一批」**：要收窄（比如只关心某几条）就把它们当参数给进来
 * （钩子标签 / 脚本名 / 整条命令都认，同 `resolveGateCommand`）。
 *
 * @param {string[]} input 用户显式点名的命令（为空 ⇒ 用上面算出来的那一批）
 * @param {string} [hookPath]
 * @returns {{ok: true, commands: Array<{argv: string[], label: string, baseSide?: boolean}>} | {ok: false, error: string}}
 */
export function resolveMergeBatch(input = [], hookPath = HOOK) {
  if (input.length > 0) {
    const one = resolveGateCommand(input, hookPath);
    if (!one.ok) {
      return one;
    }
    return { ok: true, commands: [{ argv: one.argv, label: one.label }] };
  }
  const steps = [...groupSteps(hookPath), ...readHookSteps(hookPath)];
  if (steps.length === 0) {
    return {
      ok: false,
      error:
        "读不到 .githooks/pre-commit 的步骤 —— 合并前那一批复算不出来，" +
        "请显式点名要复算的判据（用法见脚本头）",
    };
  }
  const commands = steps.filter((s) => mayDecideOnCleanSnapshot(s.argv));
  if (commands.length === 0) {
    return {
      ok: false,
      error: "钩子里没有一条「可在干净快照上判决」的判据 —— 复算不出任何事实",
    };
  }
  /* **第二个来源**：挂在 `--base` 这批里、但不在钩子步骤上的判据（见
   * `scripts/base-check/chained-steps.mjs` 的头注释 —— 那一族天然进不了钩子的理由、
   * 两条口径与事实来源都写在那里，不在本文件里复述，免得两处各说一遍）。 */
  return {
    ok: true,
    commands: [
      ...commands,
      ...chainedSteps({ root: ROOT, resolveBaseRef: resolveMergeBaseRef, git }),
    ],
  };
}

/**
 * **挂在 `--base` 这批里、但不在 `.githooks/pre-commit` 步骤上的**判据。
 *
 * 为什么这一族不能由 `readHookSteps` 收上来：它们**天然进不了钩子**，而理由与
 * 「代价高」无关 —— 是**本地看不到那个形态**。首发成员是
 * `scripts/check-commit-claims.mjs`（「提交信息里的声明 ⇄ 那次提交的事实」）：
 *
 *   · 声明说的是**某一次提交**的树（「§x.y 照旧保留」），核对必须手上有那次提交的
 *     事实；而丢失发生在**平台侧 squash** 那一刻，本地钩子跑的时候那次提交还没诞生
 *     （实测：`ad81a912` / `bdabd26f` / `b9bedd37` 在 `master` 上都是**单亲**，
 *     信息里却带 `Merge origin/master into …` 字样 —— `check-merge-parents` 在
 *     squash 之后判不出来，因为单亲是它的正常形态）；
 *   · 硬塞进钩子只会让人学会绕开它（§13.6.2 的边界原话）。
 *
 * 而 `--base` 正是「合并前 / 事后盘点，人点一次就跑一次」那一档：它手上有上游引用、
 * 有干净快照，本来就是「对着一批提交算事实」的地方 —— 挂在这里**零新通道**
 * （§13.6.2 / §13.5.4 的按需召唤）。
 *
 * **判什么、判在哪一次提交**：合并前那档的语义是「**这一批准备并进去的提交**」，
 * 所以给的是**本检出相对基线的那些提交**（`<ref>..HEAD`）—— 与 `--base` 问的
 * 「并进去之后会不会红」同源。没有待并提交时（已在基线上）给空，判据自己报 0 次
 * 提交，不报假红。
 *
 * 每条都要带 `label`（行表里点名用），并走 `mayDecideOnCleanSnapshot` 的同一套
 * 排除理由 —— 它**不依赖暂存区**（判的是提交对象），所以照收。
 *
 * @returns {Array<{argv: string[], label: string}>}
 */
/**
 * 钩子里 `run_group <id> "<说明>" sh -c '<命令>'` 那四条 —— **A 组与 B 组是它们**。
 *
 * 为什么单独解析这一族：`.githooks/pre-commit` 把 tsc 与 eslint 从 D 组的 `run` 步骤
 * 里拿出来**并行成组**（`run_group A "tsc --noEmit" sh -c 'pnpm exec tsc --noEmit'`），
 * 于是 `readHookSteps()`（只认 `run "<标签>" <命令>`）**看不见它们** —— 而这两条恰好
 * 就是 ISSUE #1591 立案的那两条（19 条 tsc 错落进 `master`）。只读 `run` 的解析器
 * 会让「合并前复算」漏掉最该复算的那两条，且表现为「静默少两行」。
 *
 * 只收**单行的** `run_group`（`sh -c '…'` 一行写完的那两条）；C 组那条的 `sh -c` 是
 * 多行脚本（它自己调 `run-affected-tests.mjs` 拼清单），D 组那条同理 —— 它们不是
 * 「一条判据一条命令」的形状，取不出可复算的单条命令，故按「解析不到就不收」处理。
 *
 * @param {string} hookPath
 * @returns {Array<{label: string, argv: string[]}>}
 */
export function groupSteps(hookPath = HOOK) {
  let text;
  try {
    text = fs.readFileSync(hookPath, "utf8");
  } catch {
    return [];
  }
  const out = [];
  /* `run_group <id> "<说明>" sh -c '<命令>'` —— 只认整行闭合的单引号，多行脚本不匹配。 */
  const re = /^run_group\s+\S+\s+"([^"]+)"\s+sh -c '([^'\n]+)'\s*$/gm;
  for (const m of text.matchAll(re)) {
    const label = m[1];
    const command = m[2];
    if (!label || !command) {
      continue;
    }
    out.push({ label, argv: tokenize(command) });
  }
  return out;
}

/**
 * 只对「本次改了什么」作答、**且没有别的入口**的那些步骤。
 *
 * 这一族与「带 `--staged` / `--changed` 的步骤」不是一回事，区别在**能不能剥**：
 *   · 带 `--staged` 的步骤，剥掉那个旗标之后它判的是**全仓**（`fullTreeArgv()`
 *     做的事）⇒ 判决面还在，判据仍然有效；
 *   · 这一族**没有可剥的旗标** —— 它们直接读暂存区（`shell-gate` 就是读暂存区那份
 *     清单），所以在「暂存区为空」的地方（平台流水线）它们**恒绿且无输出**。
 *
 * ⇒ 名单在此导出，因为**两处都要用同一个问法**：「这一步的判决面是不是只存在于
 * 「本次改动」上」—— 合并前复算据此**不收**它（`mayDecideOnCleanSnapshot`），
 * 平台复合档据此**换判决面**或**单列成没判**（`scripts/ci-heavy-gates.mjs`）。
 * 两处各写一份名单就会漂开，而漂开的形态是「一处判了、另一处没判」。
 *
 * ⚠️ **这一族是「按参数形态识别」抓不到的那一半**（ISSUE #2265 的现场）：
 *   · `shell-gate` —— 钩子行里**连 `--staged` 都没有**，它自己读暂存区；
 *   · `check-doc-mirror-pairing.cjs` —— 带 `--staged`，但**剥掉那个旗标之后它判的
 *     仍是暂存集**（它自己的文件头写着「不带它判的也是暂存集」：镜像与源是否**同批**
 *     是提交的属性，不是仓库的属性）⇒ 剥旗标这一手对它**无效**；
 *   · `known-failed-selftest-gate.mjs` —— 同样**连旗标都没有**（钩子行是
 *     `node scripts/known-failed-selftest-gate.mjs`），它自己读暂存区。
 *
 * 后两条在平台那一格（干净快照、没有暂存区）上**恒绿**：
 *   · 前者自认「暂存区是空的 —— 没有什么可判（这不是「已通过」）」并退 0；
 *   · 后者**一个字都不打**就退 0。
 * ⇒ 两条都登记进来，让复合档给它们 `--base <ref>`（换判决面），
 * 也让合并前复算**不收**它们（`mayDecideOnCleanSnapshot`）—— 那条复算在干净快照上
 * 同样没有暂存区，收进去只会多一行恒绿。
 */
export const CHANGED_SCOPED = [
  "scripts/shell-gate.mjs",
  "scripts/check-doc-mirror-pairing.cjs",
  "scripts/known-failed-selftest-gate.mjs",
];

/**
 * 一条指令**能不能在干净的上游快照上判决** —— 判据是它的**参数形态**，不是名字。
 *
 * 为什么按参数而不按名字：名字是自由的（`check-*` / `*-gate` / `storybook-check`），
 * 而「这条判据的输入里有没有『本次改动』」是有形态的：
 *   · `--staged` / `--changed` —— 明说只看暂存 / 本次改动（`check-deps-freshness`
 *     `--staged`、`storybook-check --changed`）；
 *   · 只在特定目录有改动时才做事的那几条（`shell-gate`）**没有参数
 *     可认**，所以它们由调用点显式列在下面 —— 这份名单是「名字以外的形态」的兜底，
 *     新增同类时要一起加（漏了不会静默：那一步在干净快照上返回 0 或判快照自身形态，
 *     表现为多一条恒绿的行，人看得见）。
 *
 * @param {string[]} argv
 * @returns {boolean}
 */
export function mayDecideOnCleanSnapshot(argv) {
  const joined = argv.join(" ");
  if (argv.some((a) => a === "--staged" || a === "--changed")) {
    return false;
  }
  /** 只对「本次改了什么」作答的步骤（它们的判决依赖暂存区，干净快照里没有）。 */
  if (CHANGED_SCOPED.some((p) => joined.includes(p))) {
    return false;
  }
  /** `base-check` 自己：复算里再复算会递归。 */
  if (argv.some((a) => a.endsWith("base-check.mjs"))) {
    return false;
  }
  return true;
}

/**
 * 从 `.githooks/pre-commit` 里读出 `run "<标签>" <命令…>` 的步骤。
 *
 * 只认**步骤行**、不认文件全文 —— 同 `check-gate-executors.cjs` 的理由：
 * 全文匹配会把散文里被提到的脚本一起打进来（那边实测凭空多出三份）。
 *
 * @param {string} hookPath
 * @returns {Array<{label: string, argv: string[]}>}
 */
export function readHookSteps(hookPath = HOOK) {
  let text;
  try {
    text = fs.readFileSync(hookPath, "utf8");
  } catch {
    return [];
  }
  const steps = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*run\s+"([^"]+)"\s+(.+?)\s*$/);
    if (!m) {
      continue;
    }
    const label = m[1];
    const command = m[2];
    if (label === undefined || command === undefined) {
      continue;
    }
    // 命令里可能带行内注释（`--strict` 之后跟 `# …`）—— 去掉注释再分词。
    const bare = command.replace(/\s+#.*$/, "").trim();
    steps.push({ label, argv: tokenize(bare) });
  }
  return steps;
}

/**
 * 本地档（D0 形态前置档）的步骤标签 —— 「哪几条是秒级形态档」这件事的**唯一出处**。
 *
 * 为什么按文本块边界取、而不是列一份标签清单：那份清单就是注册表的第二份抄本，
 * 而它漂移的方向恰好是「本地少了执行者而账面看不出来」（`check-gate-executors.cjs`
 * 只认 `run` 行，抄本不在它的解析面上 ⇒ 静默）。取法与本文件既有的两条一致：
 * 只认**步骤行**，块边界就是 `run_group D0` 那一行到它 `sh -c '` 的收尾引号。
 *
 * 消费方：`.githooks/pre-commit` 的档位开关（默认只跑这一档）与
 * `scripts/premerge-check.mjs`（合并前那一跳默认只复算这一档，`--full` 才全套）。
 *
 * @param {string} hookPath @returns {Set<string>}
 */
export function localTierLabels(hookPath = HOOK) {
  let text;
  try {
    text = fs.readFileSync(hookPath, "utf8");
  } catch {
    return new Set();
  }
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^run_group\s+D0\b/.test(l));
  if (start < 0) {
    return new Set();
  }
  const out = new Set();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("'")) {
      break;
    } // D0 那个 `sh -c '…'` 的收尾引号
    const m = line.match(/^\s*run\s+"([^"]+)"/);
    if (m && m[1] !== undefined) {
      out.add(m[1]);
    }
  }
  return out;
}

/**
 * 极简分词：按空白切，尊重单/双引号。
 *
 * 不做 shell 展开（`$VAR` / 通配符）—— 钩子里的步骤本来就不依赖展开
 * （它们走 `pnpm exec` / `node`，参数是显式的）。真需要 shell 语法的命令
 * 请**整条**作为参数传进来，本脚本会原样 `spawn` 给复核的那份检出。
 *
 * @param {string} line
 * @returns {string[]}
 */
export function tokenize(line) {
  const out = [];
  let cur = "";
  let quote = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) {
    out.push(cur);
  }
  return out;
}

/**
 * 把一次 spawn 结果归一成 `{ code, output }`（同 `tests/helpers/gate-repo.ts` 的口径）。
 *
 * @param {import("node:child_process").SpawnSyncReturns<string>} r
 * @returns {{code: number, output: string}}
 */
export function normalizeRun(r) {
  if (r.error) {
    return { code: 127, output: String(r.error.message) };
  }
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { code: r.status ?? -1, output };
}

/**
 * 命令的**目标条目**（脚本文件 / 目录）在给定工作目录里存不存在。
 *
 * 为什么需要这一步：基线 worktree 是一个**干净的上游快照**，看不到本检出的未提交
 * 文件。一条「本检出有、未提交」的判据在基线侧会因 `MODULE_NOT_FOUND` 退出 ——
 * 而 Node 那条路径的退出码是 **1**，与「判据跑了且红」逐字同形（实测过：只读退出码
 * 必然误判）。所以「跑不起来」必须由**目标存不存在**判，不能由退出码判。
 *
 * 只对**能识别的形态**（`node <相对路径>`）做这一步：`pnpm exec` / `vitest` 这类
 * 目标不在文件系统上的命令交给它们自己报错（那时退出码与消息会说明问题）。
 *
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {{kind: "ok"} | {kind: "missing", target: string} | {kind: "unknown"}}
 */
export function commandTargetState(argv, cwd) {
  const [cmd, first] = argv;
  if (cmd !== "node" || !first || first.startsWith("-")) {
    return { kind: "unknown" };
  }
  const target = path.resolve(cwd, first);
  return fs.existsSync(target) ? { kind: "ok" } : { kind: "missing", target: first };
}

/**
 * 把一条门禁命令解析成这台机器上**真能 spawn** 的形态（`{command, args}` 或 null）。
 *
 * 两件事各只有一个出口，这里不重抄：
 *   · `pnpm` —— `pnpmInvocation()`。它为 `.cmd` 垫片附带 PowerShell 宿主形态、
 *     并给出可读的「路径上找不到」出口（AGENTS 硬规则 24 / §12.18）。
 *     此前本文件自己写 `needsShell(cmd) → shell: true`：那是**第二份**形态判据，
 *     而且与正确判据不一致 —— 「开一层 shell 让 cmd.exe 猜」不等于「经宿主起
 *     `.ps1`」，`.cmd` 在 `spawnSync("pnpm", …, {shell:true})` 下能跑，可
 *     `pnpmInvocation` 明确判定它是**不可用形态**（只有 cmd.exe 解释批处理，
 *     而那条路带引号规则与注入面）。判据只能有一份，所以这里复用。
 *   · `node` —— 用 `process.execPath`，避免复核环境里 PATH 上是另一套 Node。
 *
 * @param {string[]} argv
 * @returns {{command: string, args: string[]} | null} null = PATH 上找不到（127 那一档）
 */
function resolveGateInvocation(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === undefined) {
    return null;
  }
  if (cmd === "pnpm") {
    return pnpmInvocation(rest, { env: process.env });
  }
  return { command: cmd === "node" ? process.execPath : cmd, args: rest };
}

/**
 * 在给定工作目录跑一次门禁。**只做「跑 + 收码」**，判决在 `judge()`。
 *
 * `pnpm` 一律经 `pnpm exec`（AGENTS 硬规则 1：禁 npm/npx）；形态由
 * `resolveGateInvocation()` 收口（见它的注释）。`shell` 恒 false —— 参数里有
 * 含空格的路径时，多一层 cmd.exe / sh 就多一层它自己的引号规则。
 *
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {{code: number, output: string}}
 */
export function runGate(argv, cwd) {
  const state = commandTargetState(argv, cwd);
  if (state.kind === "missing") {
    // 127 是本脚本自己的「没跑起来」哨兵（`normalizeRun` 用同一个码）。
    return {
      code: 127,
      output: `[base-check] 目标不存在于该工作目录：${state.target}`,
    };
  }
  if (argv.length === 0) {
    return { code: 127, output: "[base-check] 命令是空的" };
  }
  const invocation = resolveGateInvocation(argv);

  if (!invocation) {
    /* 「没跑起来」而不是「跑了且红」：127 让 `judge()` 归 `inconclusive`，
     * 与「命令拼不出来/跑不起来」同档 —— 照旧不构成证据。 */
    return {
      code: 127,
      output: `[base-check] PATH 上找不到可用的 ${argv[0]} ` + "（自查：pnpm check:toolchain）",
    };
  }
  const r = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    /* 同样走干净环境：被判的判据自己也可能是 git 判据（`check-branch-guard` 等），
     * 继承来的 `GIT_*` 会让它判的**不是这个检出**。 */
    env: { ...cleanGitEnv(), CI: "1" },
  });
  return normalizeRun(r);
}
