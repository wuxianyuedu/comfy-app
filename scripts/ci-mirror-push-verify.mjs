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
import { isRetryableFetchFailure } from "./ci-mirror-failure-report.mjs";
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
 * 推送后核对 LFS 对象在远端**可下载**（不是看 `git lfs push` 的退出码）。
 *
 * 用 LFS batch API 的 `download` 操作：对每个本地指针 OID，远端回 `actions.download` 即
 * 「在」；带 `error`（GitHub 对缺失对象回 404 族）即「不在」。批量一次问完。
 *
 * 与推送链其余三跳同一纪律：**网络层异常（`fetch failed` / `cause.code` 上的 `E*`）
 * 与远端 5xx 才消耗重试**（墙钟预算 `VERIFY_RETRY_BUDGET_MS` + 退避阶梯表），
 * 认证 / 权限（4xx）、回话对不上、对象确实缺失（有事实的 FAIL）一律一次交账 ——
 * 重试权限问题只会把真问题拖慢，还把「令牌缺 scope」读成「网络不好」。
 * 这一跳是推送链上的**第四跳**，此前裸 `fetch` 单次即弃：wire/LFS 都推成功了，
 * 却因最后一次核对的网络抖动把整跑判挂（PR #3398 第二跑、
 * `cnb-1t1-1k6tbm25q` 的 `TypeError: fetch failed`）。重试读数进日志，
 * 别把「重试过了」读成「一次就过」。
 *
 * @param {object} deps
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} deps.fetchImpl HTTP 执行面
 * @param {(line: string) => void} deps.log 输出通道
 * @param {number} [deps.maxAttempts] 尝试上限覆盖：托管机实验的 once 档传 1；缺省 {@link VERIFY_MAX_ATTEMPTS}
 * @param {() => number} [deps.now] 墙钟注入点
 * @param {string} deps.prefix 行前缀
 * @param {(args: string[]) => {code: number, stderr: string, stdout: string}} deps.runGit 执行者
 * @param {string} deps.repo 镜像仓库坐标（`owner/repo`）
 * @param {(ms: number) => Promise<void>} [deps.sleep] 退避（缺省真退避；用例注入假件）
 * @param {string} deps.token 镜像令牌
 * @returns {Promise<{code: number, missing: string[], note: string, objects: number, objectsText: string}>}
 */
