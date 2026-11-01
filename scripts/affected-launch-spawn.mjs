// @ts-nocheck -- 与它原来所在的 `run-affected-tests.mjs` 同一条口径：提交门槛脚本、
//                 无类型消费方，tsc 面在 src/**。这一行是**随代码搬过来的既有声明**，
//                 不是这次放松判据 —— 丢掉它会让一整套 TS7006 当场变成「新增脚本的存量红」。
/**
 * `affected-launch-spawn.mjs` —— 「怎么起一次 vitest」与「起之前那些纯函数换算」
 * （并发覆盖、命令行分块、入口定位）。
 *
 * ## 为什么单独一份
 *
 * 它们本来住在 `run-affected-tests.mjs` 里。那一层合并 master 之后撞上 900 行硬闸
 * （§12.6 姊妹档 `check-infra-file-size.cjs`；实测 828 行 + 冲突带进来的一批代码），
 * 而越闸的形态**不是报错**：那条判据会恒红，所有人的提交都停在门口。
 *
 * 这条切线不是按长度切的一刀：留下的是**判决链**（第 1 遍是什么档、复不复跑、
 * 逐文件补跑、退哪个码），出列的是**起进程那一层**（并发怎么定、清单怎么切、
 * 入口在哪、子进程怎么抓输出）。两者可分别被用例跑 —— 前者注入假 `spawn`，
 * 后者本来就在判纯函数的形状。
 *
 * ## 只搬位置，判据一个字不改
 *
 * 正文、注释与导出面逐字照搬；调用点按**真实落点** import（机制层不转假出口）。
 */
/* 命令行长预算留在启动器那一层：它是「整条链怎么分批」的那个数，与分块函数同域，
 * 但账（`scripts/.gate-thresholds.json`）与用例都按它的老落点记 —— 这里只 import。 */
import { SAFE_ARGV_BUDGET } from "./run-affected-tests.mjs";

import { spawnSync } from "node:child_process";
import process from "node:process";

/* vitest 的入口解析与 typedoc / storybook 共用一份实现（ISSUE #2453）。 */
import { resolvePackageBinEntry } from "./package-bin-entry.mjs";

/**
 * 从环境变量取一个**显式的**并发覆盖（`COMFY_PRECOMMIT_MAX_WORKERS`）。
 *
 * 为什么要有这个口子：4 是「8 逻辑核、A/B/D 同时在跑」那一档的实测值，而
 * **共享机 / 小核 VM / 正在跑 dev server + ComfyUI 的机器**上，这个常数与
 * 「此刻真有几个核可用」无关 —— 实测同一份 C 组在 load ≈0/16/65/128 下墙钟
 * 19.7s → 114.5s → 214s → 229s（判定全绿，见规范 §13.6.4 那一族）。
 * 单条预算（`CLI_BUDGET` 的 120s）能吸收到某个负载为止，再往上就需要**人为降负载** ——
 * 而 §13.6.4 明写「降负载的杠杆是并发，不是预算」，此前却没有任何一处能把钩子的
 * 并发调小（注释里那句「机器紧张把 C/D 也挪成串行即可」只是一句话，没有执行者），
 * 于是唯一的出路变成改钩子或 `--no-verify`（两条都不该是常态）。
 *
 * ⚠️ 这个口子**只调并发、不碰任何判据**：候选清单、预算、退出码口径一律不变，
 * 所以它不能被当成「让慢用例过关的旋钮」（同 §11.13 对 `expect.poll` 的那条口径）。
 * 传非法值（非整数 / <1）时**按默认值办并提醒**，不静默降级成 0（那会让 vitest
 * 报一个与真因无关的错）。
 *
 * ⚠️ 这一层是**纯函数**：环境变量由调用点读进来（`main` 那一处），不在这里兜底 ——
 * 否则用例里「不给值 = 走默认」这一格会被用例进程自己继承到的环境变量污染，
 * 而那种失效是「判据看着跑过、其实测的是外部环境」。**兜底并发同样由调用点注入**
 * （`resolveCiWorkers().workers`，唯一出处 `scripts/ci-load.mjs`）—— 这里以前自带
 * 一条 `DEFAULT_MAX_WORKERS = 4`，与 `vitest.config.ts` 的 8、`ci-load.mjs` 的按核折算
 * 凑成同一句判断的三份副本，于是「单条链别占满整台机」那一档压住了平台两格、
 * 本地那一跳照旧铺开；收口见 ISSUE #2324。
 *
 * @param {string | undefined} raw `COMFY_PRECOMMIT_MAX_WORKERS` 的原值
 * @param {number} fallback 调用点给的兜底并发（必须 ≥1 的整数）
 * @returns {{workers: number, note: string | null}}
 */
