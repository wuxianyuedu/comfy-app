#!/usr/bin/env node
/**
 * `ci-token-scopes.mjs` —— 把**这一跑的 `CNB_TOKEN` 够得着哪些能力**打成读数
 * （ISSUE #2551，规范 §13.10.16）。
 *
 * ## 它要回答的那一格
 *
 * 「PR 那一族只有 `repo-code:r`」这句话在本仓被引用过无数次（#2339 / #2362 / #2365 /
 * #2472 / #2550），而出处始终是**别人先撞上 403 之后抄下来的那句话**：
 *
 *     平台原话是「授权范围与本请求不匹配」+ 一句点名缺哪一枚（原文里那句
 *     `Missing required scopes: repo-cnb-history:r` 就是 #2332 抄下来的）。
 *
 * 也就是说，直到某一格真去写、真被拒，这一跑的权限面才在日志里出现一次 —— 而且只出现
 * **缺的那一项**。想知道「PR 上到底有没有 `repo-issue:r`」，过去只能翻官方文档的权限表
 * 再猜平台实现。这一格把「猜」换成「量」：拿一串**只读**接口挨个问一遍，403 里平台会
 * 自己点名缺什么 scope，于是**平台自报的授权面**就落进了构建日志。
 *
 * ## 它刻意不做的事
 *
 * - **不打令牌值**，一个字节都不打（硬规则 17 / 拉取请求 §7.3）。打的是「哪些能力够得着」，
 *   不是「凭什么够得着」。唯一的例外是 `authentication exchange-oidc-id-token` 那一问的
 *   入参：`oci` 渠道要求把 `cnb_token` 原样放进请求体，那一问的值**从不回显、从不落盘**，
 *   且只在 `--probe-oidc` 显式点名时才发生（默认不发）。
 * - **不当判据**：恒退 0（除非 `--strict`，而平台那一跳**不许带**它 —— 理由见 `strictHint()`）。
 *   它量的是**平台怎么给权限**，而那不是仓库能改的东西 ⇒ 判红只会把「节点的形态」伪装成
 *   「这次 PR 的缺陷」（与 `ci-workspace-probe.mjs` 同一口径）。
 * - **不引新依赖**：一行 `run` 用 `spawnSync` 现写（复用 `ship-exec.mjs` 的 `makeRunner`
 *   会把 `ship` 那一族的整条加载链拖进来，而这一格要在刚 clone 完的机器上也能跑）。
 *
 * ## 三档与退出码
 *
 * | 档       | 判据                                   | 退出码          |
 * | -------- | -------------------------------------- | --------------- |
 * | 量到了   | 至少一条探针拿到了平台明确答复         | 0               |
 * | 没量到   | 一条明确答复都没有                     | 0（默认）/ 2（`--strict`）|
 *
 * 默认**恒退 0**：这是读数档，红了不构成任何结论（与 `ci-workspace-probe.mjs` 一致）。
 *
 * ⚠️ **「没量到」不能读成「这一格坏了」**（ISSUE #2551 的第一跑读数）：`pr_fail_stage`
 * 上那一跑（`cnb-vv9-1k60eb6vl`）14 条探针全部落进「没拿到答复」，而原因是**平台侧**
 * —— 那一跑的令牌连 `repo-cnb-history:r` 都没有（同跑的 `PR 失败立案` 自己读构建列表时
 * 撞的就是这一句），于是每条探针都以 403 收场，而 403 的原话里没写那句
 * `Missing required scopes`（原文是「授权范围与本请求不匹配」），判据只能落进 unknown。
 * 那不是这一格坏了，**那正是这一格要量的东西**。所以平台那一跳**不带** `--strict`：
 * 否则 PR 上会有一条永远红、且**没有任何人能修**的格子（要修得平台改授权口径）。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci-token-scopes.mjs                 # 对着当前仓库问一遍，打印读数
 * node scripts/ci-token-scopes.mjs --repo a/b      # 指定仓库
 * node scripts/ci-token-scopes.mjs --json          # 机器可读
 * node scripts/ci-token-scopes.mjs --strict        # 一条都没量到 ⇒ 退 2
 * node scripts/ci-token-scopes.mjs --only repo-issue   # 只问点名的族
 * node scripts/ci-token-scopes.mjs --probe-oidc    # 额外问一次 OIDC 兑换（入参含 cnb_token）
 * ```
 */
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** 三态退码与仓内其余档同口径（`0` 有结论 / `2` 没拿到测量）。 */
export const CODE = { OK: 0, NO_FACT: 2 };

