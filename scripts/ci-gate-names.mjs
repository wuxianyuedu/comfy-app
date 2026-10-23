#!/usr/bin/env node
/**
 * ci-gate-names.mjs — 「PR 上跑什么」那份清单里的**每个名字，执行者是谁**
 *
 * ── 它收的是哪一件事（ISSUE #2227 的现场）───────────────────────────────
 *
 * `.cnb.yml` 的 `COMFYAPP_CI_GATES` 是「PR 上跑什么」的**有序清单**，而
 * `scripts/ci-incremental-gates.mjs` / `scripts/ci-autofix-duties.mjs` 是它的两个消费点。
 * 清单里的每个名字，本该在平台侧有一个执行者；而**「执行者在哪」这件事在配置里只由注释表达**：
 *
 *   · 停用形态（`COMFYAPP_CI_DISABLED_GATES` 登记的那批）：`.gates` 里以**注释形态**留着；
 *   · 换执行者形态（下面那 4 个名字）：`.gates` 里**同样**以注释形态留着。
 *
 * ⇒ 两种形态在配置里**长得一模一样**，机器分不出「这一格被停用了」与「这一格换了执行者」，
 * 而判据只能核「停用」（`tests/no-platform-ci-config.test.ts` 那两条）。于是：
 *
 *   · 把 `tests/core-spine-single-source.test.ts` 从固定清单里删掉 ⇒
 *     `core 骨架单一事实源` 的**唯一执行者消失**，清单照旧说它在 PR 上跑 ⇒ **账面全绿**；
 *   · 把某个名字从清单里摘掉而它的执行者还在 ⇒ 同样没人看见。
 *
 * ── 这一族的三条口径 ────────────────────────────────────────────────────
 *
 *   ① **执行面有三处**（不是一处）：复合档 `重档静态判据` 的条目（执行面 = 钩子注册表，
 *      见 `scripts/ci-heavy-gates.mjs` 的头注）、「受影响用例」那一格的固定清单
 *      （`scripts/fixed-structural-tests.mjs`）、以及 `.githooks/pre-commit` 的步骤行。
 *      三处都是「谁真的会跑它」的地方 —— 判据只认这三处，不认注释。
 *   ② **「换了执行者」要机器可读**：登记在 `.cnb.yml` 的 `COMFYAPP_CI_GATES_ELSEWHERE`
 *      （键名与 `COMFYAPP_CI_DISABLED_GATES` 同一形态）。登记的值是**执行者的入口路径**
 *      （`scripts/xxx.cjs` 或 `tests/xxx.test.ts`），不是执行者自己的定义 ——
 *      判据去 ① 那三面核「这个路径真的会被跑」，**不抄第二份**（§12.12 / §12.18）。
 *   ③ **双向都判**：清单里的每个名字都要有执行者；登记的每个名字都要在清单里、
 *      每个入口路径都要真在执行面里、且不能与「活 stage」重复登记。
 *
 * 用法（一般不直接跑）：
 *   · `registeredGateOrder(text)` / `registeredDisabledGates(text)` —— 两份既有清单的解析
 *   · `registeredElsewhereGates(text)` —— 「执行者在别处」那份登记
 *   · `gateNameExecutorProblems(deps)` —— 判据本体（纯函数）
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * 从一段 YAML 折叠标量里取出一个键的正文（键不在 ⇒ `null`）。
 *
 * ⚠️ 正文行**不许是注释**（YAML 折叠标量的正文里不会出现 `#` 开头的行），否则后面紧跟的
 * 说明注释会被一起吞进来。
 *
 * 收口按**缩进**判：正文行的缩进必须比键**更深** ⇒ 回到同级（下一个 env 键）或更浅
 * 就是这一份折叠标量的末尾。⚠️ 这一条不是洁癖：只按「行首有空白且不是注释」收口的话，
 * 键后面**紧跟下一个键**（中间没有注释行）时会把下一整个键吞进正文 —— 而「这份清单
 * 后面恰好有注释」是配置里的巧合，不是保证。
 *
 * @param {string} text `.cnb.yml` 原文
 * @param {string} key 键名
 * @returns {string | null}
 */
