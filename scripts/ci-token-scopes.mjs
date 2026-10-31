#!/usr/bin/env node
/**
 * `ci-token-scopes.mjs` —— 把**这一跑的 `CNB_TOKEN` 够得着哪些能力**打成读数
 * （ISSUE #2551，规范 §13.10.16）。
 *
 * ## 它要回答的那一格
 *
 * 「PR 那一族只有 `repo-code:r`」这句话在本仓被引用过十几次（#2339 / #2362 / #2365 /
 * #2472 / #2550），而出处始终是**别人先撞上 403 之后抄下来的那句话** —— 平台原话是
 * 「授权范围与本请求不匹配」加一句点名缺哪一枚（#2332 抄下来的那句
 * `Missing required scopes: repo-cnb-history:r` 就是它）。
 *
 * 也就是说，直到某一格真去写、真被拒，这一跑的权限面才在日志里出现一次，而且只出现
 * **缺的那一项**。想知道「PR 上到底有没有 `repo-issue:r`」，过去只能翻官方文档的权限表
 * 再猜平台实现。这一格把「猜」换成「量」：拿一串**只读**接口挨个问一遍，403 里平台会
 * 自己点名缺什么 scope，于是**平台自报的授权面**落进构建日志。
 *
 * ## 为什么是 HTTP 而不是 `cnb` CLI（五跑读数换来的）
 *
 * 第一版每条探针都起 `cnb <子命令> -v`。四跑下来都是一整片「没拿到答复」，直到把
 * 「没拿到答复」拆成四种成因才看清：**自托管 runner 的宿主 PATH 上没有 `cnb`**
 * （`Install dependencies` 那一格的日志里只有 node / pnpm / git）。同一跑的
 * `PR 失败立案` 好得很，是因为它在**装完依赖之后**由 `ship-exec.mjs` 的 `cnbSpawn()`
 * 解析到包真身 —— 而这一格要在装依赖之前就能跑（读数越早越有用）。
 *
 * 所以它只用两件平台**无条件注入**的东西：`CNB_TOKEN` 与 `CNB_API_ENDPOINT`
 * （官方 build-in-env.md）+ 宿主 Node 自带的 `fetch`。形状：
 *
 * 请求形态：`GET {CNB_API_ENDPOINT}/{repo}/-/{path}`，两个请求头分别是
 * `Authorization: Bearer <CNB_TOKEN>` 与 `Accept: application/json`。
 *
 * ## 五条边界，每一条都是刻意的
 *
 * 1. **不打令牌值，一个字节都不打**（硬规则 17）。打的是「哪些能力够得着」，
 *    不是「凭什么够得着」。唯一的例外是 `oidc` 那一问的**请求体**含 `cnb_token`：
 *    它默认**不发**，只有 `--probe-oidc` 显式点名才进清单，且请求体从不回显。
 * 2. **权限本身从不构成红**。默认恒退 0；`--strict` 只把「一条明确答复都没有」提到 2
 *    —— 而平台那一跳**不带它**（理由见下）。平台按「事件 + ref」分配，缺
 *    `repo-manage:r` 是预期形态，判它红等于把平台形态伪装成这次 PR 的缺陷
 *    （与 `ci-workspace-probe.mjs` / `镜像身份` 同一口径）。
 * 3. **业务层 404 读成「平台认了这次请求」**，不读成缺权限：PR #1 不存在、仓库没建
 *    知识库都走这一档 —— 「读得到」与「读得到但对象不在」必须分开，否则探针答的是
 *    另一个问题。
 * 4. **取不到 ≠ 够得着**（§13.6.4.1）：没配 token / 网络断 / 输出不是平台信封，
 *    一律 `unknown`，且**各自念一句成因**（这是第四跑补的：把四种成因印成同一句
 *    「没拿到答复」，等于把「不知道什么原因」写成「没有权限」的形状）。
 * 5. **`--strict` 不许进 `.cnb.yml`**：第一跑带了它，PR 上那条 14 条探针全 403 的格子
 *    红了 7.5s，而红的原因**没有任何人能修**（要修得平台改授权口径）。判据
 *    `tests/ci-token-scopes.test.ts` 读配置钉住这一条。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci-token-scopes.mjs                  # 对着 CNB_REPO_SLUG 问一遍
 * node scripts/ci-token-scopes.mjs --repo a/b       # 指定仓库
 * node scripts/ci-token-scopes.mjs --json           # 机器可读
 * node scripts/ci-token-scopes.mjs --strict         # 一条明确答复都没有 ⇒ 退 2（只给手工自查）
 * node scripts/ci-token-scopes.mjs --only repo-issue  # 只问点名的族
 * node scripts/ci-token-scopes.mjs --probe-oidc     # 额外问一次 OIDC 兑换（请求体含 cnb_token）
 * ```
 */
