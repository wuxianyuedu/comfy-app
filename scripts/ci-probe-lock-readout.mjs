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

import path from "node:path";

import { buildSnFromOutput, makeRunner } from "./ship-exec.mjs";

/** 工作树根：`makeRunner` 的 `cwd`（与 `ship` 那一路同一个宿主适配层，不再自带 `execFileSync`）。 */
const ROOT = path.resolve(import.meta.dirname, "..");
/** 外部命令的执行者（测试里整体替换 `cnbCall` 的出口）。 */
const run = makeRunner(ROOT);

/**
 * 起一次 `cnb`，把**「起不来」与「非零退出」都收成读数**，而不是让 spawn 层冒成一条 Node 栈。
 *
 * 为什么不在这里用隔壁那个 `cnbJson()`：它把三种情况折叠成同一个 `null`
 * （`:131` ENOENT / `:134` 没有 `{` / `:143` 解析失败），而本探针要的恰恰是**分清**这三件事 ——
 * 每种原因的下一动作不同（ISSUE #2690 的口径钉在这层）。所以复用只到 `makeRunner` 那一层。
 *
 * @param {string[]} args cnb 的参数（含 `-v`）
 * @param {(cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult} [runner]
 *   真起命令的那一格（默认用 `makeRunner(ROOT)`）。**用例必须从这里喂**：
 *   本件判的是「spawn 层报 ENOENT 时被不成一行读数」，而那条映射就发生在这一层 ——
 *   实测把 `r.error` 那支压成空串，只注入 `readBuild` 的取数出口的用例**照旧绿**
 *   （它绕过了这里），所以出口要开到真正起命令的那一层，不然判据是空的。
 * @returns {{failure: string, text: string}} `failure` 非空即这一次没有取到响应；
 *   `text` 是给下一层解析的原文（成功时只给 stdout，与改前逐字一致）
 */
export function cnbCall(args, runner = run) {
  const r = runner("cnb", args);
  if (r.error) {
    return { failure: `cnb 起不来：${r.error}`, text: "" };
  }
  if (r.status !== 0) {
    /* 错误面在 stderr（与 `ship-exec.mjs:62-65` 那条同源：只接 stdout 会念不出理由），
     * 但**只截前 120 字**：平台失败时的原文可能带请求行，整段转发不是这份探针的职责。 */
    const out = `${r.stdout}${r.stderr}`;
    return { failure: `cnb 退 ${r.status}`, text: out };
  }
  return { failure: "", text: r.stdout };
}

/** 终态集合 —— 平台 `status` 的原值（`pending` / `running` 之外的都算停了）。 */
const TERMINAL = new Set(["success", "failed", "cancel", "timeout", "skipped"]);

/**
 * 一跑的读数（`readBuild` 与 `emptyReading` 的返回值是同一件事的两条路）。
 *
 * `note` 是「取不到时的那句原因」，它的读者是 `formatReadingRow()`：非空时缀在结论行尾。
 * 三句原因的下一动作各不相同（响应不是 JSON ⇒ 去看 `-v` 那一路到底打了什么；
 * 响应里没有 data ⇒ 那个 sn 不存在；`cnb` 起不来 ⇒ 工具链那一格），而
 * `status=(取不到)` 单独一行分不出这三件事 —— 所以「不静默」这句话落在**打印出来的行**上，
 * 不落在字段名上。
 *
 * @typedef {Object} Reading
 * @property {string} sn
 * @property {string} status
 * @property {string} createTime
 * @property {string} startTime
 * @property {string} endTime
 * @property {string} title
 * @property {string} note
 */

/**
 * `build get-build-logs --sn` 那一页里的一行（平台给什么读什么，故全部可缺）。
 *
 * @typedef {Object} RunRow
 * @property {string} [sn]
 * @property {string} [createTime]
 * @property {string} [endTime]
 * @property {string | number} [duration]
 * @property {string} [title]
 * @property {string} [event]
 */

/**
 * 取一跑的读数。
 *
 * @param {string} repo `组织/仓库`
 * @param {string} sn 构建号
 * @param {(args:string[])=>{failure:string,text:string}} [call] 取数那一格的出口
 *   （默认打真平台）。用例要判的是「`cnb` 起不来时屏幕上是一行读数、还不是一段 Node 栈」，
 *   那只能喂进一份起不来的结果 —— 与 `report()` 的 `readRow` 同一口径，
 *   不去读源码里的字面量（ISSUE #2660 那一族）。
 * @returns {Reading}
 */