export async function verifyLfsObjects(deps) {
  const {
    fetchImpl,
    log,
    maxAttempts: attemptsCap = VERIFY_MAX_ATTEMPTS,
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
      code: CODE.NO_FACT,
      missing: [],
      note: "读不到本地 LFS 指针清单 ⇒ 没结论",
      objects: 0,
      objectsText: "0/0",
    };
  }
  const parsed = parseLfsObjects(list.stdout);
  if (parsed.error !== "") {
    return { code: CODE.NO_FACT, missing: [], note: parsed.error, objects: 0, objectsText: "0/0" };
  }
  if (parsed.objects.length === 0) {
    return {
      code: CODE.OK,
      missing: [],
      note: "0 个 LFS 对象，无需核对",
      objects: 0,
      objectsText: "0/0",
    };
  }
  const auth = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  const request = () =>
    fetchImpl(`https://github.com/${repo}.git/info/lfs/objects/batch`, {
      body: JSON.stringify({
        objects: parsed.objects,
        operation: "download",
        transfers: ["basic"],
      }),
      headers: {
        Accept: "application/vnd.git-lfs+json",
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/vnd.git-lfs+json",
        "User-Agent": "comfy-app-cnb-mirror",
      },
      method: "POST",
      signal: AbortSignal.timeout(REMOTE_READ_TIMEOUT_MS),
    });
  /** 这一跳还剩多少预算；到点就不再发起，按最后一次的结果交账。 */
  const startedAt = now();
  const remaining = () => VERIFY_RETRY_BUDGET_MS - (now() - startedAt);
  /** 最后一次真正拿到的 HTTP 应答；整档全抛网络异常时保持 null。 */
  let res = null;
  /** 最后一次「没通」的读数（网络异常原话 / 远端 5xx 状态码），只进日志。 */
  let lastFailure = "";
  let attempts = 0;
  for (let attempt = 1; attempt <= attemptsCap; attempt += 1) {
    attempts = attempt;
    /** 这一发值不值得再来一次：只有网络层异常与远端 5xx 为真。 */
    let retryable;
    try {
      // oxlint-disable-next-line no-await-in-loop -- 脚本按步串行（命令行/进程编排），并行会打乱启动与回收顺序
      res = await request();
      /* 到了 GitHub、服务端自己给了一记瞬时错（5xx）⇒ 换一次请求就可能成。
       * 200 / 4xx（认证 / 权限 / 配额）/ 其余非 5xx 一律不重试，按现有结果交账。 */
      retryable = res.status >= 500 && res.status < 600;
      if (retryable) {
        lastFailure = `HTTP ${String(res.status)}`;
      }
    } catch (error) {
      res = null;
      lastFailure = String(error);
      /* 只有网络层异常（`fetch failed` / `cause.code` 上的 `E*` / egress 文本族）才重试。 */
      retryable = isRetryableFetchFailure(error);
    }
    if (!retryable || attempt === attemptsCap) {
      break;
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- 下标越界时运行时为 undefined（未开 noUncheckedIndexedAccess）
    const wait = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS.at(-1) ?? 5000;
    const left = remaining() - wait;
    if (left < RETRY_MIN_ATTEMPT_MS) {
      log(
        `[${prefix}] LFS 核对重试预算用尽：已试 ${String(attempt)} 次（预算 ${String(VERIFY_RETRY_BUDGET_MS / 1000)}s，低于一次尝试的 ${String(RETRY_MIN_ATTEMPT_MS / 1000)}s 就不再发起）⇒ 按最后一次结果交账`,
      );
      break;
    }
    log(
      `[${prefix}] LFS 核对第 ${String(attempt)}/${String(attemptsCap)} 次没通（${lastFailure}）⇒ ${String(wait / 1000)}s 后试第 ${String(attempt + 1)} 次（网络抖动 / 远端 5xx 重试；认证 / 权限类不重试）`,
    );
    // oxlint-disable-next-line no-await-in-loop -- 脚本按步串行（命令行/进程编排），并行会打乱启动与回收顺序
    await sleep(wait);
  }
  if (res === null) {
    return {
      code: CODE.NO_FACT,
      missing: [],
      note: `LFS 核对请求没跑起来（网络层${attempts > 1 ? `，已试 ${String(attempts)} 次` : ""}）：${lastFailure}`,
      objects: parsed.objects.length,
      objectsText: `未读到/${String(parsed.objects.length)}`,
    };
  }
  if (res.status !== 200) {
    return {
      code: CODE.NO_FACT,
      missing: [],
      note: `LFS 核对被拒：HTTP ${String(res.status)} ⇒ 没结论`,
      objects: parsed.objects.length,
      objectsText: `未读到/${String(parsed.objects.length)}`,
    };
  }
  const body = await res.json().catch(() => null);
  const rows = body && typeof body === "object" ? body.objects : null;
  if (!Array.isArray(rows) || rows.length !== parsed.objects.length) {
    return {
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
      code: CODE.FAIL,
      missing,
      note: `${String(missing.length)}/${String(parsed.objects.length)} 个 LFS 对象远端拿不到（${shown}${missing.length > 3 ? " …" : ""}）`,
      objects: parsed.objects.length,
      objectsText: `${String(parsed.objects.length - missing.length)}/${String(parsed.objects.length)}`,
    };
  }
  return {
    code: CODE.OK,
    missing: [],
    note: `LFS 对象 ${String(parsed.objects.length)}/${String(parsed.objects.length)} 远端可下载`,
    objects: parsed.objects.length,
    objectsText: `${String(parsed.objects.length)}/${String(parsed.objects.length)}`,
  };
}
