/**
 * `ci-mirror-failure-report.mjs` —— 镜像格「失败怎么说给人听」的那一层（ISSUE #3106）。
 *
 * ## 为什么单独一份
 *
 * `ci-github-mirror-push.mjs` 撞上 §12.6 R5 的 900 行硬闸（拆分前 1097 行）：那一格把
 * 「怎么推」与「推坏了怎么说」写在同一份里，而后者是纯函数（输入回话、输出类别与一句话），
 * 与网络 / git 子进程无关。切出去之后主文件回到闸内；调用点与既有导出面**一字未改**
 * （主文件把这些名字原样转出，`tests/ci-github-mirror-push.test.ts` 的导入面不用动）。
 *
 * ## 边界
 *
 * 本文件只决定**话术与读数**，不决定退码：判类不改 `CODE.FAIL`，`--readout` 折的仍
 * 只是对外那一位退出码。egress 判据（`isEgressFailure`）与重试决策同源，放在这里是因为
 * `classifyLfsPushFailure` 要拿它判「对象传输或网络中断」这一类 —— 两处各写一份正则会漂成
 * 「话术说是 egress、重试却不认」的孪生形态。
 *
 * @module scripts/ci-mirror-failure-report — 镜像格的失败分类（egress / LFS）、收尾小结与派发形状落盘
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * egress 类失败的判据（TCP / DNS / 代理层，含本仓自己给的超时那一句）。
 *
 * 这一组判据有两个消费面，必须同源：`explainRemoteProbeFailure()` 拿它选话术，
 * `runGitWithRetry()` 拿它决定**值不值得再试一次** —— 两处各写一份正则，迟早漂成
 * 「话术说是 egress、重试却不认」的孪生形态。
 *
 * @param {string} text git 那一跳的 stdout + stderr（未脱敏）
 * @returns {boolean} true ⇒ 网络根本没到 GitHub，重试有意义
 */
export function isEgressFailure(text) {
  return /failed to connect|could not connect to server|couldn't connect to host|could not resolve host|connection reset|connection timed out|name resolution|getaddrinfo|empty reply from server|超时/i.test(
    text,
  );
}

/**
 * LFS 推送失败的**类别**（ISSUE #3106）：六个用户判得动的族 + 本次实测单独成档的那一形。
 *
 * 用户截图（`cnb-c92-1k6gk1ry00`）里的现场是 `exit status 1` + `Error getting local refs.`，
 * 旧话术把它归进「其他」并让人「看原话定下一动作」—— 人仍然判不出该动哪一层。所以每一类
 * 都有自己的 label 与 next（下一动作），label 进日志，next 进小结的结尾那一行。
 *
 * @type {{AUTH: string, EGRESS: string, LFS_DISABLED: string, LFS_MISSING: string, LOCAL_REFS: string, OTHER: string, QUOTA: string}}
 */
export const LFS_FAILURE_KINDS = {
  AUTH: "认证或权限",
  EGRESS: "对象传输或网络中断",
  LFS_DISABLED: "LFS 未启用或被禁用",
  LFS_MISSING: "git-lfs 未安装",
  LOCAL_REFS: "本地 ref 读取失败（检出形态）",
  OTHER: "其他",
  QUOTA: "配额或 Billing",
};

/**
 * 每一类的**短动作**（进小结最后一行；全文的 `next` 在它上面那一行）。
 *
 * 为什么单列一张：CNB UI 只显示最后 N 行，小结那一行必须一行读得完 —— 把 `next` 的长句
 * 整段塞进去，结尾那一行反而变成最难读的一行。
 *
 * @type {{AUTH: string, EGRESS: string, LFS_DISABLED: string, LFS_MISSING: string, LOCAL_REFS: string, OTHER: string, QUOTA: string}}
 */
