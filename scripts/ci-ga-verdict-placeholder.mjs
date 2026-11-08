#!/usr/bin/env node
/**
 * `ci-ga-verdict-placeholder.mjs` —— GA 回调 status 的**只读对账入口**（ISSUE #3378）。
 *
 * ## 它回答哪一格
 *
 * 2026-11-08 转正后，GA 收尾 job 的 callback 是唯一判决数据源，CNB 侧
 * `GA 回调结论回读`（`ci-ga-verdict-readout.mjs`）站内读它写进
 * `GET /{repo}/-/pulls/{n}/commit-statuses` 的终态。骨架期的占位写者
 * （`GA_ROLE=placeholder`）已退役，但这条只读入口留着做**现场对账**：
 * 从那张 statuses 集合按 context 前缀分出「占位 / 回调 / 其它」三堆，给一行
 * 可复做的读数（哪一堆在场、终态是什么、全量聚合落在哪）。
 *
 * 它是历史 skeleton 的读数工具，不是判据、不承重：名字留 `placeholder` 是
 * 骨架落地时的称谓，改它要连 GA 侧 payload 与历史读数一起改，不值当。
 *
 * ## 刻意不做的事
 *
 * - **不写状态、不起 build、不掐谁**：这些都是动作，归 `.cnb.yml` 的回调
 *   流水线（它才有可信事件令牌）与 GA 侧回调脚本。本文件一次网络写都不发。
 * - **不判「能不能合」**：聚合 `state` 是平台算的，本入口只把它念出来，
 *   不另立第二套判定（硬规则 27 第三条）。
 * - **不是判据**：默认本地档不跑它，人/探针要复验时才调一次。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci-ga-verdict-placeholder.mjs --pr <IID> --repo <slug> [--json] [--dry-run]
 * ```
 *
 * 令牌取 `CNB_TOKEN`（平台注入，只读够用）或 `CNB_TRIGGER_TOKEN`。
 */
import path from "node:path";
import process from "node:process";

import { CODE } from "./ci-github-mirror-push.mjs";
import { readOption } from "./ci-ga-verdict-callback.mjs";

/** CNB OpenAPI 的缺省服务地址。 */
export const DEFAULT_API_ENDPOINT = "https://api.cnb.cool";

/** 占位与回调共用的 context 前缀（与 `CALLBACK_EVENT` 同源）。 */
export const STATUS_PREFIX = "cnb/api_trigger_ga_verdict";

/**
 * 一次 HTTP 读数的最小形状（注入面用，不给 `typeof fetch` 逼测试做断言）。
 *
 * @typedef {{ok: boolean, status: number, json: () => Promise<any>}} FetchResponse
 * @typedef {(url: string, init: {headers: Record<string, string>}) => Promise<FetchResponse>} FetchLike
 */

/**
 * 是能按键取值的对象吗（`unknown` 先过这一跳，不做类型断言）。
 *
 * @param {unknown} value 任意值
 * @returns {value is Record<string, unknown>} true ⇒ 可按键取值
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 从一个可能不是对象的值里按字符串键取值（不做类型断言）。
 *
 * @param {unknown} value 任意值
 * @param {string} key 键名
 * @returns {unknown} 值；取不到时 undefined
 */
function field(value, key) {
  return isRecord(value) ? value[key] : undefined;
}

/**
 * 从 status 项里认出它的角色。
 *
 * 回调 build 带 `GA_ROLE=callback`、占位带 `GA_ROLE=placeholder`，但 commit-status
 * 的 `context` 里**不含 env**（平台按事件+流水线名生成），所以角色只能从
 * `description` / `target_url` 里带的那一枚标记认；认不出就归 `unknown`，
 * 不猜、不按「有两条就是齐了」放行。
 *
 * @param {unknown} status 一条 commit-status
 * @returns {"callback" | "placeholder" | "unknown"} 角色
 */
export function statusRole(status) {
  const text = [field(status, "context"), field(status, "description"), field(status, "target_url")]
    .map((v) => (typeof v === "string" ? v : ""))
    .join(" ");
  if (/GA_ROLE=callback|role=callback/i.test(text)) {
    return "callback";
  }
  if (/GA_ROLE=placeholder|role=placeholder/i.test(text)) {
    return "placeholder";
  }
  return "unknown";
}

