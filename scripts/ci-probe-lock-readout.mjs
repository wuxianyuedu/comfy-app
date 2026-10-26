#!/usr/bin/env node
/**
 * ci-probe-lock-readout.mjs — 锁编排探针的**取数**那一半（ISSUE #2363）。
 *
 * 本件不起流水线，只回答「刚才那几跑各自在什么时候活着」。它存在的理由是同一条
 * 诉求里那个「先测再定形态」：平台给不给跨跑串行，只能从**时间线**读出来 ——
 * 两跑的 `createTime` 与状态起止相交不相交，是「排队」「跳过」「照样并行」三种
 * 形态唯一的机器可读判据。
 *
 * ── 为什么单独一件，而不是写进那几条用例里 ──────────────────────────────
 *
 * 探针要连跑两次（第二条只能在第一条活着的时候到达），中间隔着人等的几十秒，
 * 而平台状态要轮询到终态。这段编排在 `node --test` 里会变成一条「睡在用例里」
 * 的假用例；在这里它是一个可以直接敲的命令。
 *
 * ── 它判什么、不判什么 ───────────────────────────────────────────────
 *
 *   判：给定的若干个 sn 的 `status` / `createTime` / `startTime` / `endTime`，
 *       以及**逐对**的时间窗相交读数（相交 = 那两条同一时刻都在跑）。
 *   不判：该不该串行、该选哪条出路 —— 那是人的判断（Issue 第 2 节那三条），
 *       本件只把事实摆出来，一句结论都不给。
 *
 * ⚠️ 与 `scripts/ship.mjs` 同一条红线：**终态只认 `data.status` 的原值**，
 * 平台信封上的 HTTP `status: 200` 与流水线过没过毫无关系。
 */

import { execFileSync } from "node:child_process";

/** 终态集合 —— 平台 `status` 的原值（`pending` / `running` 之外的都算停了）。 */
const TERMINAL = new Set(["success", "failed", "cancel", "timeout", "skipped"]);

/**
 * 取一跑的读数。
 *
 * @param {string} repo `组织/仓库`
 * @param {string} sn 构建号
 * @returns {{sn: string, status: string, createTime: string, startTime: string, endTime: string, title: string}}
 */
