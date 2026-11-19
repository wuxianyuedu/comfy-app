/**
 * 镜像格「推完之后的自证」：refs 回读 + LFS 对象存在性。
 *
 * 为什么不能只看命令退出码（ISSUE #3252 的现场）：
 *
 * · `git push` 退 0 只说明**这一次传输没报错**，不说明远端那条 ref 真的前进到了本次 HEAD
 *   （镜像仓被保护分支规则拦下、`--force` 落到别的 ref、远端 hook 拒绝……都可能在
 *   退出码之外留一句 warning 而仍退 0）；
 * · `git lfs push` 退 0 也不等于对象在远端可下载：LFS 对象是独立存储，指针推上去而对象
 *   缺一块时，GitHub 侧 checkout 照样会拿到指针文件 —— 那一格会是「假红」，且现场无从
 *   看出是对象没到。
 *
 * 两跳都按**远端事实**判：refs 用 `ls-remote` 回读完整 sha，LFS 用 batch API 的
 * `download` 操作逐个核对。退码沿用本仓三态：`0` 有结论且对、`1` 有事实是错、`2` 没读到
 * （回读本身没通，不等于通过）。
 *
 * 这里不 import 主文件（主文件反过来要 import 本模块）：执行面全部由调用方注入，
 * 与 `ci-mirror-lfs-push.mjs` 同一纪律。
 *
 * @module scripts/ci-mirror-push-verify — 推送后的 ref / LFS 自证
 */
import {
  REMOTE_READ_TIMEOUT_MS,
  RETRY_BACKOFF_MS,
  RETRY_MIN_ATTEMPT_MS,
  VERIFY_MAX_ATTEMPTS,
  VERIFY_RETRY_BUDGET_MS,
} from "./ci-mirror-retry-policy.mjs";

/** 三态退码（与主文件 `CODE` 同值；这里单独写一份是为了不造成循环 import）。 */
const CODE = { FAIL: 1, NO_FACT: 2, OK: 0 };

/**
 * 从 `git ls-remote` 的输出里取出**指定 ref** 的 sha。
 *
 * 只认「40 位十六进制 + 空白 + 逐字相同的 ref」这一形：`ls-remote` 不带 ref 参数时会把
 * 整棵 ref 列表打出来，按子串找会让 `refs/heads/master-old` 冒充 `refs/heads/master`。
 *
 * @param {string} stdout `git ls-remote <url> <ref>` 的标准输出
 * @param {string} ref 目标 ref 全名（`refs/heads/master` 这一形）
 * @returns {string | null} 找到就回完整 sha（小写），否则 null
 */
export function parseRemoteRefSha(stdout, ref) {
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      continue;
    }
    const [sha, name] = line.split(/\s+/);
    if (typeof sha === "string" && typeof name === "string" && name === ref) {
      return sha.toLowerCase();
    }
  }
  return null;
}

/**
 * 推送后回读 ref：要求远端那条 ref 的 sha **逐字等于**本次 HEAD。
 *
 * @param {object} deps
 * @param {string} deps.headSha 本次推的 HEAD（完整 40 位）
 * @param {(line: string) => void} deps.log 输出通道
 * @param {number} [deps.maxAttempts] 尝试上限覆盖：托管机实验的 once 档传 1（ISSUE #3346，
 *   三跳各只试一次）；缺省 {@link VERIFY_MAX_ATTEMPTS}
 * @param {string} deps.prefix 行前缀（`mirror` / `mirror-master`）
 * @param {string} deps.ref 目标 ref 全名
 * @param {(args: string[]) => {code: number, stderr: string, stdout: string}} deps.runGit 执行者
 * @param {typeof import("./ci-github-mirror-push.mjs").runGitWithRetry} deps.runGitWithRetry 带重试的一跳
 * @param {(text: string, token: string) => string} deps.sanitize 脱敏
 * @param {(ms: number) => Promise<void>} deps.sleep 退避
 * @param {string} deps.token 镜像令牌（只用于脱敏）
 * @param {string} deps.url 带凭据的推送 URL
 * @param {() => number} [deps.now] 墙钟注入点
 * @returns {Promise<{attempts: number, code: number, note: string, remoteSha: string | null}>}
 */
