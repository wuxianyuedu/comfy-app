/**
 * ship-pull-reuse.mjs — 「建 PR 响应里取号」的判定（ISSUE #4318）
 * =================================================================
 *
 * 建 PR（`cnb pulls post-pull`）有两种响应带得出 PR 号，旧版只认第一种：
 *
 *   ① 成功：`data.number` —— 这一跑真的建出了新 PR；
 *   ② 409「这条分支已有开放 PR」：`data.errcode=2009003`，号在 `data.errparam.number`。
 *
 * 漏掉 ② 的后果（#4318 现场）：`list-pulls` 抖动没读到开放清单 ⇒ 建 PR 幂等那一格
 * 误判「无 PR」⇒ 真去建 ⇒ 平台 409 拒绝；号明明在 `errparam.number` 里，却因为只认
 * `data.number` 而落 `CODE.NOT_RUN`（exit 2）—— 平台 409 这道幂等防线没兜住，反而
 * 把一次接口抖动升级成流程断点（CI 与 PR 都健康，ship 却停在建 PR 那一格）。
 *
 * 为什么单独一件：`ship-platform.mjs` 贴着 900 行硬闸（拆点与同类约束见该文件头），
 * 新增判定不往里加行。本模块只做**纯判定**：取号、说清来源，不起进程、不判绿不判合并。
 *
 * 信封解包走单一出处 `cnbData`（ISSUE #3060）；errcode 的读取与
 * `readPullCreateError` 同口径（认 `json.errcode ?? data.errcode`，不猜别的键名）。
 */
import { cnbData } from "../platform/cnb-fields.mjs";

/** 平台「该分支已有开放 PR」的业务码（实测：409 + errcode 2009003 + errparam.number）。 */
export const PR_ALREADY_OPEN_ERRCODE = 2_009_003;

/**
 * 从建 PR 的响应里取 PR 号，并说清号是从哪来的。
 *
 * 只认两种来源；其余（含别的 errcode、消息里带数字、errparam 里别的键）一律
 * `{number:null, via:null}` —— 拿一个猜出来的号去等 CI / 合并比退 2 危险得多。
 *
 * @param {any} json `cnbJson` 交回的解析结果
 * @returns {{number: number | null, via: "created" | "duplicate" | null}}
 *   `via="created"` 号来自成功响应的 `data.number`（本次真建）；
 *   `via="duplicate"` 号来自 409 已有开放 PR 的 `data.errparam.number`（复用）；
 *   `via=null` 取不到号。
 */
export function readCreatedPullNumber(json) {
  const data = cnbData(json);
  if (!data) {
    return { number: null, via: null };
  }
  /* ① 成功响应：data.number（readPullVerdict 认的同一个键）。 */
  const created = toPullNumber(data.number);
  if (created !== null) {
    return { number: created, via: "created" };
  }
  /* ② 已有开放 PR：errcode 必须是 2009003，号只在 errparam.number。
   * 先判 errcode 再看 errparam —— 别的拒绝（如 2000003 body too long）即使
   * 带 errparam 也不许当成 PR 号。errcode 数字 / 数字字符串都认（平台两者都出现过）。 */
  const errcode = json?.errcode ?? data.errcode;
  if (Number(errcode) !== PR_ALREADY_OPEN_ERRCODE) {
    return { number: null, via: null };
  }
  const errparam = /** @type {{number?: unknown} | null} */ (
    data.errparam && typeof data.errparam === "object" ? data.errparam : null
  );
  const reused = errparam ? toPullNumber(errparam.number) : null;
  if (reused === null) {
    return { number: null, via: null };
  }
  return { number: reused, via: "duplicate" };
}

/**
 * 只认正整数（数字或纯数字字符串）；缺键 / NaN / 0 / 负数 / 浮点一律 null。
 * @param {unknown} value
 * @returns {number | null}
 */
function toPullNumber(value) {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) {
    return null;
  }
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
