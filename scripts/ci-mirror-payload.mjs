/**
 * `ci-mirror-payload.mjs` —— 派发 payload 与 **PR 标题**那一格。
 *
 * ## 它要回答的那一格
 *
 * GitHub 的 run 列表此前只显示 `PR #3156 · 2048ae3dc35db1b56c942bf0baf2384073d258c0`
 * —— PR 号 + sha 认得出「是哪一跑」，认不出「这条 PR 在修什么」。标题的权威来源是
 * 平台上的 PR（`cnb pulls get-pull -v` 的 `data.title`）：镜像格派发时读一次、归一成
 * 单行、塞进 `client_payload.pr_title`，`.github/workflows/pr-gate.yml` 的 `run-name`
 * 把它排成 `PR #<号> · <标题> · <sha>`。
 *
 * ## 三条口径
 *
 * 1. **读不到就留空，不编标题**：slug 缺席 / `get-pull` 没跑起来 / 平台标题本身为空
 *    ⇒ `pr_title` 是空串，workflow 那一侧退回老格式 `PR #<号> · <sha>`。这一格是
 *    **派发元数据的补充**，它坏了不许把镜像这一格判红（三态与退码一字未动）。
 * 2. **归一成安全的单行**：控制字符 → 空格、连续空白折叠、去首尾 —— run 标题是
 *    GitHub 的单行展示面，换行 / 制表符落进去只会把同一句读成好几行。`#`、`(`、
 *    中文都是普通字符（run-name 是表达式插值，不是再解析一遍的 YAML），不转义、
 *    不删改；只按长度截断（`RUN_TITLE_LIMIT`）并补一个 `…`，因为 run-name 有总长上限。
 * 3. **sha 必须全量留在标题里**：`ci-github-verdict-read.mjs` 靠 `display_title` 里的
 *    整 sha 认领本跑（`?head_sha=` 对 dispatch 触发的 run 失效），排版把 sha 放在**末尾**
 *    且不截断 —— 标题怎么截都动不到它。
 *
 * ## 为什么单独一份
 *
 * `ci-github-mirror-push.mjs` 贴着 §12.6 R5 的 900 行硬闸：payload 拼装与标题取数都是
 * 纯函数（输入事实 / 回话，输出 payload / 一句话），与网络、git 子进程无关。切出去之后
 * 主文件回到闸内；主文件把这些名字原样转出，`tests/ci-github-mirror-push.test.ts` 的
 * 导入面不用动。
 *
 * @module scripts/ci-mirror-payload — 派发 payload 的拼装、PR 标题的取数与 run 标题口径
 */
import path from "node:path";

import { cnbJson, makeRunner } from "./ship-exec.mjs";

/** 派发的事件名，与 `.github/workflows/pr-gate.yml` 的 `types:` 逐字配对。 */
export const EVENT_TYPE = "cnb-pr-sync";

/** 本仓检出根（`scripts/` 的上一层）—— 与镜像格同一口径，不靠继承的工作目录。 */
const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 组装派发 payload（形状与 `.github/workflows/pr-gate.yml` 的
 * `client_payload` 消费面一一对应）。
 *
 * `pr_title` 是**可选补充**：读不到时为空串，workflow 的 `run-name` 据此退回
 * `PR #号 · sha` 的老格式 —— 老 payload（没有这个键）与「有新键但值为空」在 GitHub 侧
 * 渲染出同一句，两者都不报错。
 *
 * @param {{ref: string, headSha: string, baseSha: string, cnbCommit: string, prNumber: string, title?: string}} args
 * @returns {{event_type: string, client_payload: Record<string, string>}}
 */
export function dispatchPayload({ baseSha, cnbCommit, headSha, prNumber, ref, title = "" }) {
  return {
    client_payload: {
      base_sha: baseSha,
      branch: ref,
      cnb_commit: cnbCommit,
      head_sha: headSha,
      pr_number: prNumber,
      pr_title: title,
    },
    event_type: EVENT_TYPE,
  };
}

/**
 * 标题本体的长度预算（字符，不是字节）。
 *
 * GitHub 的 run-name 总量有上限（256），而标题之外还有 `PR #`、分隔符与 40 位 sha；
 * 给标题留 160：前缀 + 标题 + ` · ` + sha 最坏 ≈ 5 + 3 + 160 + 3 + 40 ≈ 211，离 256
 * 还有余量（还给 `manual` 那一档与将来可能的元数据）。
 */
export const RUN_TITLE_LIMIT = 160;