export async function verifyPushedRef(deps) {
  const {
    headSha,
    log,
    maxAttempts: attemptsCap = VERIFY_MAX_ATTEMPTS,
    now,
    prefix,
    ref,
    runGit,
    runGitWithRetry,
    sanitize,
    sleep,
    token,
    url,
  } = deps;
  const read = await runGitWithRetry(["ls-remote", url, ref], {
    budgetMs: VERIFY_RETRY_BUDGET_MS,
    label: "推送后回读",
    log,
    maxAttempts: attemptsCap,
    now,
    prefix,
    runGit,
    sleep,
  });
  if (read.code !== 0) {
    const text = sanitize(`${read.stdout}\n${read.stderr}`, token);
    for (const line of text.split("\n")) {
      if (line.trim()) {
        log(`[${prefix}]   ${line}`);
      }
    }
    return {
      attempts: read.attempts,
      code: CODE.NO_FACT,
      note: `回读没通（exit ${String(read.code)}）⇒ 远端到没到没结论`,
      remoteSha: null,
    };
  }
  const remoteSha = parseRemoteRefSha(read.stdout, ref);
  if (remoteSha === null) {
    return {
      attempts: read.attempts,
      code: CODE.FAIL,
      note: `远端没有 ${ref}（推了但没到位）`,
      remoteSha: null,
    };
  }
  if (remoteSha !== headSha.toLowerCase()) {
    return {
      attempts: read.attempts,
      code: CODE.FAIL,
      note: `回读不符：remote=${remoteSha} local=${headSha}`,
      remoteSha,
    };
  }
  return {
    attempts: read.attempts,
    code: CODE.OK,
    note: `回读一致（${ref} @ ${remoteSha.slice(0, 8)}）`,
    remoteSha,
  };
}

/**
 * 把 `git lfs ls-files --json` 的回话读成 batch 需要的 `{oid, size}` 列表。
 *
 * @param {string} stdout `git lfs ls-files --json` 的标准输出
 * @returns {{objects: Array<{oid: string, size: number}>, error: string}} 解析结果（`error` 非空即读不懂）
 */
export function parseLfsObjects(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { error: "lfs ls-files 的回话不是 JSON", objects: [] };
  }
  const files = parsed && typeof parsed === "object" ? parsed.files : null;
  if (!Array.isArray(files)) {
    return { error: "lfs ls-files 的回话里没有 files 数组", objects: [] };
  }
  /** @type {Array<{oid: string, size: number}>} */
  const objects = [];
  for (const file of files) {
    if (!file || typeof file !== "object") {
      continue;
    }
    const oid = typeof file.oid === "string" ? file.oid : "";
    const size = Number(file.size);
    if (!/^[0-9a-f]{64}$/i.test(oid) || !Number.isFinite(size) || size < 0) {
      return { error: `指针缺 oid/size：${String(file.name ?? "?")}`, objects: [] };
    }
    objects.push({ oid: oid.toLowerCase(), size });
  }
  return { error: "", objects };
}

/**
 * 发起一次 LFS batch 请求并读回 JSON —— 只做「这一跳有没有跑起来」的分流，不判业务。
 *
 * 分三形，是否值得重试由调用方按 kind / 状态码决定：
 *   · `network`：fetch 本身抛错（Node undici 的 `TypeError: fetch failed` 一族，
 *     现场 PR #3395 的 `egress 抖动`），或回话 body 没读全 ⇒ 瞬时，重试有意义；
 *   · `http`：拿到了 HTTP 应答但不是 200 —— 5xx 是远端瞬时错（重试有意义），
 *     4xx 是认证 / 权限 / 请求形状（「再试一百次也一样」，不重试）；
 *   · `ok`：200 且 body 是 JSON ⇒ 把解析结果交回调用方判对象在不在。
 *
 * 刻意不复用 `runGitWithRetry`：那一跳吃的是 git 子进程的 `{stdout, stderr}` 文本与
 * egress 正则，而这里是 `fetch` 的异常对象与 HTTP 状态码，判据面不同（§12.18：这一处
 * 独有的形态就地写，不把两种失败硬塞进同一个重试器）。
 *
 * @param {object} deps
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} deps.fetchImpl HTTP 执行面
 * @param {string} deps.repo 镜像仓库坐标
 * @param {Array<{oid: string, size: number}>} deps.objects 本地指针清单
 * @param {string} deps.token 镜像令牌
 * @returns {Promise<{kind: "network"|"http"|"ok", error?: unknown, status?: number, body?: unknown, note?: string}>}
 */
