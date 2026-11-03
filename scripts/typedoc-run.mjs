#!/usr/bin/env node
// @ts-nocheck -- typedoc 的「跑 + 验 + 重试」唯一实现（`pnpm run docs` 与 `docs:check` 共用）
/**
 * typedoc-run.mjs — typedoc 的**唯一调用方式**：跑一次 → 验「这一次真的写了」 →
 * 失败重试 → 给一个「成功 / 为什么没成功」的结论。
 *
 * 背景（现场三件套同时出现，才看得出它不是「打字错误」而是判据缺口）：
 *   · 退出码 0；
 *   · 日志收尾写着 `[info] html generated at ./docs/api`；
 *   · 一条 `[warning] Found 0 errors and N warnings`；
 *   · 而 `docs/api/**` **一个文件都没更新**（内容、mtime 都停在上一轮）。
 *
 * 结论不是「typedoc 的清空/写出能力有问题」，而是**它的退出码与日志都不能当结论用**：
 * 写出的那一步失败时（Windows 上最常见的形态是目录里某个文件仍被占用 → EPERM /
 * EBUSY，或上一轮残留的进程还握着句柄），typedoc 照样按「成功」收尾。于是
 * 「跑没跑成功」这件事**在当时没有任何一个环节在判** —— 调用方拿到 0、日志读起来
 * 像成功、产物却原地不动，下一次发现的时机是「有人翻 `docs/api` 发现它过期」。
 *
 * 因此本模块把判据从「退出码」换成「产物」，并且失败时**重试**（瞬时占用等一等就会
 * 释放），全部尝试都失败才给非零结论：
 *   1. **验的是产物，不是退出码**：`index.html` 是 HTML 渲染器每一次必然重写的文件，
 *      它的 mtime 早于本次开始时刻 = 这一次没写 —— 这正是上面那个现场的形状
 *      （目录里还堆着上一轮的 2539 个文件，所以「文件数 > 0」这种判据会被蒙过去）。
 *   2. **失败重试**：占用类是瞬时的，等 1s / 3s 再试一次通常就过去了；重试次数与
 *      等待时长都是参数（`attempts` / `backoff`），调用方不必各写一套 `for`。
 *   3. **结论带证据**：返回体里带上 out 目录绝对路径、跑之前 / 跑之后的文件数与
 *      探针 mtime、typedoc 日志尾巴 —— 「产物没更新」这种事，没有这些数就只能靠猜。
 *
 * 谁在用它（**只此一处实现**，调用方不许再自己 `spawn` typedoc）：
 *   · `scripts/generate-api-docs.mjs`（= `pnpm run docs`，真写入 `docs/api`）；
 *   · `scripts/check-docs-api.cjs`（= `pnpm docs:check`，重生成到临时目录再比对）。
 *
 * 用法：
 *   const res = await runTypedoc({ outDir });
 *   if (!res.ok) … // 失败原因在 res.reason、日志尾巴在 res.log，
 *                   // 跑前 / 跑后的产物快照在 res.before / res.after
 * 退出码：本模块不退出进程（退出策略归调用方），只给结论。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { resolvePackageBinEntry } from "./package-bin-entry.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 默认尝试次数（含第一次）。占用类失败等一等就过，所以默认不是 1。 */
export const DEFAULT_ATTEMPTS = 3;
/** 两次尝试之间的等待（毫秒）：第 n 次失败后取第 n 项，超出取最后一项。 */
export const DEFAULT_BACKOFF_MS = [1000, 3000];
/** 交给调用方的 typedoc 日志尾巴行数（失败时给修法线索，不给全量刷屏）。 */
const LOG_TAIL_LINES = 12;
/** mtime 与「本次开始时刻」之间容许的误差：文件系统时间戳粒度 / 时钟取整。 */
const FRESH_SKEW_MS = 2000;
/**
 * 「这一次真的写了」的探针文件 —— HTML 渲染器每一次都会重写它。
 * 判据必须挑一个**每次都写**的文件：挑某个模块的页面会因为「这个模块本轮没变」
 * 而假红，挑目录里的文件总数又会被「上一轮留下的 2539 个文件」蒙过去。
 */
export const PROBE_REL = "index.html";