export const LFS_FAILURE_SHORT_ACTIONS = {
  AUTH: "换/补 GITHUB_MIRROR_TOKEN 的写权（重试无用）",
  EGRESS: "出网问题在节点侧：查 DNS / 代理",
  LFS_DISABLED: "去仓库 Settings → Options 开 Git LFS",
  LFS_MISSING: "先在节点装 git-lfs",
  LOCAL_REFS: "已自动回退 --object-id 仍败：查检出形态；重试无用",
  OTHER: "看上一行 git-lfs 原话",
  QUOTA: "去 Settings → Billing 查配额 / 买 data pack",
};

/**
 * 把 `git lfs push` 的失败回话**判成类**，并给出该类专属的下一动作（文件头第 9 条）。
 *
 * 判的顺序按「最具体 → 最泛化」：`is not a git command` 先于一切（它同时带 `lfs` 字样）；
 * `Error getting local refs.` 是检出形态问题（不是网络、不是配额），必须先于 egress 与
 * 「未启用」两族；配额（402 族）先于认证；认证（401/403 族）先于「未启用」（404 族）。
 * **每一类都带原文错误行**（`evidence`：最后一条非空行，已按 {@link sanitize} 脱敏、截断
 * 160 字）。回话本身不判红 —— 退码仍由调用方按 `CODE.FAIL` 交账，本函数只决定话术。
 *
 * @param {string} text `git lfs push` 的 stdout + stderr（**已脱敏**）
 * @returns {{kind: string, label: string, next: string, short: string, evidence: string}}
 */
export function classifyLfsPushFailure(text) {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- 入参 text 是子进程原始输出（外部数据），运行期可为 undefined；规则按非空 string 标
  const raw = String(text ?? "");
  const lastLine = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1);
  const evidence = (lastLine ?? "").slice(0, 160);
  if (/is not a git command/i.test(raw)) {
    return {
      evidence,
      kind: "LFS_MISSING",
      label: LFS_FAILURE_KINDS.LFS_MISSING,
      short: LFS_FAILURE_SHORT_ACTIONS.LFS_MISSING,
      next: "这台 runner 上没有 git-lfs（`lfs` 不是可识别的子命令）⇒ 先在节点装 git-lfs；不装就是每条 PR 都红在这里，这一格不降级",
    };
  }
  if (/error getting local refs|unable to read local refs|could not get local refs/i.test(raw)) {
    return {
      evidence,
      kind: "LOCAL_REFS",
      label: LFS_FAILURE_KINDS.LOCAL_REFS,
      short: LFS_FAILURE_SHORT_ACTIONS.LOCAL_REFS,
      next: "git-lfs 在本次检出里枚举不到本地 refs（`Error getting local refs.`）⇒ 这是检出形态问题（平台合成的合并提交 / 工作区形态），不是网络也不是配额。镜像格**已自动回退**按 `git lfs push --object-id` 重推（清单取自 `git lfs ls-files --long`，按 index 取、不经 ref 解析）—— 走到这句说明回退也没成：先 `git rev-parse HEAD` + `git for-each-ref` 看这次检出的形态，再查回退那句的原话；重试不会变好",
    };
  }
  if (/\b402\b|quota|bandwidth|storage limit|data pack/i.test(raw)) {
    return {
      evidence,
      kind: "QUOTA",
      label: LFS_FAILURE_KINDS.QUOTA,
      short: LFS_FAILURE_SHORT_ACTIONS.QUOTA,
      next: "镜像仓的 LFS 配额撞墙（GitHub 免费档 1 GiB 存储 + 1 GiB/月带宽，每次 checkout 拉取都计带宽）⇒ 去仓库 Settings → Billing 看配额 / 买 data pack，与代码无关",
    };
  }
  if (
    /\b401\b|\b403\b|authentication failed|invalid username or token|could not read username|bad credentials|permission denied|not authorized/i.test(
      raw,
    )
  ) {
    return {
      evidence,
      kind: "AUTH",
      label: LFS_FAILURE_KINDS.AUTH,
      short: LFS_FAILURE_SHORT_ACTIONS.AUTH,
      next: "令牌被拒或没有这个仓库的写权（`Authentication failed` / 403 这一族）⇒ 换/补 `GITHUB_MIRROR_TOKEN` 的 `contents:write` 与仓库访问范围；权限类重试不会变好",
    };
  }
  if (
    /repository or object not found|repository not found|lfs.{0,24}(?:not enabled|disabled|not supported)|\b404\b/i.test(
      raw,
    )
  ) {
    return {
      evidence,
      kind: "LFS_DISABLED",
      label: LFS_FAILURE_KINDS.LFS_DISABLED,
      short: LFS_FAILURE_SHORT_ACTIONS.LFS_DISABLED,
      next: "镜像仓的 LFS 端点没开（或以这枚令牌的身份够不到它）⇒ 公开仓默认启用；私有仓去 Settings → Options 开 Git LFS，再重跑这一格",
    };
  }
  if (isEgressFailure(raw)) {
    return {
      evidence,
      kind: "EGRESS",
      label: LFS_FAILURE_KINDS.EGRESS,
      short: LFS_FAILURE_SHORT_ACTIONS.EGRESS,
      next: "到 github.com 这一跳没通（TCP / DNS / 代理层，重试已耗尽）⇒ 出网问题在节点侧，与令牌值和这一格的判据都无关",
    };
  }
  return {
    evidence,
    kind: "OTHER",
    label: LFS_FAILURE_KINDS.OTHER,
    short: LFS_FAILURE_SHORT_ACTIONS.OTHER,
    next: "LFS 对象推送被拒（不属于 egress / 未安装 / 认证 / 配额 / 未启用 / 本地 ref 六族）⇒ 看上面 git-lfs 的原话定下一动作，这一格不降级",
  };
}