async function requestLfsBatch({ fetchImpl, objects, repo, token }) {
  const auth = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  let res;
  try {
    res = await fetchImpl(`https://github.com/${repo}.git/info/lfs/objects/batch`, {
      body: JSON.stringify({ objects, operation: "download", transfers: ["basic"] }),
      headers: {
        Accept: "application/vnd.git-lfs+json",
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/vnd.git-lfs+json",
        "User-Agent": "comfy-app-cnb-mirror",
      },
      method: "POST",
      signal: AbortSignal.timeout(REMOTE_READ_TIMEOUT_MS),
    });
  } catch (error) {
    return { error, kind: "network", note: `LFS 核对请求没跑起来（网络层）：${String(error)}` };
  }
  if (res.status !== 200) {
    return {
      kind: "http",
      note: `LFS 核对被拒：HTTP ${String(res.status)} ⇒ 没结论`,
      status: res.status,
    };
  }
  try {
    const body = await res.json();
    return { body, kind: "ok" };
  } catch (error) {
    return { error, kind: "network", note: `LFS 核对的回话没读全（网络层）：${String(error)}` };
  }
}

/**
 * @param {{kind: "network"|"http"|"ok", status?: number}} outcome 一次 batch 请求的分流结果
 * @returns {boolean} true ⇒ 瞬时失败（网络没跑起来 / 远端 5xx），值得再发一次
 */
function retryableBatchFailure(outcome) {
  return outcome.kind === "network" || (outcome.kind === "http" && (outcome.status ?? 0) >= 500);
}

/**
 * 推送后核对 LFS 对象在远端**可下载**（不是看 `git lfs push` 的退出码）。
 *
 * 用 LFS batch API 的 `download` 操作：对每个本地指针 OID，远端回 `actions.download` 即
 * 「在」；带 `error`（GitHub 对缺失对象回 404 族）即「不在」。批量一次问完。
 *
 * @param {object} deps
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} deps.fetchImpl HTTP 执行面
 * @param {(line: string) => void} deps.log 输出通道
 * @param {number} [deps.maxAttempts] 尝试上限（缺省 1 = 单次即弃；主文件按 `once ? 1 : VERIFY_MAX_ATTEMPTS` 注入）
 * @param {() => number} [deps.now] 墙钟注入点
 * @param {string} deps.prefix 行前缀
 * @param {(args: string[]) => {code: number, stderr: string, stdout: string}} deps.runGit 执行者
 * @param {string} deps.repo 镜像仓库坐标（`owner/repo`）
 * @param {(ms: number) => Promise<void>} [deps.sleep] 退避注入点
 * @param {string} deps.token 镜像令牌
 * @returns {Promise<{attempts: number, code: number, missing: string[], note: string, objects: number, objectsText: string}>}
 */