/**
 * 本地 typedoc 的 **JS 入口**（绝对路径）；没有装就给 null（调用方据此提示 `pnpm install`）。
 *
 * 为什么不是 `node_modules/.bin/typedoc(.cmd)`（ISSUE #2445）：垫片是给宿主 shell
 * 用的 —— Windows 上经 `.cmd` 就得开一层 shell，而那既是 Node 26 的
 * DEP0190 弃用形态（args 数组 + 开 shell），又要手工括引号（开了 shell Node 就
 * 不给参数转义，含空格的路径自己括，括错就是「换台机器跑不起来」）。
 * `.cmd` 垫片底下本来就一行 `node …/typedoc/bin/typedoc %*` —— 直接起那行真身，
 * 引号与弃用两件事同时消失。
 *
 * 解析口径**只有一份实现**：`scripts/package-bin-entry.mjs` 的
 * `resolvePackageBinEntry`（ISSUE #2453）。它原先在这里与 `run-affected-tests.mjs`
 * 的 `resolveVitestEntry` 各写了一遍（同算法两份副本），加上 storybook 那一处就是三份
 * —— 抄一份的漂移形态是「换安装方式后其中一份指到空气上，另外两份还绿」。
 * 三条理由（为什么走 `require.resolve("<pkg>/package.json")` 而不是拼
 * `node_modules/<pkg>/…`）写在那个模块的文件头，此处不重抄。
 *
 * @param {string} root 仓库根
 * @returns {string | null}
 */
export function resolveTypedocEntry(root = ROOT) {
  return resolvePackageBinEntry("typedoc", { root });
}

/**
 * 产物目录的一次快照：判据只看这三件事（存在 / 文件数 / 探针 mtime）。
 * @param {string} outDir 绝对路径
 */
export function snapshotOutput(outDir) {
  let probeMtimeMs = null;
  try {
    probeMtimeMs = fs.statSync(path.join(outDir, PROBE_REL)).mtimeMs;
  } catch {
    // 目录不存在或探针还没产出：两者都归「还没写」，不区分（区分了也只是措辞不同）
  }
  return {
    exists: fs.existsSync(outDir),
    files: countFiles(outDir),
    probeMtimeMs,
  };
}

/**
 * 递归数文件（不穿符号链接：产物目录里若有人手放了一个指向别处的链接，跟着走会把
 * 无关文件算进「文件数」，与 `check-docs-api.cjs` 的 `walk` 同口径）。
 * @param {string} dir 绝对路径
 */
function countFiles(dir) {
  let n = 0;
  /** @param {string} cur */
  const rec = (cur) => {
    let ents;
    try {
      ents = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (ent.isSymbolicLink()) {
        continue;
      }
      if (ent.isDirectory()) {
        rec(path.join(cur, ent.name));
      } else if (ent.isFile()) {
        n += 1;
      }
    }
  };
  rec(dir);
  return n;
}

/**
 * 给一次 typedoc 运行下结论：**看产物，不看退出码**。
 *
 * 顺序有讲究：先把「起不来 / 非零退出」这些**有声音**的失败排掉，最后一条才是那个
 * 无声的（退出 0 但没写）—— 它的措辞要能让下一个人一眼认出「就是这个现场」。
 * @param {{status: number | null, signal?: string | null, error?: Error | null}} run
 * @param {{after: ReturnType<typeof snapshotOutput>, startedAt: number}} ctx
 * @returns {{ok: boolean, reason: string}}
 */
export function judgeRun(run, { after, startedAt }) {
  if (run.error) {
    return {
      ok: false,
      reason: `typedoc did not start (${run.error.code ?? "UNKNOWN"}): ${run.error.message}`,
    };
  }
  if (run.status !== 0) {
    const sig = run.signal ? ` / signal ${run.signal}` : "";
    return { ok: false, reason: `typedoc exit code ${run.status}${sig}` };
  }
  if (!after.exists) {
    return { ok: false, reason: `output dir missing after run` };
  }
  if (after.files === 0) {
    return { ok: false, reason: `output dir is empty after run` };
  }
  if (after.probeMtimeMs === null) {
    return { ok: false, reason: `${PROBE_REL} missing after run` };
  }
  if (after.probeMtimeMs < startedAt - FRESH_SKEW_MS) {
    return {
      ok: false,
      reason:
        `exit 0 but nothing was written this run ` +
        `(${PROBE_REL} mtime ${new Date(after.probeMtimeMs).toISOString()} ` +
        `< run start ${new Date(startedAt).toISOString()})`,
    };
  }
  return { ok: true, reason: "" };
}

/**
 * 起一次 typedoc：日志**原样透传**（给使用者看），同时攒一份尾巴（给结论用）。
 * @param {string} entry typedoc 的 JS 入口（`resolveTypedocEntry` 的产出）
 * @param {string} outDir 输出目录（绝对路径）
 * @param {string} root 仓库根（typedoc.json 在这里）
 */