/**
 * 把一张 statuses 集合折成三堆 + 聚合读数。
 *
 * @param {unknown} payload `ListPullCommitStatuses` 的应答（数组 / `{data:[]}` / `{data:{…}}`）
 * @returns {{rows: Array<{context: string, state: string, role: string}>, callback: number, placeholder: number, unknown: number, aggregate: string}}
 */
export function summarizeStatuses(payload) {
  const data = field(payload, "data");
  const raw =
    [payload, data, field(data, "statuses"), field(payload, "statuses")].find((candidate) =>
      Array.isArray(candidate),
    ) ?? [];
  const rows = raw.map((item) => {
    return {
      context: String(field(item, "context") ?? ""),
      role: statusRole(item),
      state: String(field(item, "state") ?? field(item, "status") ?? ""),
    };
  });
  const ours = rows.filter((r) => r.context.startsWith(STATUS_PREFIX));
  /** @param {string} role 角色名 */
  const tally = (role) => ours.filter((r) => r.role === role).length;
  const states = rows.map((r) => r.state.toLowerCase());
  const aggregate = states.some((s) => ["error", "failure"].includes(s))
    ? "failure"
    : states.some((s) => ["pending", "running"].includes(s))
      ? "pending"
      : "success";
  return {
    aggregate,
    callback: tally("callback"),
    placeholder: tally("placeholder"),
    rows,
    unknown: tally("unknown"),
  };
}

/**
 * 主流程：取一次 statuses、念读数。
 *
 * @param {{argv?: string[], env?: Record<string, string | undefined>, fetchImpl?: FetchLike, log?: (line: string) => void}} io
 * @returns {Promise<number>} 0 取到读数 / 2 没取到（不构成绿）
 */
export async function main(io = {}) {
  const argv = io.argv ?? process.argv.slice(2);
  const env = io.env ?? process.env;
  const log =
    io.log ??
    ((line) => {
      console.log(line);
    });
  const pr = (readOption(argv, "--pr") || env.CNB_PULL_REQUEST_IID || "").trim();
  const repo = (readOption(argv, "--repo") || env.CNB_REPO_SLUG || "").trim();
  const token = (env.CNB_TOKEN || env.CNB_TRIGGER_TOKEN || "").trim();
  const endpoint = (env.CNB_API_ENDPOINT || DEFAULT_API_ENDPOINT).replace(/\/+$/, "");
  const reasons = [];
  if (!/^\d+$/.test(pr)) {
    reasons.push("PR 编号缺席（--pr / CNB_PULL_REQUEST_IID）");
  }
  if (!repo) {
    reasons.push("仓库 slug 缺席（--repo / CNB_REPO_SLUG）");
  }
  if (!token) {
    reasons.push("令牌缺席（CNB_TOKEN / CNB_TRIGGER_TOKEN）");
  }
  if (reasons.length > 0) {
    for (const reason of reasons) {
      log(`[ga-placeholder] 前提不成立：${reason}`);
    }
    return CODE.NO_FACT;
  }
  const url = `${endpoint}/${repo}/-/pulls/${pr}/commit-statuses`;
  if (argv.includes("--dry-run")) {
    log(`[ga-placeholder] DRY-RUN：GET ${url}`);
    return CODE.OK;
  }
  let response;
  try {
    response = await (io.fetchImpl ?? fetch)(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    log(`[ga-placeholder] 请求没发出去：${String(error)}`);
    return CODE.NO_FACT;
  }
  if (!response.ok) {
    log(`[ga-placeholder] 平台回 ${response.status} ⇒ 没取到读数`);
    return CODE.NO_FACT;
  }
  const summary = summarizeStatuses(await response.json());
  if (argv.includes("--json")) {
    log(JSON.stringify(summary, null, 1));
  } else {
    log(
      `[ga-placeholder] ${STATUS_PREFIX}：占位 ${summary.placeholder} 条 · 回调 ${summary.callback} 条 · ` +
        `认不出角色 ${summary.unknown} 条 · 全量聚合 ${summary.aggregate}`,
    );
    for (const row of summary.rows.filter((r) => r.context.startsWith(STATUS_PREFIX))) {
      log(`[ga-placeholder]   ${row.role} · ${row.state} · ${row.context}`);
    }
  }
  return CODE.OK;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (invokedDirectly) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`[ga-placeholder] 没取到读数：${String(error)}`);
      process.exitCode = CODE.NO_FACT;
    },
  );
}