/**
 * 兼容入口：旧调用点只想要「一句话术」。现在它由 {@link classifyLfsPushFailure} 派生 ——
 * 同一份判据不许写第二遍（§12.12）。
 *
 * @param {string} text `git lfs push` 的 stdout + stderr（已脱敏）
 * @returns {string} `类别=…；<下一动作>`
 */
export function explainLfsPushFailure(text) {
  const failure = classifyLfsPushFailure(text);
  return `类别=${failure.label}；${failure.next}`;
}

/**
 * 从 git-lfs 的输出里读「对象数」（有成对计数时给 `n/m`，读不到给 `null`）。
 *
 * git-lfs 真正上传时会打 `Uploading LFS objects: 100% (3/3), 8.6 MB | …`；失败发生在
 * 对象上传**之前**（本次实测那一形）时没有这一行 —— 那一档如实写「未读到」，不编数字。
 *
 * @param {string} text `git lfs push` 的 stdout + stderr
 * @returns {string | null} 形如 `3/3`，或 `null`
 */
export function parseLfsObjectCount(text) {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- 入参 text 是子进程原始输出（外部数据），运行期可为 undefined；规则按非空 string 标
  const m = /Uploading LFS objects:.{0,40}?\((?<done>\d+)\/(?<total>\d+)\)/i.exec(
    String(text ?? ""),
  );
  return m ? `${m.groups?.done}/${m.groups?.total}` : null;
}

/**
 * 收尾小结的入参（去掉 `prefix` / `readout` —— 那两项由各档的 `summarize` 闭包自己给）。
 *
 * @typedef {Omit<Parameters<typeof renderMirrorSummary>[0], "prefix" | "readout">} MirrorSummaryFields
 */