export async function verifyLfsObjects(deps) {
  const {
    fetchImpl,
    log,
    maxAttempts: attemptsCap = 1,
    now = Date.now,
    prefix,
    repo,
    runGit,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    token,
  } = deps;
  /* `-c core.quotePath=false`：`--json` 的 `name` 是路径，转义过的读不出原样
   * （ISSUE #2272）；与 `ci-mirror-lfs-push.mjs` 的 `--long` 同口径。 */
  const list = runGit(["-c", "core.quotePath=false", "lfs", "ls-files", "--json"]);
  if (list.code !== 0) {
    log(`[${prefix}]   ${String(list.stderr ?? "").trim()}`);
    return {
      attempts: 1,
      code: CODE.NO_FACT,
      missing: [],
      note: "读不到本地 LFS 指针清单 ⇒ 没结论",
      objects: 0,
      objectsText: "0/0",
    };
  }
  const parsed = parseLfsObjects(list.stdout);
  if (parsed.error !== "") {
    return {
      attempts: 1,
      code: CODE.NO_FACT,
      missing: [],
      note: parsed.error,
      objects: 0,
      objectsText: "0/0",
    };
  }
  if (parsed.objects.length === 0) {
    return {
      attempts: 1,
      code: CODE.OK,
      missing: [],
      note: "0 个 LFS 对象，无需核对",
      objects: 0,
      objectsText: "0/0",
    };
  }
  /* batch 那一跳的网络重试（现场 PR #3395 / ISSUE #3400）：wire 与 LFS 推送都已经通了，
   * 却因最后一次核对的 `TypeError: fetch failed` 单次即退 2、把整格判挂。与
   * `verifyPushedRef` 同口径：只重试瞬时（网络层 / 远端 5xx），认证 4xx 与回话事实一次交账；
   * 预算 / 次数 / 退避都取 retry-policy 的同一组数，不另立一套。`maxAttempts=1` 时整段退化成
   * 原来的单次调用（现有直接调用与 `--once` 托管机实验档逐字保持）。 */
  /** @type {(note: string, attempts: number) => {attempts: number, code: number, missing: string[], note: string, objects: number, objectsText: string}} */
  const noFact = (note, attempts) => ({
    attempts,
    code: CODE.NO_FACT,
    missing: [],
    note,
    objects: parsed.objects.length,
    objectsText: `未读到/${String(parsed.objects.length)}`,
  });
  const startedAt = now();
  const remaining = () => VERIFY_RETRY_BUDGET_MS - (now() - startedAt);
  let attempts = 1;
  let outcome = await requestLfsBatch({ fetchImpl, objects: parsed.objects, repo, token });
  for (let attempt = 2; attempt <= attemptsCap && retryableBatchFailure(outcome); attempt += 1) {
    const wait = RETRY_BACKOFF_MS[attempt - 2] ?? RETRY_BACKOFF_MS.at(-1) ?? 5000;
    if (remaining() - wait < RETRY_MIN_ATTEMPT_MS) {
      log(
        `[${prefix}] LFS 核对重试预算用尽：已试 ${String(attempt - 1)} 次、耗 ${String(Math.round((now() - startedAt) / 1000))}s ⇒ 按最后一次结果交账`,
      );
      break;
    }
    log(
      `[${prefix}] LFS 核对第 ${String(attempt - 1)}/${String(attemptsCap)} 次没通（${outcome.note ?? "瞬时失败"}）⇒ ${String(wait / 1000)}s 后试第 ${String(attempt)} 次（网络抖动 / 远端 5xx 重试；认证 / 权限类不重试）`,
    );
    // oxlint-disable-next-line no-await-in-loop -- 镜像格按跳串行；并发重试会打乱推送 / 派发顺序
    await sleep(wait);
    attempts = attempt;
    // oxlint-disable-next-line no-await-in-loop -- 镜像格按跳串行：上一次请求没交账前不许发下一发（并发重试会打乱推送 / 派发顺序）
    outcome = await requestLfsBatch({ fetchImpl, objects: parsed.objects, repo, token });
  }
  if (outcome.kind === "network") {
    return noFact(outcome.note ?? "LFS 核对请求没跑起来（网络层）", attempts);
  }
  if (outcome.kind === "http") {
    return noFact(
      outcome.note ?? `LFS 核对被拒：HTTP ${String(outcome.status)} ⇒ 没结论`,
      attempts,
    );
  }
  /** @type {unknown} */
  const body = outcome.body;
  /** @type {{objects?: unknown} | null} */
  const record =
    body && typeof body === "object" ? /** @type {{objects?: unknown}} */ (body) : null;
  const rows = record && Array.isArray(record.objects) ? record.objects : null;
  if (!Array.isArray(rows) || rows.length !== parsed.objects.length) {
    return {
      attempts,
      code: CODE.NO_FACT,
      missing: [],
      note: "LFS 核对的回话对不上（对象数不一致）⇒ 没结论",
      objects: parsed.objects.length,
      objectsText: `未读到/${String(parsed.objects.length)}`,
    };
  }
  const missing = [];
  for (const row of rows) {
    const record = row && typeof row === "object" ? row : null;
    const oid = record && typeof record.oid === "string" ? record.oid : "";
    const hasError = record !== null && record.error !== null && record.error !== undefined;
    const hasDownload =
      record !== null &&
      record.actions &&
      typeof record.actions === "object" &&
      Boolean(record.actions.download);
    if (hasError || !hasDownload) {
      missing.push(oid === "" ? "(oid 未回)" : oid);
    }
  }
  if (missing.length > 0) {
    const shown = missing.slice(0, 3).join(", ");
    return {
      attempts,
      code: CODE.FAIL,
      missing,
      note: `${String(missing.length)}/${String(parsed.objects.length)} 个 LFS 对象远端拿不到（${shown}${missing.length > 3 ? " …" : ""}）`,
      objects: parsed.objects.length,
      objectsText: `${String(parsed.objects.length - missing.length)}/${String(parsed.objects.length)}`,
    };
  }
  return {
    attempts,
    code: CODE.OK,
    missing: [],
    note: `LFS 对象 ${String(parsed.objects.length)}/${String(parsed.objects.length)} 远端可下载`,
    objects: parsed.objects.length,
    objectsText: `${String(parsed.objects.length)}/${String(parsed.objects.length)}`,
  };
}