export function readBuild(repo, sn, call = cnbCall) {
  const { failure, text: raw } = call([
    "build",
    "get-build-status",
    "--repo",
    repo,
    "--sn",
    sn,
    "-v",
  ]);
  if (failure) {
    /* 这一支就是本件要修的那一格：改前 `execFileSync` 在这里直接抛，屏幕上是一段
     * Node 栈（`spawnSync cnb ENOENT`），既没有读数、也没有「为什么没有」。 */
    return emptyReading(sn, raw ? `${failure}（前 120 字：${raw.slice(0, 120)}）` : failure);
  }
  /* `-v` 打的是 **JSON**（实测 `{ "status": 200, "data": { "status": "error", … } }`），
   * 不是 YAML —— 第一版按 YAML 逐行取键，取到的是「(取不到)」，而那一屏看上去与
   * 「还在排队」一模一样。这正是本项目反复记过的失明形态（§13.6.2：没判 ≠ 绿）。 */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyReading(sn, `响应不是 JSON（前 120 字：${raw.slice(0, 120)}）`);
  }
  const data = parsed?.data;
  if (data == null || typeof data !== "object") {
    return emptyReading(sn, "响应里没有 data");
  }
  /* 平台**只有**流水线粒度的时间：一跑里可以是多个 pipeline（本仓每条流水线各一个），
   * 取整跑的最早开始与最晚结束作为它的时间窗 —— 相交判据问的是「这一跑在不在跑」，
   * 而它不是 stage 粒度的问题。`createTime` / `endTime` 在整跑这一层平台不给，
   * 所以缺它们时**不编**（`startTime` 取不到就是取不到，由上面的「取不到时间线」兜）。 */
  const pipes = Object.values(data.pipelinesStatus ?? {}).filter((p) => p && typeof p === "object");
  const startMs = pipes
    .map((p) => Number(p.createTime ?? p.startTime ?? Number.NaN))
    .filter((n) => Number.isFinite(n));
  const endMs = pipes.map((p) => Number(p.endTime ?? Number.NaN)).filter((n) => Number.isFinite(n));
  const names = pipes.map((p) => String(p.name ?? "")).filter(Boolean);
  return {
    sn,
    status: String(data.status ?? "(取不到)"),
    createTime: startMs.length > 0 ? isoOf(Math.min(...startMs)) : "",
    startTime: startMs.length > 0 ? isoOf(Math.min(...startMs)) : "",
    endTime: endMs.length === pipes.length && endMs.length > 0 ? isoOf(Math.max(...endMs)) : "",
    title: names.join(" / "),
    note: "",
  };
}

/** 毫秒 → ISO（取不到就是空串，不拿「此刻」冒充）。
 *
 * @param {number} ms
 * @returns {string}
 */
