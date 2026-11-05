#!/usr/bin/env node
/**
 * cnb-fields.mjs — `cnb … -v` 字段取法的**单一出处**（ISSUE #3060）。
 *
 * ── 口径一句话 ─────────────────────────────────────────────────────────
 *
 * `cnb … -v` 的 JSON 有两层：外层信封（HTTP `status` 等，与结论无关）与 `data`
 * **结论包**。结论只认 `data` 里的键：build 的 `data.status`、PR 的
 * `data.is_merged` / `data.number` / `data.state`、清单端点的 `data` 数组
 * （分页端点偶尔多一层 `data.data`，见 {@link cnbRecords}）。`data` 里**没有**
 * 那个键 ⇒ 字段真的缺了（平台间歇缺键，ISSUE #3059），如实按缺键报——
 * 「缺键」与「拆错层」从此在读数上不再长得一样。
 *
 * ── 为什么要有这一份 ───────────────────────────────────────────────────
 *
 * 从前「取哪个键」各处自己写：`data.x` / `data.data.x` / `d?.x` 各一份，
 * 同一次会话里两种补字对的写法对 `is_merged` 给出**相反**结论（#3060 现场：
 * `cnbJson` 走 `json.data.is_merged` 说 true，python3 直读 stdout 却 KeyError）——
 * 人核对时无法判断「字段真缺了」还是「哪一层把字段吃掉了」。收成一份 reader
 * 之后，「缺键」是 `ok:false` 加原因，「拆错层」根本没有这条路径。
 *
 * ── 收窄的方式 ─────────────────────────────────────────────────────────
 *
 * 外部 JSON 的形状不在本仓手里 ⇒ 类型收窄全走**谓词**（`v is T`），不走断言——
 * #3167 开的 `no-unsafe-type-assertion` 对「断言收窄」零容忍，谓词是它认可的
 * 唯一形状（与 `tests/session-report.test.ts` 的 `isExecError` 同一口径）。
 *
 * ── 不做什么 ───────────────────────────────────────────────────────────
 *
 * 不新写「判据扫描器」——这一条的代价是「读法不一致」，不是「没人扫」。
 * 本模块不跑 `cnb`、不碰网络，只是**已经拿到的 JSON** 的解包与读数；
 * `cnbJson`（怎么起命令、怎么解析）仍归 `ship-exec.mjs`，两边各管一层。
 *
 * @module scripts/cnb-fields — cnb -v 字段取法的单一出处（信封解包 + 缺键显式化）
 */

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** @param {unknown} v @returns {v is unknown[]} */
function isArray(v) {
  return Array.isArray(v);
}

/**
 * @typedef {{number?: number | string, mergeable_state?: string, blocked_on?: string,
 *   is_merged?: boolean, state?: string, title?: string,
 *   base?: {ref?: string}}} CnbPullData
 *   PR 记录的结论包形状（`readPullVerdict` / `readPullCreateError` 共用的字段面）。
 */

/**
 * 信封解包：`cnb … -v` 的 JSON → **结论包** `data`。
 *
 * @param {unknown} json `cnbJson` 交回的解析结果
 * @returns {Record<string, unknown> | null} `data` 缺失 / 不是对象时 `null`
 *   （调用方按「信封形状不对」报，不冒充「字段缺了」）
 */
export function cnbData(json) {
  if (!isRecord(json)) {
    return null;
  }
  return isRecord(json.data) ? json.data : null;
}

/**
 * 从结论包里读一个键，**缺键显式化**：返回的不是 `undefined` 而是一份三态读数，
 * 调用方不用再猜「是字段缺了还是我拆错了层」。
 *
 * @param {unknown} json `cnbJson` 交回的解析结果
 * @param {string} key 结论包里的键名（如 `is_merged` / `number` / `state`）
 * @returns {{ok: true, value: unknown} | {ok: false, reason: string}}
 *   `ok:false` 的两种原因：`信封形状不对`（`data` 都没有）/ `data 缺键 <key>`
 */
export function readCnbField(json, key) {
  const data = cnbData(json);
  if (data === null) {
    return { ok: false, reason: "信封形状不对（data 缺失或不是对象）" };
  }
  if (!(key in data)) {
    return { ok: false, reason: `data 缺键 ${key}` };
  }
  return { ok: true, value: data[key] };
}

/**
 * 清单端点的记录数组解包：`list-pulls` / `get-build-logs` 那一族返回的可能是
 * `data` 数组（单层）、`data.data` 数组（分页双层）、或裸数组（`cnbJson` 直接
 * 拿到一份清单）。三种形状收成一份**记录数组**，形状都不对回空数组并让调用方
 * 按各自的三态口径报「没跑起来」。
 *
 * @param {unknown} json `cnbJson` 交回的解析结果
 * @returns {Array<Record<string, unknown>>}
 */
export function cnbRecords(json) {
  /* 裸数组先判：isRecord 对数组回 false（它排除了 Array），先判会把这一支吃掉。 */
  if (isArray(json)) {
    return json.filter(isRecord);
  }
  if (!isRecord(json)) {
    return [];
  }
  if (isArray(json.data)) {
    return json.data.filter(isRecord);
  }
  if (isRecord(json.data) && isArray(json.data.data)) {
    return json.data.data.filter(isRecord);
  }
  return [];
}