function foldedScalar(text, key) {
  const lines = String(text ?? "").split("\n");
  const keyRe = new RegExp(`^([ \\t]*)${key}:`);
  let start = -1;
  let keyIndent = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const m = keyRe.exec(lines[i] ?? "");
    if (!m) continue;
    start = i;
    keyIndent = (m[1] ?? "").length;
    break;
  }
  if (start < 0) return null;
  /** @type {string[]} */
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    /* 空行与注释行都收口（YAML 折叠标量的正文里不会出现这两种行）。 */
    if (!/\S/.test(line)) break;
    if (/^\s*#/.test(line)) break;
    const indent = (/^[ \t]*/.exec(line)?.[0] ?? "").length;
    if (indent <= keyIndent) break;
    body.push(line);
  }
  return body.length > 0 ? body.join("\n") : null;
}

/**
 * `.cnb.yml` 的 `env` 里登记的 PR 档 stage **有序清单**（`COMFYAPP_CI_GATES`）。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {string[]} stage 名（已 trim）
 */
export function registeredGateOrder(text) {
  const body = foldedScalar(text, "COMFYAPP_CI_GATES");
  if (body === null) return [];
  return body
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * `.cnb.yml` 的 `env` 里登记的**临时停用** stage 清单（`COMFYAPP_CI_DISABLED_GATES`）。
 *
 * 名字在这儿 = 它是**被停用的**，不在 `GATES` 也不在这儿 = 它是**被删掉的**。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {string[]} 被停用的 stage 名（已 trim）
 */
export function registeredDisabledGates(text) {
  const body = foldedScalar(text, "COMFYAPP_CI_DISABLED_GATES");
  if (body === null) return [];
  return body
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * `.cnb.yml` 的 `env` 里登记的**「执行者在别处」**那张表（`COMFYAPP_CI_GATES_ELSEWHERE`）。
 *
 * 每一项的形状是 `名字=入口路径`；一个名字可以登记多个入口，用 `|` 分隔。
 * 登记的是**指针**（哪个脚本 / 哪份用例文件），不是执行者自己的定义 ——
 * 判据去执行面核那个指针，不在这里抄第二份（§12.12 / §12.18）。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {Map<string, string[]>} 名字 → 入口路径（可能为空数组 = 登记了但没写入口）
 */
export function registeredElsewhereGates(text) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  const body = foldedScalar(text, "COMFYAPP_CI_GATES_ELSEWHERE");
  if (body === null) return out;
  for (const item of body
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const eq = item.indexOf("=");
    if (eq < 0) {
      out.set(item, []);
      continue;
    }
    out.set(
      item.slice(0, eq).trim(),
      item
        .slice(eq + 1)
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return out;
}

/**
 * 配置里**以注释形态留着**的 stage 名（停用形态与「换执行者」形态都是它）。
 *
 * @param {string} text `.cnb.yml` 原文
 * @returns {Set<string>}
 */
export function commentedStageNames(text) {
  const out = new Set();
  for (const line of String(text ?? "").split("\n")) {
    const m = /^\s*#\s*-\s+name:\s*(\S.*?)\s*$/.exec(line);
    if (m?.[1]) out.add(m[1]);
  }
  return out;
}

/**
 * 从一段命令里抽出**入口路径**（脚本 / 用例文件）。
 *
 * 只认三个前缀 —— 执行面就这三处：`scripts/`（判据）、`tools/`（入口）、`tests/`（用例）。
 * `node_modules/.bin/vitest run tests/a.test.ts` ⇒ 抽出 `tests/a.test.ts`。
 *
 * @param {string} text 一行命令
 * @returns {string[]}
 */
export function scriptPaths(text) {
  return [
    ...new Set(
      String(text ?? "").match(
        /(?:scripts|tools|tests)\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+/g,
      ) ?? [],
    ),
  ];
}

/**
 * 判据本体：清单里的每个名字，执行者是谁。
 *
 * @param {{
 *   cnbText: string,
 *   liveStages?: Iterable<string>,
 *   heavyGates?: ReadonlyArray<{argv: readonly string[]}>,
 *   fixedTests?: readonly string[],
 *   hookSteps?: ReadonlyArray<{argv: readonly string[]}>,
 * }} deps
 * @returns {string[]} 逐条不一致（人读的话术）；空数组 = 通过
 */
export function gateNameExecutorProblems(deps) {
  const {
    cnbText,
    liveStages = [],
    heavyGates = [],
    fixedTests = [],
    hookSteps = [],
  } = deps;
  /** @type {string[]} */
  const problems = [];

  const gates = registeredGateOrder(cnbText);
  const disabled = new Set(registeredDisabledGates(cnbText));
  const elsewhere = registeredElsewhereGates(cnbText);
  const live = new Set(liveStages);

  /* 执行面三处：复合档条目 / 固定清单用例 / 钩子步骤行。 */
  const heavyPaths = new Set();
  for (const g of heavyGates) {
    for (const p of scriptPaths(g.argv.join(" "))) heavyPaths.add(p);
  }
  const fixedSet = new Set(fixedTests);
  const hookPaths = new Set();
  for (const s of hookSteps) {
    for (const p of scriptPaths(s.argv.join(" "))) hookPaths.add(p);
  }
  /** @param {string} p */
  const known = (p) => heavyPaths.has(p) || fixedSet.has(p) || hookPaths.has(p);

  /* ① 清单里的每个名字都要有执行者。 */
  for (const name of gates) {
    if (live.has(name)) continue;
    if (elsewhere.has(name)) {
      const paths = elsewhere.get(name) ?? [];
      if (paths.length === 0) {
        problems.push(
          `「${name}」登记了「执行者在别处」，但没写入口路径 —— 判据无从知道它归谁执行`,
        );
        continue;
      }
      const dead = paths.filter((p) => !known(p));
      if (dead.length > 0) {
        problems.push(
          `「${name}」登记的执行者入口（${dead.join(" / ")}）在复合档条目 / 固定清单 / 钩子步骤` +
            "三面里都找不到 —— 登记与执行面对不上（这一格现在没有执行者）",
        );
      }
      continue;
    }
    if (disabled.has(name)) {
      problems.push(
        `「${name}」既在 PR 清单里、又在停用登记里 —— 既跑又停，两个判据各说各话`,
      );
      continue;
    }
    problems.push(
      `「${name}」在 PR 清单里，却既没有自己的 stage、也没登记「执行者在别处」 —— ` +
        "它的执行者是谁？配置里只由注释表达的那件事，机器判不了（这就是本条判据要治的）",
    );
  }

  /* ② 登记表自己也要被核（三条反向）。 */
  for (const [name, paths] of elsewhere) {
    if (!gates.includes(name)) {
      problems.push(
        `「${name}」登记了「执行者在别处」，但它不在 PR 清单里 —— 登记与清单对不上`,
      );
    }
    if (live.has(name)) {
      problems.push(
        `「${name}」既有自己的 stage、又登记了「执行者在别处」 —— 重复登记，` +
          "读的人得自己猜哪一处才是真的",
      );
    }
    for (const p of paths) {
      if (!known(p)) {
        problems.push(
          `「${name}」登记的执行者入口「${p}」不在任何执行面里` +
            "（复合档条目 / 固定清单用例 / 钩子步骤）—— 登记指向了一个没人跑的东西",
        );
      }
    }
  }

  /* ③ 停用与换执行者都登记不到的「注释形态残留」：既不是停用，也不是在跑。 */
  const commented = commentedStageNames(cnbText);
  for (const name of commented) {
    if (gates.includes(name)) continue;
    if (disabled.has(name)) continue;
    if (elsewhere.has(name)) continue;
    problems.push(
      `「${name}」在配置里以注释形态留着，却既不在 PR 清单、也不在停用登记、` +
        "也不在「执行者在别处」那张表里 —— 它既不是停用也不是在跑（这是「删掉了但没人说」那种形态）",
    );
  }

  return problems;
}

export { ROOT };