/**
 * 镜像格收尾的**结构化小结**（ISSUE #3106）：wire 推送 / LFS / 派发三件结论并排一句。
 *
 * 为什么放在结尾（用户第 5 条）：CNB 的构建日志 UI 只显示最后 N 行 —— 这一句必须是
 * 最后一行，人才不必翻页。`readout` 档把「不影响流水线结论」写进同一行，**不吞失败原因**：
 * 类别与下一动作照旧在小结里，折的只是对外那一位退出码。
 *
 * @param {object} v
 * @param {string} v.prefix `mirror` 或 `mirror-master`
 * @param {string} v.wire wire 推送那一跳的结论（`通（…）` / `败（exit N）` / `没跑（…）`）
 * @param {boolean | null} v.lfs LFS 那一跳：`true` 通 / `false` 败 / `null` 没跑
 * @param {{label: string, short: string, next: string} | null} [v.failure] LFS 失败那一类（`lfs === false` 时必给）
 * @param {string | null} [v.objects] 对象数（`n/m` 或 `null`）
 * @param {number} [v.elapsedMs] LFS 那一跳的墙钟（毫秒）
 * @param {number} [v.retries] LFS 那一跳消耗的重试次数
 * @param {string | null} [v.dispatch] 派发那一跳的结论（master 档没有这一跳 ⇒ `null`）
 * @param {boolean} [v.readout] 读数档
 * @returns {string} 一行 Markdown/纯文本小结
 */
export function renderMirrorSummary({
  dispatch = null,
  elapsedMs = 0,
  failure = null,
  lfs = null,
  objects = null,
  prefix,
  readout = false,
  retries = 0,
  wire,
}) {
  const label = readout ? "读数档：不影响流水线结论" : "判决";
  const lfsText =
    lfs === null
      ? "没跑（wire 没通，还没到这一跳）"
      : lfs
        ? "通"
        : `败（类别：${failure?.label ?? LFS_FAILURE_KINDS.OTHER}）`;
  const next =
    lfs === null
      ? "先让 wire 那一跳通过，LFS 与派发才有对象"
      : lfs
        ? "无需（对象已送过去）"
        : (failure?.short ?? LFS_FAILURE_SHORT_ACTIONS.OTHER);
  const parts = [
    `wire=${wire}`,
    `LFS=${lfsText}`,
    `对象数=${objects ?? "未读到"}`,
    `耗时=${(elapsedMs / 1000).toFixed(1)}s`,
    `重试=${String(retries)} 次`,
    ...(dispatch === null ? [] : [`派发=${dispatch}`]),
    `下一步=${next}`,
  ];
  return `[${prefix}] 小结（${label}）：${parts.join("｜")}`;
}

/**
 * 上游派发形状的落盘根（ISSUE #3148）：**同一工作区上的下一格**（`GitHub 判决回读`）
 * 靠它知道「这一跑的派发到底发生没发生」。
 *
 * 为什么要有这一跳：镜像格与回读格隔着二十多格、几个小时地跑在主列的两端，而回读格
 * 一直在拿 API 猜「GitHub 侧起跑没有」—— 它猜的那件事，**上游自己已经知道答案**。
 * 派发失败（推送 / LFS / 派发任意一跳）时本跑永远不会有 run，回读格照样把 45m
 * 轮询预算花完（#3138 的现场：用户看到的就是「GitHub 那边没 action，CNB 这边死等」）。
 *
 * 落在工作区的 `.comfy-ci/` 下（不是 `log/`：这一族是**给下一格的输入**，不是给人翻的日志；
 * 位置相对检出根、跨 step 稳定，且不影响任何产物）。
 */
export const DISPATCH_STATE_DIR = ".comfy-ci";
export const DISPATCH_STATE_FILE = "mirror-dispatch.json";

/**
 * 把本跑的派发形状写成一行 JSON 留给回读格（写失败不改变本格的三态 —— 落盘是**增益**，
 * 不是判据；拿不到它时回读格退回「自己猜」的老行为）。
 *
 * @param {(file: string, data: string) => void} writeFileSync 注入面（用例不落真文件）
 * @param {string} root 检出根
 * @param {{dispatched: boolean, reason: string}} state 这一跳的结论
 * @returns {void}
 */
export function writeDispatchState(writeFileSync, root, state) {
  try {
    mkdirSync(path.join(root, DISPATCH_STATE_DIR), { recursive: true });
    writeFileSync(
      path.join(root, DISPATCH_STATE_DIR, DISPATCH_STATE_FILE),
      `${JSON.stringify({ ...state, at: new Date().toISOString() })}\n`,
    );
  } catch {
    /* 落盘失败只影响「回读格能不能提前收工」，不许把这一格自己判红。 */
  }
}