import path from "node:path";
import process from "node:process";

/** 三态退码与仓内其余档同口径（`0` 有结论 / `2` 没拿到测量）。 */
export const CODE = { OK: 0, NO_FACT: 2 };

/** 平台「scope 不够」的那一句原话里，缺项就在冒号后面。 */
const SCOPE_PATTERN = /Missing required scopes?:?\s*([^\s",}]*)/i;

/**
 * 一条探针：`domain` 是读数里的分组，`scope` 是它背后那枚权限（**已知需要**，
 * 来自官方权限表 + 本仓撞过的现场），`path` 是只读子路径，`why` 是「这条答什么」，
 * `note` 是「这条为什么可能回一个与权限无关的答复」。
 *
 * ⚠️ 每一条都必须是**只读**：这一格会在 PR、每日、桌包三种触发口上跑。
 *
 * @typedef {{
 *   domain: string,
 *   scope: string,
 *   path: string,
 *   why: string,
 *   note?: string,
 * }} Probe
 */
/** @type {Probe[]} */
export const PROBES = [
  {
    domain: "repo-code",
    scope: "repo-code:r",
    path: "git/branches?page=1&pageSize=1",
    why: "读分支列表（最基础的一条，探针自身的前提）",
  },
  {
    domain: "repo-code",
    scope: "repo-code:r",
    path: "git/head",
    why: "读默认分支",
  },
  {
    domain: "repo-code",
    scope: "repo-code:r",
    path: "git/commits?page=1&pageSize=1",
    why: "读提交列表",
  },
  {
    domain: "repo-issue",
    scope: "repo-issue:r",
    path: "issues?page=1&pageSize=1",
    why: "读 Issue 列表（立案那一族的前提）",
  },
  {
    domain: "repo-issue",
    scope: "repo-issue:r",
    path: "issues/1/properties",
    why: "读 Issue 自定义属性",
    note: "编号 1 不存在时回 404，与权限无关",
  },
  {
    domain: "repo-pr",
    scope: "repo-pr:r",
    path: "pulls?page=1&pageSize=1",
    why: "读 PR 列表（回写型自动修的前提）",
  },
  {
    domain: "repo-pr",
    scope: "repo-pr:r",
    path: "pulls/1/labels",
    why: "读 PR 标签",
    note: "编号 1 不存在时回 404 `not found`，与权限无关",
  },
  {
    domain: "repo-cnb-history",
    scope: "repo-cnb-history:r",
    path: "build/logs?page=1&pageSize=1",
    why: "读构建历史（失败立案 / `--diagnose` 的前提，#2332 撞过这一枚）",
  },
  {
    domain: "repo-notes",
    scope: "repo-notes:r",
    path: "releases",
    why: "读发行版列表",
  },
  {
    domain: "registry-package",
    scope: "registry-package:r",
    path: "packages?type=all",
    why: "读制品列表",
  },
  {
    domain: "knowledge-base",
    scope: "repo-code:r",
    path: "knowledge/base",
    why: "读知识库信息",
    note: "本仓没建知识库 ⇒ 恒回 KnowledgeBase Not Found，与权限无关",
  },
  {
    domain: "repo-manage",
    scope: "repo-manage:r",
    path: "settings/cloud-native-build",
    why: "读流水线设置（管理面）",
  },
  {
    domain: "repo-manage",
    scope: "repo-manage:r",
    path: "members?page=1",
    why: "读仓库有效成员（管理面）",
  },
  {
    domain: "repo-security",
    scope: "repo-security:r",
    path: "security/overview",
    why: "读仓库安全概览（管理面）",
  },
];

/**
 * OIDC 兑换那一问：**请求体含 `cnb_token`**，所以只有 `--probe-oidc` 显式点名才发。
 *
 * 它的价值是回答「这一跑拿不拿得到 `id_token`」（官方口径：只有流水线 token 能兑换，
 * PR / Issue 事件不签发）—— 而请求体里那枚值从**回显、从落盘**都不经过这里。
 */
export const OIDC_PROBE = {
  domain: "authentication",
  scope: "repo-basic-info:r",
  path: "id_token",
  why: "用 cnb_token 兑换 id_token（只放行流水线 token；PR / Issue 事件不签发）",
};

/**
 * 一次探针的执行结果。`error` / `status` / `bodyLen` 三格是**给读数用的诊断面**：
 * 「没拿到答复」的四种成因在只看 `body` 时长得一样，而这一格的用处正是让人分出是哪一种。
 * 三格都不含凭据（错误码 / HTTP 状态 / 长度）。
 *
 * @typedef {{
 *   ok: boolean,
 *   status: number,
 *   body: string,
 *   error?: string | null,
 *   bodyLen?: number,
 *   ms?: number,
 * }} FetchResult
 */

/**
 * 取一件平台事实（注入面：用例整份替换它，一条网络请求都不发）。
 *
 * 只有一次尝试、**不重试**：这一格量的是「这一刻够不够得着」，重试会把一次网络抖动
 * 抹成一个看起来稳定的读数。超时 15s —— 比 `cnb` CLI 那一版的整格预算小一个量级。
 *
 * @param {{base: string, token: string, repo: string}} ctx 平台地址 / 令牌 / 仓库
 * @param {string} subPath 只读子路径（`git/head` 那种）
 * @param {{method?: string, body?: string}} [extra] 仅 `oidc` 那一问带 `body`
 * @returns {Promise<FetchResult>}
 */
export async function fetchFact(ctx, subPath, extra = {}) {
  const url = `${ctx.base.replace(/\/+$/, "")}/${ctx.repo}/-/${subPath}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: extra.method ?? "GET",
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        Accept: "application/json",
        ...(extra.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(extra.body ? { body: extra.body } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      body,
      error: null,
      bodyLen: body.length,
      ms: Date.now() - t0,
    };
  } catch (error) {
    /* 网络层失败只记**错误码**（`ENOTFOUND` / `TimeoutError` 那类），
     * 不记 message —— message 里可能带 URL，而 URL 里有仓库名（那没问题），
     * 但把它拼进读数只会让读的人去查一个不存在的「格式问题」。 */
    return {
      ok: false,
      status: -1,
      body: "",
      error: String(/** @type {any} */ (error)?.name ?? error),
      bodyLen: 0,
      ms: Date.now() - t0,
    };
  }
}

/**
 * 把一次探针的原文读成三档：`denied` / `granted` / `unknown`。
 *
 * 判据只有三句话，顺序不能换：
 *
 * ① 原文里有 `Missing required scopes` ⇒ **缺权限**（平台自己点名了缺哪一枚）；
 * ② 否则 HTTP 2xx ⇒ **够得着**。⚠️ 业务层的 404（PR #1 不存在、仓库没建知识库）
 *    走的正是这一档：**平台认了这次请求**，只是那个对象没有 —— 它不是「缺权限」；
 * ③ 其余 ⇒ **没结论**，且按四种成因各念一句（起不来 / 非 2xx 且原话里没有 scope 名 /
 *    空响应 / 输出不是平台信封）。这一档绝不落进「够得着」。
 *
 * @param {string} raw 平台回的响应原文
 * @param {{error?: string | null, status?: number}} [transport] 取这一条时的传输层事实
 * @returns {{state: "denied" | "granted" | "unknown", scope?: string, status?: number, why?: string}}
 */
export function classifyReply(raw, transport = {}) {
  const text = String(raw ?? "");
  const missing = SCOPE_PATTERN.exec(text);
  if (missing) {
    /* 空捕获（原话只到 `Missing required scopes` 就断了）与没捕获是同一件事：
     * 平台拒了这次请求，但没把那枚 scope 的名字写出来。 */
    return {
      state: "denied",
      scope: missing[1] || "（原话里没写出 scope 名）",
    };
  }
  const status = typeof transport.status === "number" ? transport.status : null;
  /* 2xx = 平台认了这次请求。业务层的 404 走 `status` 是 404 那一档 —— 见 ③ 里的分支，
   * 而它的**判据不是状态码本身**：下面先判「有没有平台信封」，再看码。 */
  const envelope = /"errcode"\s*:\s*(\d+)/.exec(text);
  /* ⚠️ 业务层的「对象不在」有两种码：`errcode: 5`（`Resource not found.`）与
   * `errcode: 404`（`not found`，PR #1 不存在走的就是这一支）。两者都是**平台认了
   * 这次请求、只是那个对象没有** —— 判据是「不是权限问题」而不是「码等于几」，
   * 所以这里认的是 `5` 与 `4xx` 两族，且都要求**没有**那句 `Missing required scopes`
   * （有的话上面那一支已经返回了）。 */
  const code = envelope ? Number(envelope[1]) : null;
  if (code === 5 || (code !== null && code >= 400 && code < 500)) {
    return { state: "granted", status: status ?? code };
  }
  if (status !== null && status >= 200 && status < 300) {
    return { state: "granted", status };
  }
  /* 以下都是「没量到」，四支各念一句 —— 别让读的人在同一个形状面前猜。 */
  if (transport.error) {
    return { state: "unknown", why: `起不来（${transport.error}）` };
  }
  if (text === "") {
    return {
      state: "unknown",
      why: `没有响应正文（HTTP ${status ?? "?"}）`,
    };
  }
  const errmsg = /"errmsg"\s*:\s*"([^"]{1,160})"/.exec(text);
  if (errmsg) {
    return {
      state: "unknown",
      status: status ?? undefined,
      why: `平台回了 ${status ?? "?"}：${errmsg[1]?.replaceAll("\"", "'")}`,
    };
  }
  return {
    state: "unknown",
    status: status ?? undefined,
    why: `响应里既没有信封也没有 errmsg（HTTP ${status ?? "?"}，${text.length} 字节）`,
  };
}

/**
 * 探针清单过一遍（注入 `fetchFact` 让用例一条网络请求都不发）。
 *
 * @typedef {{
 *   repo: string,
 *   base: string,
 *   token: string,
 *   fetchFact: (ctx: {base: string, token: string, repo: string}, subPath: string, extra?: {method?: string, body?: string}) => Promise<FetchResult>,
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
 *   path: string,
 *   reply: ReturnType<typeof classifyReply>,
 *   ms: number | null,
 * }} ProbeRow
 */

/**
 * @param {ProbeOptions} opts 仓库、平台地址、注入的取数口、两个可选开关
 * @returns {Promise<ProbeRow[]>}
 */
export async function probeAll(opts) {
  /** @type {Probe[]} */
  const probes = opts.oidc ? [...PROBES, OIDC_PROBE] : PROBES;
  const only = opts.only ?? [];
  const picked = only.length
    ? probes.filter((p) => only.includes(p.domain))
    : probes;
  const ctx = { base: opts.base, token: opts.token, repo: opts.repo };
  /* **并发跑，不是串行**（第五跑的现场：读数全跑完了却撞上 2m 的平台预算）。十四条探针
   * 互不依赖，串行只把「一次慢请求」乘成十四条；而平台那一格的预算是整跑算的。
   * 并发度取 6：比「全放」慢不了多少，又不会在同一次构建里朝平台打 14 发。 */
  const CONCURRENCY = 6;
  /** @type {ProbeRow[]} */
  const rows = [];
  const queue = [...picked];
  /** @returns {Promise<void>} */
  const worker = async () => {
    for (let probe = queue.shift(); probe; probe = queue.shift()) {
      /* `oidc` 那一问的请求体含令牌 ⇒ 只有它带 `body`，且**只从 env 取、不回显**。 */
      const extra =
        probe === OIDC_PROBE
          ? { method: "POST", body: '{"aud":"ci-token-scopes"}' }
          : {};
      const r = await opts.fetchFact(ctx, probe.path, extra);
      rows.push({
        domain: probe.domain,
        scope: probe.scope,
        why: probe.why,
        note: probe.note,
        path: probe.path,
        reply: classifyReply(r.body, r),
        ms: r.ms ?? null,
      });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return rows;
}

/**
 * 「在哪看」—— 把这一次读数映射到**读者要找的那个位置**（ISSUE #2551 的追问）。
 *
 * 这一行是被一句话逼出来的：读数早就打出来了，而人来问「它每天在日志里，在哪里，我没看到」。
 * 也就是说，**读数落在日志里、而读者找不到它，与没有读数等价** —— 这与
 * `ci-workspace-probe.mjs` 里「job 标签只取 basename，两跑并排一模一样」是同一类病。
 *
 * 映射按**触发口**（`CNB_EVENT` 是唯一权威）：同一条 `ci-token-scopes.mjs` 挂在三处，
 * 而三处的**路径完全不同**（`.cnb.yml` 里 `每日令牌权限读数` / `令牌权限读数` /
 * 桌包那一格）。所以「去哪个流水线、哪一格里看」不能靠读的人自己拼。
 *
 * ⚠️ 默认退化成「照事件名去找」而不是猜一个具体格名：事件名认不出来时，写死一条路径
 * 就是在教人去看一个可能不存在的地方 —— 那比不写更坏（§13.6.4.1 同一条纪律）。
 *
 * @param {{event?: string | null, label?: string | null}} ctx 这一跑的事件与流水线名
 * @returns {string} 一行「在哪看」
 */
export function whereItLives(ctx) {
  const event = String(ctx.event ?? "");
  const label = ctx.label ? `${ctx.label} 流水线` : "流水线";
  /**
   * ⚠️ 定时那两档**不能只按 `crontab:` 前缀分**：01:00 是每日档（第二格「每日令牌权限读数」），
   * 03:00 是桌包档（endStages 里的「令牌权限读数」）。第一版就是这么写的，用例当场抓到
   * 它把桌包那一跑指去了每日档的格名 —— 指错位置比不指更坏，所以这两条先于通用前缀判。
   * 时刻若再挪（`.cnb.yml` 注释里连挪了三次 `0 4` → `0 2` → `0 0` → `0 1`），这里要同批改；
   * 认不出来的就落进最后那条按事件名指路的出口，而不是落回一个陈旧的格名。
   */
  const dailyCron = /^crontab:\s*0\s+1\s/.test(event);
  const packageCron = /^crontab:\s*0\s+3\s/.test(event);
  /** @type {{match: (e: string) => boolean, where: string}[]} */
  const lanes = [
    {
      match: (e) => e === "pull_request",
      where: `这一跑：${label} → 最后两格（endStages）里的「令牌权限读数」`,
    },
    {
      match: () => packageCron,
      where: `这一跑：${label} → 最后两格（endStages）里的「令牌权限读数」`,
    },
    {
      match: () => dailyCron,
      where: `这一跑：${label} → 第二格「每日令牌权限读数」`,
    },
    {
      match: (e) => e.startsWith("web_trigger_package") || e.startsWith("api_trigger_package"),
      where: `这一跑：${label} → 最后两格（endStages）里的「令牌权限读数」`,
    },
    {
      match: (e) => e.startsWith("web_trigger_daily") || e.startsWith("api_trigger_daily"),
      where: `这一跑：${label} → 第二格「每日令牌权限读数」`,
    },
  ];
  const lane = lanes.find((l) => l.match(event));
  return (
    `在哪看：${lane ? lane.where : `按事件名 ${event || "（不在场）"} 找到这一跑的流水线，` +
      "在它的 stage 列表里找「令牌权限读数」/「每日令牌权限读数」那一格"}` +
    " · 平台不把每一格的日志摊在流水线首页，要点进那一格才看得见"
  );
}

/**
 * 读数：哪一族够得着、哪一族被平台点名缺什么、哪一族没量到。
 *
 * @param {ProbeRow[]} rows
 * @param {{repo: string, event: string | null, branch: string | null, label?: string | null}} ctx
 * @returns {string[]}
 */
export function formatReadout(rows, ctx) {
  const lines = [
    /* ⚠️ 这一行只认 `ctx.label`，不认 `ctx.event` —— 见下面 `whereItLives()` 里那条：
     * 这一格在哪看，是「事件 → 哪条流水线」的映射，不是这一跑的事件名。 */
    whereItLives(ctx),
    "",
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
     * ③ 一条答复都没有 → **「没量到」**。⚠️ 这一档绝不能念成「获授权」：
     *    平台没拒 ≠ 允许，那正是 §13.6.4.1 那条「取不到 ≠ 测出来是好的」。 */
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
      const mark =
        r.reply.state === "denied" ? "×  " : r.reply.state === "granted" ? "ok " : "?  ";
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
  /* 耗时那一行是**给预算用的读数**：第五跑读数全跑完了却撞上平台 2m 预算，
   * 而屏幕上一个字都没说「时间花在哪」。取最慢的三条点名，下一跑就不用猜。 */
  const slowest = [...rows]
    .filter((r) => typeof r.ms === "number")
    .sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0))
    .slice(0, 3);
  const totalMs = rows.reduce((sum, r) => sum + (r.ms ?? 0), 0);
  lines.push(
    `耗时：${rows.length} 条探针合计 ${totalMs}ms` +
      (slowest.length
        ? `，最慢的 ${slowest.length} 条 ${slowest
            .map((r) => `${r.path}=${r.ms}ms`)
            .join(" · ")}`
        : ""),
  );
  lines.push(
    "读数不做判据：这一格量的是平台怎么给权限，红了不构成任何结论（恒退 0）。" +
      "「未获授权」不代表这一跑有问题 —— 平台按「事件 + ref」分配，PR 那一族本来就只有 repo-code:r。",
  );
  return lines;
}

/**
 * `main()` 的入参：`argv` / `env` / `fetchFact` / `log` 四件各留一个注入点，
 * 用例因此**一条网络请求都不发**（真实入口那几行只填默认值）。
 *
 * @typedef {{
 *   argv?: string[],
 *   env?: Record<string, string | undefined>,
 *   fetchFact?: typeof fetchFact,
 *   log?: (s: string) => void,
 * }} MainOptions
 */

/**
 * `main()` 的判决：`--only` / `--json` / `--strict` / `--probe-oidc`，
 * 以及「这一跑有没有量出任何东西」那一档。
 *
 * @param {MainOptions} [opts]
 * @returns {Promise<number>}
 */
export async function main(opts = {}) {
  const argv = opts.argv ?? process.argv.slice(2);
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((/** @type {string} */ s) => console.log(s));
  const fetchOne = opts.fetchFact ?? fetchFact;

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
  const token = env.CNB_TOKEN ?? "";
  const base = value("--base", env.CNB_API_ENDPOINT ?? "");
  if (!repo || !token || !base) {
    const missing = [!repo && "仓库", !token && "CNB_TOKEN", !base && "CNB_API_ENDPOINT"]
      .filter(Boolean)
      .join(" / ");
    log(
      `[token-scopes] 认不出 ${missing} ⇒ 没量到任何东西。` +
        "（这一格只要这两件平台无条件注入的东西，`--repo` / `CNB_REPO_SLUG` 可补仓库名。）",
    );
    return flag("--strict") ? CODE.NO_FACT : CODE.OK;
  }
  const only = value("--only", "")
    .split(",")
    .map((/** @type {string} */ s) => s.trim())
    .filter(Boolean);

  const rows = await probeAll({
    repo,
    base,
    token,
    fetchFact: fetchOne,
    only,
    oidc: flag("--probe-oidc"),
  });
  if (flag("--json")) {
    log(
      JSON.stringify(
        { repo, event: env.CNB_EVENT ?? null, branch: env.CNB_BRANCH ?? null, rows },
        null,
        1,
      ),
    );
  } else {
    log(
      formatReadout(rows, {
        repo,
        /* 流水线名只用来把「在哪看」念准（`每日生产构建` / `质量门禁` / `桌面成品包`）；
         * 环境里没有它时那一行会退回按事件名指路，而不是猜一个格名。 */
        label: env.CNB_PIPELINE_NAME ?? null,
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
  path.resolve(process.argv[1]) === import.meta.filename
) {
  process.exit(await main());
}