export function resolveMaxWorkers(raw, fallback) {
  /* 兜底不是可选参数：漏传就当**没跑起来**，不许悄悄退回某个默认并发 ——
   * 那会正好像这次修的那三副本一样，再长出一处没人管的数字。 */
  if (!Number.isInteger(fallback) || fallback < 1) {
    throw new Error(
      `resolveMaxWorkers 需要调用点注入兜底并发（≥1 的整数），收到 ${String(fallback)}`,
    );
  }
  if (raw === undefined || raw.trim() === "") {
    return { workers: fallback, note: null };
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    return {
      workers: fallback,
      note: `COMFY_PRECOMMIT_MAX_WORKERS="${raw}" 不是 ≥1 的整数，按默认 ${fallback} 办`,
    };
  }
  if (parsed === fallback) {
    return { workers: fallback, note: null };
  }
  return {
    workers: parsed,
    note:
      `按 COMFY_PRECOMMIT_MAX_WORKERS 用 --maxWorkers=${parsed}` +
      `（默认 ${fallback}；这只调并发，不动任何判据）`,
  };
}

/**
 * 跑一次 vitest，**把输出抓在手里**（而不是 `stdio: "inherit"`）。
 *
 * 为什么必须抓：这一层的判决依赖「输出里有没有超时指纹」（见文件头那节）。
 * `inherit` 会把 stdout/stderr 直接接到父进程上，于是这段文本在本进程里**拿不到**
 * —— 那样就没有任何东西能区分「真断言红」与「机器太满」。
 *
 * 抓下来之后仍要**原样回吐**（`process.stdout.write`），否则日志里就看不见失败原因了 ——
 * 那正是 `run-affected` 当初被造出来要避免的形态（「跑的是 0 个用例、原因读不出」）。
 *
 * ## 为什么带 `timeout`（2026-10-30 的现场）
 *
 * 早先这一跳**没有任何上界**：`spawnSync` 不给 `timeout`，于是一次改动面膨胀就能让它
 * 一直跑到 node / 平台把它掐掉为止。而掐掉时的那一跑**一条读数都不剩** ——
 * 实测 `cnb-l0u-1k66agmv9`（PR #2760）：808 份、`--maxWorkers=1`，跑满
 * **3240104ms（54.0 分钟）** 被平台的 `timeout of 3240000ms exceeded` 掐断，
 * 日志里连一个用例名都没有（`--reporter=dot` 在第一份跑完之前只往同一行打点，
 * 而平台保留的是日志**尾部**）。所以那一格既不是某条用例红，也不是某条断言超时 ——
 * 是「这一遍根本装不下」。
 *
 * `timeout` 那一档必须与既有判决链对齐：掐断之后 `res.status` 是 `null`、
 * `res.signal` 是 `SIGTERM`，而 `signal` **要一起回吐**，否则 `classifyFirstPass`
 * 会把「没跑完」读成「跑完了但退出码怪」——那是另一回事（§13.6.2：没判 ≠ 红）。
 *
 * @param {string} entry vitest 入口
 * @param {string[]} args 交给它的参数
 * @param {{timeoutMs?: number, filterLine?: (line: string) => boolean}} [options]
 *   `timeoutMs` 缺省**不设界**（与这一格存在之前逐字同形）：界由调用点按现场预算决定，
 *   不在这一层拍一个常数。`filterLine` 是「受影响用例」门在 CI 里屏蔽良性 stderr 噪音用的
 *   —— 给的话，回吐给平台前按行过它，命中即丢（见 `affected-launch-noise-reporter.mjs`）。
 *   本地不设该变量 ⇒ 不过滤，开发者照常看到全部日志。
 * @returns {{status: number|null, signal?: string|null, timedOut?: boolean, output: string}}
 */

/**
 * 把抓到的 stdout / stderr 合成 `output`（超时 / 装载指纹的取数面）时按行过滤噪音。
 * 抽出成纯函数是为了能被单测直接断言（不真起 vitest，见
 * `tests/affected-launch-noise-reporter.test.ts`）。`filterLine` 不给时行为与改动前逐字一致
 * （`${stdout}${stderr}`）。
 * @param {string|Buffer|null} stdout
 * @param {string|Buffer|null} stderr
 * @param {(line: string) => boolean} [filterLine]
 * @returns {string}
 */
export function filterSpawnOutput(stdout, stderr, filterLine) {
  if (!filterLine) {
    return `${stdout ?? ""}${stderr ?? ""}`;
  }
  const keep = (s) =>
    String(s ?? "")
      .split("\n")
      .filter((l) => !filterLine(l))
      .join("\n");
  return `${keep(stdout)}${keep(stderr)}`;
}