async function spawnTypedoc(entry, outDir, root) {
  return new Promise((resolve) => {
    // 直接以 node 起 typedoc 的 JS 入口（ISSUE #2445）：不经 `.cmd` 垫片就没有
    // shell 层 —— DEP0190（args 数组 + 开 shell）与「含空格路径自己括引号」
    // 两个形态一起消失，参数由 Node 原生转义（与 `run-affected-tests.mjs` /
    // `check-format.cjs` 那批 `spawnSync(process.execPath, [entry, …])` 同一链路）。
    const child = spawn(process.execPath, [entry, "--out", outDir], {
      cwd: root,
      env: { ...process.env },
    });
    /** @type {string[]} */
    const lines = [];
    const keep = (buf) => {
      lines.push(...String(buf).split(/\r?\n/));
      if (lines.length > 400) {
        lines.splice(0, lines.length - 400);
      }
    };
    child.stdout?.on("data", (b) => {
      process.stdout.write(b);
      keep(b);
    });
    child.stderr?.on("data", (b) => {
      process.stderr.write(b);
      keep(b);
    });
    const tail = () =>
      lines
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-LOG_TAIL_LINES)
        .join("\n");
    child.on("error", (error) => {
      resolve({ status: null, signal: null, error, log: tail() });
    });
    child.on("close", (status, signal) => {
      resolve({ status, signal, error: null, log: tail() });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 跑 typedoc（含重试与产物校验），给结论。
 *
 * @param {object} opts
 * @param {string} opts.outDir 输出目录（绝对路径）
 * @param {string} [opts.root] 仓库根
 * @param {number} [opts.attempts] 最大尝试次数
 * @param {number[]} [opts.backoff] 两次尝试之间的等待
 * @param {(entry: string, outDir: string, root: string) => Promise<{status: number|null, signal?: string|null, error?: Error|null, log: string}>} [opts.spawnImpl]
 *        起进程的注入缝：typedoc 冷跑以百秒计（现值取法见规范 §13.5.17），契约测试不可能真跑它，于是把
 *        「起了但没写」这种现场直接喂进来（见 `tests/typedoc-run.test.ts`）。
 * @param {(msg: string) => void} [opts.onProgress] 每次尝试的结论（默认打到 stderr）
 * @returns {Promise<{ok: boolean, outDir: string, attempt: number, total: number, files: number, reason: string, log: string, before: ReturnType<typeof snapshotOutput>, after: ReturnType<typeof snapshotOutput}>} 结论对象：`ok` 成没成、`attempt` 第几次成的（失败时等于最后一次）、`files` 产物文件数、`reason` 没成的原因（成功时是空串）、`log` 日志尾巴、`before` / `after` 跑前与跑后的产物快照。
 *   两个快照写成 `ReturnType<typeof snapshotOutput>` 而不是 `object`（同文件
 *   `judgeRun` 的入参早就是这个引用）：`object` 会把快照的三个字段抹掉，消费点
 *   （`generate-api-docs.mjs` 打 `files before=/after=`）在声明面上取不到自己
 *   已经在读的字段。
 */
export async function runTypedoc({
  outDir,
  root = ROOT,
  attempts = DEFAULT_ATTEMPTS,
  backoff = DEFAULT_BACKOFF_MS,
  spawnImpl = spawnTypedoc,
  onProgress = (msg) => {
    console.error(`[typedoc] ${msg}`);
  },
}) {
  const total = Math.max(1, attempts);
  const entry = resolveTypedocEntry(root);
  const empty = () => ({ exists: false, files: 0, probeMtimeMs: null });
  if (!entry) {
    return {
      ok: false,
      outDir,
      attempt: 0,
      total,
      files: 0,
      reason: `typedoc not installed (no resolvable entry) -- run pnpm install first`,
      log: "",
      before: empty(),
      after: empty(),
    };
  }

  /** @type {any} */
  let last = null;
  for (let attempt = 1; attempt <= total; attempt += 1) {
    const before = snapshotOutput(outDir);
    const startedAt = Date.now();
    const run = await spawnImpl(entry, outDir, root);
    const after = snapshotOutput(outDir);
    const verdict = judgeRun(run, { after, startedAt });
    last = { attempt, run, before, after, verdict };
    if (verdict.ok) {
      onProgress(`attempt ${attempt}/${total} ok: ${after.files} files -> ${outDir}`);
      return {
        ok: true,
        outDir,
        attempt,
        total,
        files: after.files,
        reason: "",
        log: run.log,
        before,
        after,
      };
    }
    onProgress(`attempt ${attempt}/${total} failed: ${verdict.reason}`);
    if (attempt < total) {
      await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0);
    }
  }
  return {
    ok: false,
    outDir,
    attempt: last.attempt,
    total,
    files: last.after.files,
    reason: last.verdict.reason,
    log: last.run.log,
    before: last.before,
    after: last.after,
  };
}