function isoOf(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

/**
 * **整跑**那一层的时间线（`createTime` / `endTime`）—— 从 `build get-build-logs --sn <号>`
 * 取。
 *
 * 为什么必须从这一路取：`get-build-status` 只给**流水线**粒度，而一跑里可以是多个
 * pipeline；整跑的这一格只在这一份列表里有。第一版只读了 status 那一路，于是
 * 「这一跑在什么时候活着」整格是空的 —— 而空读数在屏幕上与「还在排队」长得一样。
 *
 * @param {string} repo
 * @param {string} sn
 * @returns {{createTime: string, endTime: string, title: string, event: string}}
 */
export function readRunWindow(repo, sn) {
  const { failure, text: raw } = cnbCall([
    "build",
    "get-build-logs",
    "--repo",
    repo,
    "--sn",
    sn,
    "-v",
  ]);
  /* 这一路只给时间线，不给 `status`：取不到就把四格留空（改前的 `catch` 也是这个形状），
   * 结论行上那句「为什么没有读数」由 `readBuild` 那一路的 `note` 承担 —— 两路拼一行，
   * 不许在这一路再编一个理由。 */
  if (failure) {
    return { createTime: "", endTime: "", title: "", event: "" };
  }
  try {
    /* 平台这一路给的是一个数组，`JSON.parse` 回来是 `any` —— 那里从没被判过。
     * 只在**进出的那一处**记一次形状（字段全可缺：平台给不给 `title` 不是本件能定的，
     * 缺就是缺，下面的读法本来就按「取不到给空串」写）。 */
    /** @type {RunRow[]} */
    const rows = JSON.parse(raw)?.data?.data ?? [];
    /** @type {RunRow} */
    const row = rows.find((r) => r?.sn === sn) ?? rows[0] ?? {};
    const create = Number(row.createTime ? Date.parse(row.createTime) : Number.NaN);
    const durationMs = Number(row.duration ?? Number.NaN);
    const ended = Number.isFinite(create) && Number.isFinite(durationMs);
    return {
      createTime: Number.isFinite(create) ? new Date(create).toISOString() : "",
      /* 还在跑的那一跑**没有** endTime —— 给空串，由 `overlap()` 按「此刻」收口并
       * 在答案里带 `stillRunning`。拿 `create + duration` 编一个假的结束时刻，
       * 等于把「正在跑」写成「已经停了」。 */
      endTime: ended && durationMs > 0 ? new Date(create + durationMs).toISOString() : "",
      title: String(row.title ?? ""),
      event: String(row.event ?? ""),
    };
  } catch {
    return { createTime: "", endTime: "", title: "", event: "" };
  }
}

/** 读数取不到时的形态：`status` 照实说「取不到」，附一句原因（不静默、不冒充绿）。
 *
 * @param {string} sn
 * @param {string} note
 * @returns {Reading}
 */
function emptyReading(sn, note) {
  return {
    sn,
    status: "(取不到)",
    createTime: "",
    startTime: "",
    endTime: "",
    title: "",
    note,
  };
}

/** 把平台的时间串（`2026-10-26T02:50:07Z` 或毫秒时间戳的**字符串**形态）换成毫秒；
 *  取不到给 `null`。两个调用点喂的都是 `Reading` 上那几个字段，全是串 ——
 *  所以参数不收 `number`：收了就会在里面立刻需要一次「到底是按 epoch 还是按日历算」的
 *  判断，而那个判断在真实读数里没有对应物（实测平台这两路给的都是串）。
 *
 * @param {string | null | undefined} value
 * @returns {number | null}
 */
export function toMs(value) {
  if (value == null || value === "") {
    return null;
  }
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
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
 * 这里不用多行内联对象类型写它们 —— 那几行全是类型语法、一个中文都不含，
 * 而「注释一律中文」这条硬闸（§12.4.6）对 JSDoc 结构行的豁免面比多行对象窄（实测拦在
 * 多行对象类型上）。散文写中文比跟判据的豁免边界打交道稳妥 —— 形状收在上面那个
 * `Reading` typedef 里，一行引用就够，不必再折一份。
 *
 * @param {Reading} a 左边的读数
 * @param {Reading} b 右边的读数
 * @param {number} [now] 当前时刻（一侧还在跑时按它收口）
 * @returns {{verdict: string, seconds: number, stillRunning: boolean}}
 */
export function overlap(a, b, now = Date.now()) {
  /**
   * @param {Reading} x 任一读数
   * @returns {{start: number | null, end: number, stillRunning: boolean}}
   */
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
  const seconds = Math.round((Math.min(sa.end, sb.end) - Math.max(sa.start, sb.start)) / 1000);
  return {
    verdict: seconds > 0 ? "相交（同一时刻都在跑）" : "错开",
    seconds: Math.max(0, seconds),
    stillRunning: sa.stillRunning || sb.stillRunning,
  };
}

/**
 * 一跑的那一行读数。
 *
 * `note` 非空时（只有「取不到」那两条路非空，成功那一路给空串）把原因缀在**同一行**行尾：
 * 三个原因的下一动作不同，把它们打到屏幕上才是「不静默」——写进对象而没人念，
 * 读的人看到的仍只是一句 `status=(取不到)`。
 *
 * @param {Reading} r
 * @returns {string}
 */
export function formatReadingRow(r) {
  const note = r.note ? `（${r.note}）` : "";
  return (
    `[probe] ${r.sn}  status=${r.status}  create=${r.createTime}  ` +
    `start=${r.startTime}  end=${r.endTime}  title=${r.title}${note}`
  );
}

/**
 * 一行一跑地打出来，附逐对相交读数。
 *
 * `readRow` 是**取数那一格的出口**（默认打真平台）：本判据要能被判「取不到时屏幕上
 * 读不读得到那句原因」，而那只能靠喂进一份取不到的读数来判 —— 不是靠读源码里的字面量。
 *
 * @param {string} repo
 * @param {string[]} sns
 * @param {(sn: string) => Reading} [readRow]
 * @returns {Reading[]}
 */
export function report(
  repo,
  sns,
  readRow = (sn) => ({ ...readBuild(repo, sn), ...readRunWindow(repo, sn) }),
) {
  const now = Date.now();
  /* 两路拼成一行：`get-build-status` 给 `status`（终态只认它的原值），
   * `get-build-logs --sn` 给整跑的时间线。缺一路就如实说缺，不拿另一路顶。 */
  const rows = sns.map((sn) => readRow(sn));
  for (const r of rows) {
    console.log(formatReadingRow(r));
  }
  /* 逐对相交：改成 `entries()` + `slice()` 而不是 `rows[i]` / `rows[j]` 按下标取 ——
   * 后者在 `noUncheckedIndexedAccess` 下每次都是「可能 undefined」，而这两层循环的
   * 下标本来就在界内。配对与顺序逐字不变（同一对、同一朝向）。 */
  for (const [i, a] of rows.entries()) {
    for (const b of rows.slice(i + 1)) {
      const o = overlap(a, b, now);
      console.log(
        `[probe] ${a.sn} × ${b.sn} ⇒ ${o.verdict}（${o.seconds}s${o.stillRunning ? "，有一侧仍在跑" : ""}）`,
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
  const { event, key, cancelInProgress, wait, stageLock, jobLock, seconds } = opts;
  const timeout = opts.timeout ?? "20m";
  const pipelineLock = [`  lock:`, `    key: ${key}`];
  if (cancelInProgress != null) {
    pipelineLock.push(`    cancel-in-progress: ${cancelInProgress}`);
  }
  if (wait) {
    pipelineLock.push(`    wait: true`, `    timeout: 900`);
  }
  /**
   * @param {number} indent 缩进格数
   * @param {{key: string, wait?: boolean, timeout?: number, expires?: string}} l 锁的三件
   * @returns {string[]}
   */
  const lockBlock = (indent, l) => {
    const pad = " ".repeat(indent);
    const out = [`${pad}lock:`, `${pad}  key: ${l.key}`];
    if (l.wait != null) {
      out.push(`${pad}  wait: ${l.wait}`);
    }
    if (l.timeout != null) {
      out.push(`${pad}  timeout: ${l.timeout}`);
    }
    if (l.expires != null) {
      out.push(`${pad}  expires: ${l.expires}`);
    }
    return out;
  };
  /**
   * @param {number} indent 缩进格数
   * @returns {string[]}
   */
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
    if (stageLock) {
      lines.push(...lockBlock(6, stageLock));
    }
    lines.push(...body(6));
  }
  lines.push(`      timeout: ${timeout}`);
  return `${lines.join("\n")}\n`;
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
  const { failure, text: raw } = cnbCall([
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
  ]);
  /* 这是**写动作**，失败要响亮（与上面两路取读数不同）：区别只在于改前它冒成一段
   * Node 栈，现在念得出是哪一层没起来 —— 退出码 0 依旧不等于发出去了，sn 那格照旧独立回读。 */
  if (failure) {
    throw new Error(`${failure}：start-build 这一步没有取到响应\n${raw}`);
  }
  const sn = buildSnFromOutput(raw);
  if (!sn) {
    throw new Error(`起跑失败（没读回 sn）：\n${raw}`);
  }
  return sn;
}

/** 轮询到终态；超时返回最后一读（`status` 原值照给，不替它编结论）。
 *
 * @param {string} repo
 * @param {string} sn
 * @param {number} [timeoutMs]
 * @returns {Reading}
 */
export function waitTerminal(repo, sn, timeoutMs = 30 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  let last = readBuild(repo, sn);
  while (Date.now() < deadline && !TERMINAL.has(last.status)) {
    const wait = Math.min(15_000, Math.max(0, deadline - Date.now()));
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

/** 极简旗标解析：只要 `--k v` 与 `--flag` 两形态，够用了，不引依赖。
 *
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
function parseFlags(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    /* `noUncheckedIndexedAccess` 下按下标取到的是 `string | undefined`，而 `i < length`
     * 已保证这一格有值 —— 守卫只是把这件事写给类型检查器（同 `dev.mjs` 那一处）。 */
    if (a === undefined) {
      continue;
    }
    if (!a.startsWith("--")) {
      continue;
    }
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

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [, , cmd, ...rest] = process.argv;
  const f = parseFlags(rest);
  const positional = rest.filter((x) => !x.startsWith("--") && !Object.values(f).includes(x));

  if (cmd === "config") {
    if (!f.event || !f.key) {
      console.error(USAGE);
      process.exit(2);
    }
    /**
     * 旗标值 → 三态布尔（`false` 要能区别于「没给」，那一格决定 `cancel-in-progress` 写不写）。
     *
     * @param {string | boolean | undefined} v
     * @returns {boolean | undefined}
     */
    const bool = (v) =>
      v === true ? true : v === "false" ? false : v == null ? undefined : v === "true";
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
    console.log(startProbe(repo, String(f.event), String(f.title ?? `probe ${f.event}`)));
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