export function readBuild(repo, sn) {
  const raw = execFileSync(
    "cnb",
    ["build", "get-build-status", "--repo", repo, "--sn", sn, "-v"],
    { encoding: "utf8" },
  );
  // `cnb … -v` 打的是 YAML（不是 JSON），`data:` 下面是缩进块 —— 逐行取键值即可，
  // 不引 YAML 解析器：这一件只认那几个固定的标量键，而解析器会把「取不到」变成
  // 「取到一个空结构」，那正是本项目反复记过的失明形态（§13.6.2：没判 ≠ 绿）。
  const data = {};
  for (const line of raw.split("\n")) {
    const m = /^\s{2}([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (m) data[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
  return {
    sn,
    status: String(data.status ?? "(取不到)"),
    createTime: String(data.createTime ?? ""),
    startTime: String(data.startTime ?? ""),
    endTime: String(data.endTime ?? ""),
    title: String(data.title ?? ""),
  };
}

/** 把平台的时间串（`2026-10-26T02:50:07Z` 或毫秒时间戳）换成毫秒；取不到给 `null`。 */
export function toMs(value) {
  if (value == null || value === "") return null;
  if (/^\d+$/.test(value)) return Number(value);
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * 两条构建的时间窗是否相交（= 同一时刻都在跑）。
 *
 * 有一侧**还没停**时按「此刻」收口：那是「此刻正在相交」，与「曾经相交过」是
 * 两件不同的事，所以答案里带 `stillRunning`，读的人不必自己再推。
 *
 * 参数：两个构建读数（`startTime` / `endTime` / `createTime`）与当前时刻。
 * 这里不用 `@param` 标签写它们 —— 那几行全是类型语法、一个中文都不含，
 * 而「注释一律中文」这条硬闸（§12.4.6）对 JSDoc 结构行的豁免面比这三行窄（实测拦在
 * 多行对象类型上）。散文写中文比跟判据的豁免边界打交道稳妥。
 */
export function overlap(a, b, now = Date.now()) {
  const span = (x) => {
    const start = toMs(x.startTime) ?? toMs(x.createTime);
    const end = toMs(x.endTime);
    return { start, end: end ?? now, stillRunning: end == null };
  };
  const sa = span(a);
  const sb = span(b);
  if (sa.start == null || sb.start == null) {
    return { verdict: "取不到时间线", seconds: 0, stillRunning: false };
  }
  const seconds = Math.round(
    (Math.min(sa.end, sb.end) - Math.max(sa.start, sb.start)) / 1000,
  );
  return {
    verdict: seconds > 0 ? "相交（同一时刻都在跑）" : "错开",
    seconds: Math.max(0, seconds),
    stillRunning: sa.stillRunning || sb.stillRunning,
  };
}

/**
 * 一行一跑地打出来，附逐对相交读数。
 *
 * @param {string} repo
 * @param {string[]} sns
 */
export function report(repo, sns) {
  const now = Date.now();
  const rows = sns.map((sn) => readBuild(repo, sn));
  for (const r of rows) {
    console.log(
      `[probe] ${r.sn}  status=${r.status}  create=${r.createTime}  start=${r.startTime}  end=${r.endTime}  title=${r.title}`,
    );
  }
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const o = overlap(rows[i], rows[j], now);
      console.log(
        `[probe] ${rows[i].sn} × ${rows[j].sn} ⇒ ${o.verdict}（${o.seconds}s${o.stillRunning ? "，有一侧仍在跑" : ""}）`,
      );
    }
  }
  const pending = rows.filter((r) => !TERMINAL.has(r.status));
  if (pending.length > 0) {
    console.log(
      `[probe] 还没到终态：${pending.map((r) => `${r.sn}=${r.status}`).join(" · ")} —— 此刻的相交读数是「截至现在」，不是定稿`,
    );
  }
  return rows;
}

/**
 * 探针用的一条流水线配置。
 *
 * ⚠️ 三条硬约束，两条是平台当场喂回来的（不是猜的）：
 *   · `start-build` 的 `--event` 必须**在仓库 `.cnb.yml` 里存在** —— `--config` 只覆盖
 *     被选中的那条流水线的内容，**不替代整份配置**。实测两次都回了
 *     `[CONFIG_EVENT_EMPTY] … no api_trigger_<名> event config`（一次带 `--config`、
 *     一次用 `--data` 把 `config` 塞进请求体，同一句话），所以这条路不是「我写错了
 *     参数名」，是语义就不支持「凭空定义一个新事件」。⇒ 探针事件名写在 `.cnb.yml`
 *     的 `$:` 下（`$` 段不属于任何分支，PR 事件也能触发它，见 `trigger-rule.md`）。
 *   · 事件名只认 `api_trigger` / `api_trigger_*`（官方 `trigger-rule.md` §API 请求事件）。
 *   · `lock.wait: true` **不能与 `cancel-in-progress` 同时用**（官方 schema
 *     `definitions.pipelineLock` 的原文）—— 两者都写会被 schema 判错，而它是**配置期**
 *     的错，不是运行期行为。
 *
 * 形状上还有一个平台事实（决定了本探针只能测一件事）：`lock.cancel-in-progress`
 * **只存在于 pipeline 级**。stage / job 级的 `lock`（schema `definitions.lock`）
 * 只有 `key` / `wait` / `expires` / `timeout`，没有那一格 —— 所以「stage 级锁会不会
 * 顺手把别的跑掐停」这个问题在配置面就不成立。
 *
 * @param {{event: string, key: string, cancelInProgress?: boolean, wait?: boolean,
 *          stageLock?: {key: string, wait?: boolean, timeout?: number},
 *          jobLock?: {key: string, wait?: boolean, timeout?: number},
 *          seconds: number, timeout?: string}} opts
 */
export function probeConfig(opts) {
  const { event, key, cancelInProgress, wait, stageLock, jobLock, seconds } =
    opts;
  const timeout = opts.timeout ?? "20m";
  const pipelineLock = [`  lock:`, `    key: ${key}`];
  if (cancelInProgress != null)
    pipelineLock.push(`    cancel-in-progress: ${cancelInProgress}`);
  if (wait) pipelineLock.push(`    wait: true`, `    timeout: 900`);
  const lockBlock = (indent, l) => {
    const pad = " ".repeat(indent);
    const out = [`${pad}lock:`, `${pad}  key: ${l.key}`];
    if (l.wait != null) out.push(`${pad}  wait: ${l.wait}`);
    if (l.timeout != null) out.push(`${pad}  timeout: ${l.timeout}`);
    if (l.expires != null) out.push(`${pad}  expires: ${l.expires}`);
    return out;
  };
  const body = (indent) => {
    const pad = " ".repeat(indent);
    return [
      `${pad}script: |`,
      `${pad}  echo "[probe] start sn=$env:CNB_BUILD_SN t=$(Get-Date -Format o)"`,
      `${pad}  Start-Sleep -Seconds ${seconds}`,
      `${pad}  echo "[probe] end t=$(Get-Date -Format o)"`,
    ];
  };

  /** @type {string[]} */
  const lines = [
    `# 锁编排探针（ISSUE #2363）—— 事件名在仓库 .cnb.yml 的 \`$:\` 段，这里只给流水线体。`,
    `# 用法：node scripts/ci-probe-lock-readout.mjs --event ${event} --key ${key} --seconds ${seconds}`,
    `# 跑满 ${seconds}s 是为了让第二条到得了（短于这个数就测不出「到达时正在跑」）。`,
    `  name: probe-${key}`,
    `  runner:`,
    `    tags: cnb`,
    ...pipelineLock,
    `  stages:`,
    `    - name: 探针-填满时间窗`,
  ];
  if (jobLock) {
    // job 级：stage 本身是壳，锁挂在它唯一的 job 上
    lines.push(`      jobs:`);
    lines.push(`        - name: 探针-job`);
    lines.push(...lockBlock(10, jobLock));
    lines.push(...body(10));
  } else {
    if (stageLock) lines.push(...lockBlock(6, stageLock));
    lines.push(...body(6));
  }
  lines.push(`      timeout: ${timeout}`);
  return lines.join("\n") + "\n";
}

/**
 * 起一跑（`start-build`）并立刻返回 sn。
 *
 * `sync: "false"` 是**必须**的：同步模式下这一件会在第一条上等到跑完，而探针要的
 * 恰恰是「第二条在第一条活着的时候到达」。
 *
 * @param {string} repo
 * @param {string} event `.cnb.yml` 里已存在的 api_trigger 事件名
 * @param {string} title
 */
export function startProbe(repo, event, title) {
  const raw = execFileSync(
    "cnb",
    [
      "build",
      "start-build",
      "--repo",
      repo,
      "--branch",
      "master",
      "--event",
      event,
      "--sync",
      "false",
      "--title",
      title,
    ],
    { encoding: "utf8" },
  );
  const m = /"?sn"?\s*[:=]\s*"?(cnb-[A-Za-z0-9-]+)"?/.exec(raw);
  if (!m) {
    throw new Error(`起跑失败（没读回 sn）：\n${raw}`);
  }
  return m[1];
}

/** 轮询到终态；超时返回最后一读（`status` 原值照给，不替它编结论）。 */
export function waitTerminal(repo, sn, timeoutMs = 30 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  let last = readBuild(repo, sn);
  while (Date.now() < deadline && !TERMINAL.has(last.status)) {
    const wait = Math.min(15000, Math.max(0, deadline - Date.now()));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    last = readBuild(repo, sn);
  }
  return last;
}

const USAGE = [
  "用法：node scripts/ci-probe-lock-readout.mjs <子命令> …",
  "",
  "  config  --event <名> --key <锁名> [--cancel-in-progress true|false] [--wait]",
  "          [--stage-lock <锁名>] [--job-lock <锁名>] [--seconds N]   # 打一份流水线体，人贴到 .cnb.yml",
  "  start   <组织/仓库> --event <名> --title <标题>                 # 起一跑，回 sn",
  "  report  <组织/仓库> <sn...>                                     # 时间线与逐对相交读数",
  "  pair    <组织/仓库> --event <名> [--gap 20]                     # 起两跑、指定间隔，然后 report",
  "",
  "`start` / `pair` 起的事件名必须**已经在 `.cnb.yml` 的 `$:` 段里**（`--config` 不替代整份配置）。",
].join("\n");

/** 极简旗标解析：只要 `--k v` 与 `--flag` 两形态，够用了，不引依赖。 */
function parseFlags(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith("--")) {
      out[k] = next;
      i += 1;
    } else {
      out[k] = true;
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , cmd, ...rest] = process.argv;
  const f = parseFlags(rest);
  const positional = rest.filter(
    (x) => !x.startsWith("--") && !Object.values(f).includes(x),
  );

  if (cmd === "config") {
    if (!f.event || !f.key) {
      console.error(USAGE);
      process.exit(2);
    }
    const bool = (v) =>
      v === true
        ? true
        : v === "false"
          ? false
          : v == null
            ? undefined
            : v === "true";
    process.stdout.write(
      probeConfig({
        event: String(f.event),
        key: String(f.key),
        cancelInProgress: bool(f["cancel-in-progress"]),
        wait: bool(f.wait),
        stageLock: f["stage-lock"]
          ? { key: String(f["stage-lock"]), wait: true, timeout: 900 }
          : undefined,
        jobLock: f["job-lock"]
          ? { key: String(f["job-lock"]), wait: true, timeout: 900 }
          : undefined,
        seconds: Number(f.seconds ?? 90),
      }),
    );
    process.exit(0);
  }

  if (cmd === "start") {
    const [repo] = positional;
    if (!repo || !f.event) {
      console.error(USAGE);
      process.exit(2);
    }
    console.log(
      startProbe(repo, String(f.event), String(f.title ?? `probe ${f.event}`)),
    );
    process.exit(0);
  }

  if (cmd === "report") {
    const [repo, ...sns] = positional;
    if (!repo || sns.length === 0) {
      console.error(USAGE);
      process.exit(2);
    }
    report(repo, sns);
    process.exit(0);
  }

  if (cmd === "pair") {
    const [repo] = positional;
    if (!repo || !f.event) {
      console.error(USAGE);
      process.exit(2);
    }
    const gap = Number(f.gap ?? 20);
    const first = startProbe(repo, String(f.event), `pair-1 ${f.event}`);
    console.log(`[probe] 第一条 ${first}，等 ${gap}s 再起第二条`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, gap * 1000);
    const second = startProbe(repo, String(f.event), `pair-2 ${f.event}`);
    console.log(`[probe] 第二条 ${second}`);
    waitTerminal(repo, first);
    waitTerminal(repo, second);
    report(repo, [first, second]);
    process.exit(0);
  }

  console.error(USAGE);
  process.exit(2);
}