/** 平台「scope 不够」的那一句原话里，缺项就在冒号后面。 */
/* 「缺哪一枚」与「缺了但没写名字」是**同一档**（都是平台拒了这次请求），区别只在读数里
 * 能不能把那一枚抄下来 —— 所以这里匹配的是那句话本身，名字是可选捕获组。
 * 只认 `Missing required scope` 这两个词：它是平台在 403 上的固定措辞，而「errcode 10023」
 * 还可能是别的原因，拿它当判据会把「其他授权错误」读成缺 scope。 */
const SCOPE_PATTERN = /Missing required scopes?:?\s*([^\s",}]*)/i;

/**
 * 探针表：**只读**接口 + 它背后那枚 scope。
 *
 * 表里那枚 scope 是**已知需要**（官方权限表 + 本仓撞过的现场），不是从平台问来的 ——
 * 它只用来在读数里把「平台回的是哪一枚」写清楚。真正的结论仍以 403 的原话为准：
 * 探针与表里的 scope 对不上时，念的是平台自己的那句话，不是这张表。
 *
 * `domain` 是给读者分组用的（会话里「这些 repo-code:r」那句话真正问的是「这一族还有谁」）。
 *
 * ⚠️ 每一条都必须是**只读**：这一格会在 PR、每日、桌包三种触发口上跑，任何一条写命令
 * 都会让「量一下权限」变成「动一下平台」。
 *
 */
/**
 * 一条探针：`domain` 是读数里的分组，`scope` 是它背后那枚权限，`cmd` 是**只读**子命令，
 * `why` 是「这条答的是什么」，`note` 是「这条为什么可能回一个与权限无关的答复」。
 *
 * @typedef {{
 *   domain: string,
 *   scope: string,
 *   cmd: string[],
 *   why: string,
 *   note?: string,
 * }} Probe
 */
/** @type {Array<{domain: string, scope: string, cmd: string[], why: string, note?: string}>} */
export const PROBES = [
  {
    domain: "repo-code",
    scope: "repo-code:r",
    cmd: ["git", "list-branches", "--page", "1", "--page-size", "1"],
    why: "读分支列表（最基础的一条，探针自身的前提）",
  },
  {
    domain: "repo-code",
    scope: "repo-code:r",
    cmd: ["git", "get-head"],
    why: "读默认分支",
  },
  {
    domain: "repo-basic-info",
    scope: "repo-basic-info:r",
    cmd: ["repositories", "get-by-id"],
    why: "读仓库元信息",
  },
  {
    domain: "repo-issue",
    scope: "repo-issue:r",
    cmd: ["issues", "list-issues", "--page", "1", "--page-size", "1"],
    why: "读 Issue 列表（立案那一族的前提）",
  },
  {
    domain: "repo-issue",
    scope: "repo-issue:r",
    cmd: ["issues", "get-issue-properties", "--number", "1"],
    why: "读 Issue 自定义属性",
  },
  {
    domain: "repo-pr",
    scope: "repo-pr:r",
    cmd: ["pulls", "list-pulls", "--page", "1", "--page-size", "1"],
    why: "读 PR 列表（回写型自动修的前提）",
  },
  {
    domain: "repo-pr",
    scope: "repo-pr:r",
    cmd: ["pulls", "list-labels", "--number", "1"],
    why: "读 PR 标签",
    note: "编号 1 不存在时回 404 `not found`，与权限无关",
  },
  {
    domain: "repo-cnb-history",
    scope: "repo-cnb-history:r",
    cmd: ["build", "get-build-logs", "--page", "1", "--page-size", "1"],
    why: "读构建历史（失败立案 / `--diagnose` 的前提，#2332 撞过这一枚）",
  },
  {
    domain: "repo-notes",
    scope: "repo-notes:r",
    cmd: ["releases", "list-releases"],
    why: "读发行版列表",
  },
  {
    domain: "registry-package",
    scope: "registry-package:r",
    cmd: ["registries", "list-packages", "--slug", "*", "--type", "all"],
    why: "读制品列表",
  },
  {
    domain: "knowledge-base",
    scope: "repo-code:r",
    cmd: ["knowledge-base", "get-knowledge-base-info"],
    why: "读知识库信息",
    note: "本仓没建知识库 ⇒ 恒回 KnowledgeBase Not Found，与权限无关",
  },
  {
    domain: "repo-manage",
    scope: "repo-manage:r",
    cmd: ["git-settings", "get-pipeline-settings"],
    why: "读流水线设置（管理面）",
  },
  {
    domain: "repo-manage",
    scope: "repo-manage:r",
    cmd: ["members", "list-all-members", "--slug", "*", "--page", "1"],
    why: "读仓库有效成员（管理面）",
  },
  {
    domain: "repo-security",
    scope: "repo-security:r",
    cmd: ["security", "get-repo-security-overview"],
    why: "读仓库安全概览（管理面）",
  },
];

/**
 * `probeAll()` 的入参。
 *
 * @typedef {{
 *   repo: string,
 *   run: (cmd: string, args: string[]) => {ok: boolean, status: number, out: string},
 *   only?: string[],
 *   oidc?: boolean,
 * }} ProbeOptions
 */

/**
 * 一条探针的读数：探针自己的三项（分组 / 它背后那枚 scope / 为什么问它）+ 平台怎么答的。
 *
 * @typedef {{
 *   domain: string,
 *   scope: string,
 *   why: string,
 *   note?: string,
 *   args: string[],
 *   reply: ReturnType<typeof classifyReply>,
 * }} ProbeRow
 */

/** OIDC 兑换那一问：入参含 `cnb_token`，所以**只有显式点名才发**。 */
export const OIDC_PROBE = {
  domain: "authentication",
  scope: "repo-basic-info:r",
  cmd: ["authentication", "exchange-oidc-id-token", "--data", '{"cnb_token":"*","aud":"ci-token-scopes"}'],
  why: "用 cnb_token 兑换 id_token（只放行流水线 token；PR / Issue 事件不签发）",
};

/**
 * `spawnSync` 的十行包装（与 `ci-workspace-probe.mjs` 里那份**刻意不共享**：这一格要能在
 * 「同事刚 clone、还没装依赖」的机器上跑，共用换来的那点重复抵不上这条加载前提）。
 *
 * ⚠️ **起 `cnb` 不能直接 `spawnSync("cnb", …)`**（ISSUE #2551 的第一跑现场）：
 * CI 上 14 条探针全部「没拿到答复」，而同一跑的 `PR 失败立案` 好得很 —— 差别就在
 * 它走的是 `ship-exec.mjs` 的 `cnbSpawn()`。Windows 上 `cnb` 是三个垫片（无扩展名
 * 那份 node 不认、`cnb.cmd` 在无 shell 下被 Node 直接拒、没有 `cnb.exe`），所以
 * `spawnSync("cnb")` 失败**不等于**这台机器没有 cnb。
 *
 * 出路是那份**已经为 pnpm 解决过同一件事**的唯一实现 `pnpmInvocation(args, {name})`
 * —— 但本文件刻意**不 import 它**：`ship-exec.mjs` 会把 `ship` 那一族整条加载链拖进来，
 * 而这一格的前提是「刚 clone 完、还没装依赖的机器上也能跑」。这里只认出 Windows 上
 * **有** `cnb.ps1` 这一种形态（`shell: false` 下唯一起得来的那份），交 PowerShell 宿主；
 * 其余平台照旧直接起命令名。判据 `tests/ci-token-scopes.test.ts` 钉住这条接线。
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {{ok: boolean, status: number, out: string}}
 */
export function run(cmd, args) {
  const { command, argv } = invocationFor(cmd, args);
  const r = spawnSync(command, argv, { encoding: "utf8", windowsHide: true });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return { ok: r.status === 0 && !r.error, status: r.status ?? -1, out };
}

/**
 * 「命令名 + 参数」→ 这台机器上**起得来**的那一形态。
 *
 * 只管 `cnb` 一个名字（这一格只起它），其余原样。非 Windows 直接起（与 `ship-exec.mjs`
 * 的 `cnbSpawn()` 同一结论：那边 `pnpmInvocation` 在 POSIX 上也返回空 prefixArgs）。
 *
 * Windows 上的判定顺序照 `usableCommand()` 的既有结论抄一遍**最小面**：先找
 * `cnb.ps1`（corepack 摆的三个垫片里唯一经宿主起得来的那份），找到就交 PowerShell；
 * 找不到则退回 `cnb.cmd`（cmd.exe 解释的那一份）；都没有才原样起 —— 那时 `spawn`
 * 会给一个可读的 ENOENT，读数把它记成「没拿到答复」，不冒充结论。
 *
 * ⚠️ 不 import `ship-exec.mjs` 的 `cnbSpawn()`：那会把 `ship` 那一族整条加载链拖进来，
 * 而这一格的前提是「刚 clone 完、还没装依赖的机器上也能跑」。
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {{command: string, argv: string[]}}
 */
export function invocationFor(cmd, args) {
  if (cmd !== "cnb" || process.platform !== "win32") {
    return { command: cmd, argv: args };
  }
  /** @param {string} name 要查的命令名（带扩展名） @returns {boolean} 在不在 PATH 上 */
  const onPath = (name) =>
    spawnSync("where", [name], { encoding: "utf8", windowsHide: true }).status === 0;
  if (onPath("cnb.ps1")) {
    return {
      command: "powershell",
      argv: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "cnb.ps1",
        ...args,
      ],
    };
  }
  if (onPath("cnb.cmd")) {
    return { command: "cnb.cmd", argv: args };
  }
  return { command: cmd, argv: args };
}

/**
 * 把一次探针的原文读成三档：`denied` / `granted` / `unknown`。
 *
 * 判据只有三句话，顺序不能换：
 *
 * ① 原文里有 `Missing required scopes:` ⇒ **缺权限**（平台自己点名了缺哪一枚）；
 * ② 否则信封里 `status: 200` ⇒ **够得着**。⚠️ 业务层的 404（PR #1 不存在、仓库没建知识库）
 *    走的正是这一档：**平台认了这次请求**，只是那个对象没有 —— 它不是「缺权限」。
 *    「读得到 vs 读得到但对象不在」在读数里必须分开，否则这条探针答的是另一个问题；
 * ③ 其余（`cnb` 不在、网络断、信封里没有 `status`）⇒ **没结论**，不是「够得着」。
 *
 * @param {string} raw
 * @returns {{state: "denied" | "granted" | "unknown", scope?: string, status?: number, why?: string}}
 */
export function classifyReply(raw) {
  const text = String(raw ?? "");
  const missing = SCOPE_PATTERN.exec(text);
  if (missing) {
    /* 空捕获（原话只到 `Missing required scopes` 就断了）与没捕获是同一件事：
     * 平台拒了这次请求，但没把那枚 scope 的名字写出来。两者都念成同一句。 */
    return {
      state: "denied",
      scope: missing[1] || "（原话里没写出 scope 名）",
    };
  }
  /* 信封上那个 200 是**取到了答复**的意思，与「流程过没过」无关；这一格要的正是它：
   * 平台没有拒这次请求 ⇒ 这枚 scope 在不在，只能由 403 自己说（① 那一支）。 */
  const http = /^\s*"?status"?\s*:\s*(\d{3})/m.exec(text) ?? /"status"\s*:\s*(\d{3})/.exec(text);
  const status = http ? Number(http[1]) : null;
  if (status === null) return { state: "unknown" };
  if (status === 200) return { state: "granted", status };
  /* 非 200 而原话里没有那句 `Missing required scopes` —— 是**另一种**拒绝（或业务错误）。
   * 这类不许落进「够得着」：平台没答应这次请求，而那枚 scope 在不在没人说得准。
   * 把平台那句 `errmsg` 原样带出去，下一动作才读得出来（CI 上 PR 那一族就落这里：
   * 403 + 「授权范围与本请求不匹配」，没给 scope 名）。 */
  const errmsg = /"errmsg"\s*:\s*"([^"]{1,160})"/.exec(text);
  return {
    state: "unknown",
    status,
    why: `平台回了 ${status}${errmsg ? `：${errmsg[1]?.replace(/"/g, "'")}` : "（原话里没有 errmsg）"}`,
  };
}

/**
 * 探针的完整参数：表里的命令 + 仓库（有的子命令不接受 `--repo`，按需给）。
 *
 * @param {Probe} probe
 * @param {string} repo
 * @returns {string[]}
 */
export function probeArgs(probe, repo) {
  const args = [...probe.cmd];
  if (!args.includes("--repo") && !args.includes("--slug")) {
    args.push("--repo", repo);
  }
  /* `--slug` / `--repo` 那一格在表里写的是字面 `*`：那是「沿用本次的仓库」的占位，
   * 具体值在这里补 —— 表里写死仓库名等于把探针钉死在一个仓上。 */
  return args.map((a) => (a === "*" ? repo : a));
}

/**
 * 探针清单过一遍（注入 `run` 便于用例不连平台）。
 *
 * @param {ProbeOptions} opts 仓库、注入的执行者、以及两个可选开关
 * @returns {ProbeRow[]}
 */
export function probeAll(opts) {
  /** @type {Probe[]} */
  const probes = opts.oidc ? [...PROBES, OIDC_PROBE] : PROBES;
  const only = opts.only ?? [];
  const picked = only.length
    ? probes.filter((p) => only.includes(p.domain))
    : probes;
  return picked.map((probe) => {
    const args = probeArgs(probe, opts.repo);
    const r = opts.run("cnb", [...args, "-v"]);
    return {
      domain: probe.domain,
      scope: probe.scope,
      why: probe.why,
      note: probe.note,
      args,
      reply: classifyReply(r.out),
    };
  });
}

/**
 * 读数：哪一族够得着、哪一族被平台点名缺什么。
 *
 * @param {ProbeRow[]} rows
 * @param {{repo: string, event: string | null, branch: string | null}} ctx
 * @returns {string[]}
 */
export function formatReadout(rows, ctx) {
  const lines = [
    `== 这一跑的令牌够得着哪些能力（repo=${ctx.repo}）==`,
    `事件=${ctx.event ?? "（不在场）"} · 分支=${ctx.branch ?? "（不在场）"}` +
      "（平台按「事件 + ref」给权限，同一枚令牌换事件就换一套面）",
  ];
  /** @type {Map<string, ProbeRow[]>} */
  const byDomain = new Map();
  for (const row of rows) {
    const list = byDomain.get(row.domain) ?? [];
    list.push(row);
    byDomain.set(row.domain, list);
  }
  for (const [domain, list] of byDomain) {
    const denied = list.filter((r) => r.reply.state === "denied");
    const granted = list.filter((r) => r.reply.state === "granted");
    /* 三档的措辞各自代表一个**不同的事实**，顺序与 `classifyReply()` 同源：
     * ① 缺权限（平台点名了）→「未获授权」；
     * ② 整族都拿到答复 →「获授权」；
     * ③ 一条答复都没有 → **「没量到」**。⚠️ 这一档绝不能念成「获授权」：平台没拒
     *    不等于允许，那正是 §13.6.4.1 那条「取不到 ≠ 测出来是好的」。CI 上的现场是
     *    PR 那一族连 `repo-cnb-history:r` 都没有 ⇒ 每一条探针都以 403 收场，而
     *    403 的原话里**没写** `Missing required scopes` 时只能落进 ③。 */
    const verdict =
      denied.length > 0
        ? `未获授权 · 平台点名缺 ${[...new Set(denied.map((r) => r.reply.scope))].join(" / ")}`
        : granted.length === list.length
          ? "获授权"
          : granted.length === 0
            ? `没量到（${list.length} 条一条都没有明确答复）`
            : `部分答得清（${granted.length}/${list.length} 条有明确答复，其余没量到）`;
    lines.push(`  ${domain.padEnd(20)} ${verdict}`);
    for (const r of list) {
      const mark = r.reply.state === "denied" ? "×  " : r.reply.state === "granted" ? "ok " : "?  ";
      const tail =
        r.reply.state === "denied"
          ? `缺 ${r.reply.scope}`
          : r.reply.state === "granted"
            ? "平台认了这次请求"
            : r.reply.why ?? "没拿到答复";
      const note = r.note ? `（${r.note}）` : "";
      lines.push(`    ${mark}${r.why} → ${tail}${note}`);
    }
  }
  lines.push(
    "读数不做判据：这一格量的是平台怎么给权限，红了不构成任何结论（恒退 0）。" +
      "「未获授权」不代表这一跑有问题 —— 平台按「事件 + ref」分配，PR 那一族本来就只有 repo-code:r。",
  );
  return lines;
}

/**
 * `main()` 的入参：`argv` / `env` / `run` / `log` 四件各留一个注入点，用例因此
 * **一条平台命令都不发**（真实入口那几行只填默认值）。
 *
 * @typedef {{
 *   argv?: string[],
 *   env?: Record<string, string | undefined>,
 *   run?: (cmd: string, args: string[]) => {ok: boolean, status: number, out: string},
 *   log?: (s: string) => void,
 * }} MainOptions
 */

/**
 * CLI 那一格。
 *
 * @param {MainOptions} [opts] 命令行参数、环境、注入的执行者与打印口（用例全靠它注入）
 * @returns {number}
 */
export function main(opts = {}) {
  const argv = opts.argv ?? process.argv.slice(2);
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((/** @type {string} */ s) => console.log(s));
  const exec = opts.run ?? run;

  /** @param {string} name 旗标名 @returns {boolean} */
  const flag = (name) => argv.includes(name);
  /**
   * @param {string} name 旗标名
   * @param {string} fallback 没给时用它
   * @returns {string}
   */
  const value = (name, fallback) => {
    const i = argv.indexOf(name);
    const v = argv[i + 1];
    return i >= 0 && v !== undefined ? v : fallback;
  };

  const repo = value("--repo", env.CNB_REPO_SLUG ?? "");
  if (!repo) {
    log("[token-scopes] 认不出仓库（`--repo` 与 `CNB_REPO_SLUG` 都不在场）⇒ 没量到任何东西。");
    return flag("--strict") ? CODE.NO_FACT : CODE.OK;
  }
  const only = value("--only", "")
    .split(",")
    .map((/** @type {string} */ s) => s.trim())
    .filter(Boolean);

  const rows = probeAll({ repo, run: exec, only, oidc: flag("--probe-oidc") });
  if (flag("--json")) {
    log(JSON.stringify({ repo, event: env.CNB_EVENT ?? null, rows }, null, 1));
  } else {
    log(
      formatReadout(rows, {
        repo,
        event: env.CNB_EVENT ?? null,
        branch: env.CNB_BRANCH ?? null,
      }).join("\n"),
    );
  }
  const measured = rows.filter(
    (r) => r.reply.state === "granted" || r.reply.state === "denied",
  ).length;
  if (measured === 0 && flag("--strict")) {
    log("[token-scopes] 一条探针都没拿到平台的明确答复 ⇒ 这一格自己坏了（退 2）。");
    return CODE.NO_FACT;
  }
  return CODE.OK;
}

/* 判「是不是直接执行」的写法与 `ci-workspace-probe.mjs` 末尾逐字相同：拼 `file://${argv[1]}`
 * 在 Windows 上恒不相等，于是本脚本一行都不打就退 0 —— 而它存在的意义正是把这一格打出来。 */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