/**
 * 把平台标题归一成 run 标题能用的**安全单行**。
 *
 * 非字符串（缺键 / `null`）一律回空串：调用方据此走「没有标题」的回落，而不是
 * 把 `undefined` 拼进标题里。控制字符先换空格再折叠空白 —— 顺序反过来时
 * `a\u0007b` 会粘成 `ab`，那是改写内容而不是排版。
 *
 * @param {unknown} raw 平台 `data.title` 原值
 * @returns {string} 单行标题；没有可用标题时为空串
 */
export function normalizeRunTitle(raw) {
  if (typeof raw !== "string") {
    return "";
  }
  const flat = raw
    .replaceAll(/\p{Cc}+/gu, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (flat.length <= RUN_TITLE_LIMIT) {
    return flat;
  }
  return `${flat.slice(0, RUN_TITLE_LIMIT - 1)}…`;
}

/**
 * 从 `cnb pulls get-pull -v` 的应答里读 PR 标题。
 *
 * 缺 `data.title` 键与「回读没跑起来」在调用方是同一档（都是「没有标题可用」），
 * 所以这里缺键回空串，由 {@link resolvePrTitle} 留一行读数把两者分开念。
 *
 * @param {any} json `get-pull -v` 解析后的 JSON
 * @returns {string} 归一后的标题；缺键 / 非字符串时为空串
 */
export function readPullTitle(json) {
  const d = json?.data;
  if (!d || typeof d !== "object" || typeof d.title !== "string") {
    return "";
  }
  return normalizeRunTitle(d.title);
}

/**
 * `get-pull` 的参数表（与 `ship-pr-body.mjs` / `ship-platform.mjs` 同一形状）。
 *
 * @param {string} slug 仓库路径（`组织/仓库`）
 * @param {string} number PR 请求 ID（纯数字）
 * @returns {string[]} cnb 参数
 */
export function pullTitleArgs(slug, number) {
  return ["pulls", "get-pull", "--repo", slug, "--number", String(number), "-v"];
}

/**
 * 读平台上的 PR 标题；三种「没有标题」各自留一行读数（不静默）。
 *
 * 注入面与镜像格同形：`cnbJson` 是取数动作（用例给假件，一次子进程都不起），
 * `run` 是外部命令执行者（缺省 `makeRunner(ROOT)`）。
 *
 * @param {{env: Record<string, string | undefined>, iid: string, log: (line: string) => void, cnbJson?: (run: any, args: string[]) => any, run?: (cmd: string, args: string[]) => any}} io
 *   `env.CNB_REPO_SLUG` 是平台注入的仓库路径；`iid` 是 `CNB_PULL_REQUEST_IID`。
 * @returns {string} 可分派用的单行标题；没有时为空串
 */
export function resolvePrTitle(io) {
  const { env, iid, log } = io;
  const readJson = io.cnbJson ?? cnbJson;
  const slug = String(env.CNB_REPO_SLUG ?? "").trim();
  if (slug === "") {
    log(
      "[mirror] PR 标题：跳过回读（`CNB_REPO_SLUG` 缺席）⇒ payload 的 `pr_title` 留空，run 标题退回 `PR #号 · sha`",
    );
    return "";
  }
  const got = readJson(io.run ?? makeRunner(ROOT), pullTitleArgs(slug, iid));
  if (got === null || got === undefined) {
    log(
      `[mirror] PR 标题：回读没跑起来（\`pulls get-pull\` 取不到 @ ${slug}#${iid}）⇒ ` +
        "payload 的 `pr_title` 留空，run 标题退回 `PR #号 · sha`",
    );
    return "";
  }
  const title = readPullTitle(got.json);
  log(
    title === ""
      ? `[mirror] PR 标题：平台上是空的（@ ${slug}#${iid}）⇒ \`pr_title\` 留空（不编标题）`
      : `[mirror] PR 标题：${title}`,
  );
  return title;
}

/**
 * GitHub 侧 `run-name` 的**本仓拼装口径**（与 `.github/workflows/pr-gate.yml` 逐字同形）。
 *
 * · 有标题 ⇒ `PR #<号> · <标题> · <sha>`
 * · 无标题 ⇒ `PR #<号> · <sha>`（老格式，给了旗标之前那一跑读到的就是这一句）
 *
 * 生产路径拿它打一行「这一跑会叫什么」的读数（派发前的自证）；cases 用它钉住
 * 「缺失回退 / 超长截断」两形。sha 放在末尾且不截断 —— 回读格靠它认领本跑。
 *
 * @param {{prNumber: string, sha: string, title?: string}} args
 * @returns {string} run 标题
 */
export function buildRunName({ prNumber, sha, title = "" }) {
  const n = String(prNumber ?? "").trim() === "" ? "manual" : String(prNumber).trim();
  const t = normalizeRunTitle(title);
  return t === "" ? `PR #${n} · ${sha}` : `PR #${n} · ${t} · ${sha}`;
}