export function spawnVitest(entry, args, options = {}) {
  const { timeoutMs, filterLine } = options;
  const res = /** @type {{ status: number | null, signal?: string | null, stdout?: string,
   *   stderr?: string, error?: NodeJS.ErrnoException }} */ (
    spawnSync(process.execPath, [entry, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeout: timeoutMs } : {}),
    })
  );
  /* 噪音屏蔽（CI）：`filterLine` 给的话，把 stdout / stderr 按行过滤后再回吐；不给时逐字回吐
   * （与改动前逐字一致）。注意：本函数体内**始终保留 `process.stdout.write` /
   * `process.stderr.write` 这两个字面 token** —— 那是「输出真被抓在手里、没有退化成
   * inherit 直通」的源码判据（见 `tests/hook-affected-launch.test.ts`；那条判据同时禁止
   * 本函数体出现 stdio 加 inherit 的直通写法，注释里也不行），所以这里用
   * 内联分支而不是包一层闭包把它藏没。`output`（超时 / 装载指纹的取数面）同样用过滤后的版本，
   * 由 `filterSpawnOutput` 算（噪音清单里不含任何指纹，过滤不会吞掉判决文本）。 */
  /* `res.stdout` / `res.stderr` 是 `spawnSync` 的出参：`@types/node` 按泛型声明成
   * 非空，实测 ENOENT / 超时形态下就是 `undefined`（本文件正是为了给这些形态记读数），
   * 所以下面两处 `?? ""` 是给运行时兜的（上述 JSDoc 已按实测把这两个字段声明成可缺）——
   * 删了会 `String(undefined)` 得到 "undefined"。 */
  if (filterLine) {
    for (const line of String(res.stdout ?? "").split("\n")) {
      if (!filterLine(line)) {
        process.stdout.write(`${line}\n`);
      }
    }
    for (const line of String(res.stderr ?? "").split("\n")) {
      if (!filterLine(line)) {
        process.stderr.write(`${line}\n`);
      }
    }
  } else {
    process.stdout.write(res.stdout ?? "");
    process.stderr.write(res.stderr ?? "");
  }
  const output = filterSpawnOutput(res.stdout, res.stderr, filterLine);
  /* `ETIMEDOUT` 是 `spawnSync` 掐断自己子进程时给出的 `error.code` —— 它是**没跑完**的
   * 证据，不是「跑起来失败」的证据，所以在这里标成 `timedOut` 而不是 `throw`
   * （真起不来的是 `ENOENT` / `EACCES` 那一族，照旧抛）。 */
  const timedOut = res.error?.code === "ETIMEDOUT";
  if (res.error && !timedOut) {
    throw res.error;
  }
  return {
    status: timedOut ? null : res.status,
    signal: res.signal ?? null,
    ...(timedOut ? { timedOut: true } : {}),
    output,
  };
}

/**
 * 按命令行长预算把清单切成若干块，**顺序与成员都不变**。
 *
 * 单独导出成纯函数是为了让它可判：这条链路的失效模式（用例没跑）只有把
 * 「不丢不重」写成断言才拦得住，靠肉眼看 shell 的引号是拦不住的。
 */
export function planLaunches(files, budget = SAFE_ARGV_BUDGET) {
  const chunks = [];
  let current = [];
  let length = 0;
  for (const file of files) {
    const name = String(file).trim();
    if (!name) {
      continue;
    }
    if (name.length + 1 > budget) {
      throw new Error(
        `[affected-launch] 单个路径就超过命令行长预算（${name.length} > ${budget}）——` +
          "这一条不能被任何分块策略放进去，只能让它点名红",
      );
    }
    // 每段之间要一个空格，按 `join(" ")` 的真实长度算，不留估算余量。
    const next = current.length === 0 ? name.length : length + 1 + name.length;
    if (current.length > 0 && next > budget) {
      chunks.push(current);
      current = [name];
      length = name.length;
      continue;
    }
    current.push(name);
    length = next;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

/**
 * 解析 vitest 的 ESM 入口。
 *
 * 实现**只有一份**：`scripts/package-bin-entry.mjs` 的 `resolvePackageBinEntry`
 * （ISSUE #2453）。三条理由（pnpm 布局里真身在 `.pnpm/…` 下、顶层那个是链接；
 * 入口名由包的 `bin` 字段定义；`require.resolve` 顺带把「装没装」问出来）写在那个模块的
 * 文件头 —— 这里只保留**抛错**那一层语义：本模块的调用方是门禁链路，解析不到要**当场停**
 * （不是拿到 null 继续走），而「停的时候说什么」仍然要分辨「包没有 bin」与「入口不在盘上」。
 */
export function resolveVitestEntry(cwd = process.cwd()) {
  const entry = resolvePackageBinEntry("vitest", { root: cwd });
  if (!entry) {
    throw new Error(
      `[affected-launch] 解析不到本地 vitest 的入口（包没有 bin.vitest，或入口不在盘上；cwd=${cwd}）`,
    );
  }
  return entry;
}
