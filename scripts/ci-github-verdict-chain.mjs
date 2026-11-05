/**
 * 「GitHub 判决回读」的**结构判定**层（ISSUE #3153）——从 `ci-github-verdict-read.mjs`
 * 按职责拆出来的一格：主回读脚本管轮询与三态，这里只管「零条 run 时，run 还能不能来」。
 *
 * ## 为什么要有这一层
 *
 * 触发表零条 run 有两种形状，旧读数把它们压在一起：
 *
 * 1. **真·排队**：派发已发生，run 随时可能起跑 —— 应该等；
 * 2. **结构上不会有 run**：仓库改名 / 迁移 / 配错、`pr-gate.yml` 被删或禁用、事件条件
 *    不再监听 `repository_dispatch` —— 等也等不来。
 *
 * 这一层只读**正证据**（仓库身份 / workflow 清单 / 默认分支上的 workflow 文件），任一
 * 证据明确为「不会」就当场收工；读不到只记「未知」，不据此判死 —— 把「迟到」误判成
 * 「没有」比多等 5 分钟贵。
 *
 * ## 边界
 *
 * - **不判「红」**：这里只回答「有没有 run」，退出码统一 exit 2（没结论）。
 * - **不改 45m 语义**：45m 只服务「确实读到本跑、但 `status` 还没 completed」那一形；
 *   零条 run / 上游派发读数缺失走 {@link NO_RUN_WINDOW_MS}（5 分钟）。
 * - **分支过滤只记录**：GitHub 对 `repository_dispatch` 不应用 `branches` / `branches-ignore`
 *   （只有 `push` / `pull_request` 支持），所以读出什么都不判「不会有 run」，只进读数。
 * - **判定只探一次**：调用方缓存读数；每次请求带自己的重试与超时。
 */
import { CODE } from "./ci-github-mirror-push.mjs";

/**
 * 零条 run / 上游派发读数缺失时的**短窗口**：5 分钟（ISSUE #3153）。
 *
 * 取 5 分钟的理由：这一形要么「run 根本不会来」（结构判定已排除 / 判不出），要么是
 * 「已经排队、只是还没建」。后者实测以分钟计 —— 4 分钟的迟到用例钉在
 * `tests/ci-github-verdict-read.test.ts` 里，所以窗口必须大于 4 分钟；再多就只是把 45m
 * 的墙钟换个名字。45m 只留给「确实读到本跑、`status` 还没 completed」那一形。
 */
export const NO_RUN_WINDOW_MS = 5 * 60_000;

/**
 * 一次读数的最小形状（`ci-github-verdict-read.mjs` 的 `requestJson` 回话）。
 *
 * @typedef {{
 *   body?: unknown,
 *   kind?: "auth" | "egress" | "http",
 *   ok: boolean,
 *   status?: number,
 * }} JsonRead
 */

/**
 * 仓库身份读数 URL（结构证据之一：`owner/repo` 是否可查）。
 *
 * @param {string} repo `owner/repo`
 * @returns {string} API URL
 */
export function repoUrl(repo) {
  return `https://api.github.com/repos/${repo}`;
}

/**
 * workflow 清单 URL（`pr-gate.yml` 是否还在、是否被禁用）。
 *
 * @param {string} repo `owner/repo`
 * @returns {string} API URL
 */
export function workflowsUrl(repo) {
  return `https://api.github.com/repos/${repo}/actions/workflows?per_page=100`;
}

/**
 * workflow 文件内容 URL（默认分支上的 `pr-gate.yml` 是否还监听 `repository_dispatch`）。
 *
 * `ref` 用仓库 API 给的 `default_branch` —— dispatch 触发的 run 读的就是默认分支上的
 * 那份 workflow。
 *
 * @param {string} repo `owner/repo`
 * @param {string} ref 默认分支名
 * @returns {string} API URL
 */
export function workflowFileUrl(repo, ref) {
  return `https://api.github.com/repos/${repo}/contents/.github/workflows/pr-gate.yml?ref=${encodeURIComponent(ref)}`;
}

/**
 * 从 `pr-gate.yml` 正文里读 `repository_dispatch` 下的 `branches:` 过滤。
 *
 * ⚠️ GitHub 对 `repository_dispatch` **不应用** `branches` / `branches-ignore`（只有
 * `push` / `pull_request` 支持）—— 所以这里读出什么都不判「不会有 run」，只作为读数
 * 记录。真过滤在事件条件那一层（`repository_dispatch` 是否存在）。
 *
 * @param {string} text workflow 文件正文
 * @returns {Array<string> | null} 检测到的分支列表；`null` = 没有 branches 过滤
 */
export function dispatchBranchFilter(text) {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^\s*repository_dispatch:\s*$/u.test(line));
  if (start === -1) {
    return null;
  }
  const baseIndent = ((lines[start] ?? "").match(/^\s*/u)?.[0] ?? "").length;
  /** @type {Array<string>} */
  const branches = [];
  let inBranches = false;
  let branchesIndent = 0;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      continue;
    }
    const indent = (line.match(/^\s*/u)?.[0] ?? "").length;
    if (indent <= baseIndent) {
      break;
    }
    if (!inBranches) {
      const head = line.match(/^\s*branches:\s*(?<inline>.*)$/u);
      if (head) {
        const inline = (head.groups?.inline ?? "").trim();
        if (inline.startsWith("[") && inline.endsWith("]")) {
          for (const item of inline.slice(1, -1).split(",")) {
            const branch = item.trim().replaceAll(/^["']|["']$/gu, "");
            if (branch !== "") {
              branches.push(branch);
            }
          }
          inBranches = true;
          branchesIndent = indent;
        } else {
          inBranches = true;
          branchesIndent = indent;
        }
      }
      continue;
    }
    if (indent <= branchesIndent) {
      inBranches = false;
      continue;
    }
    const item = line.match(/^\s*-\s*(?<branch>.+)$/u);
    if (item) {
      const branch = (item.groups?.branch ?? "").trim().replaceAll(/^["']|["']$/gu, "");
      if (branch !== "") {
        branches.push(branch);
      }
    }
  }
  return inBranches || branches.length > 0 ? branches : null;
}

/**
 * @typedef {{
 *   branchFilter: Array<string> | null,
 *   defaultBranch: string,
 *   event: "missing" | "ok" | "unknown",
 *   note: string,
 *   repo: "missing" | "ok" | "unknown",
 *   structural: string,
 *   workflow: "disabled" | "missing" | "ok" | "unknown",
 *   workflowPath: string,
 *   workflowState: string,
 * }} DispatchChain
 */

/**
 * 零条 run 时的一次**结构判定**：本跑到底还能不能等到 run？
 *
 * 只读三件**正证据**，任何一条明确为「不会」就当场收工 —— 不靠猜时间：
 *   1. 仓库身份：`GET /repos/{owner/repo}` 404 ⇒ 改名 / 迁移 / 删了 / 配错；
 *   2. workflow：清单里 `.github/workflows/pr-gate.yml` 不存在 ⇒ 被删；`state` 不是
 *      `active` ⇒ 被禁用；
 *   3. 事件条件：默认分支上的那份 `pr-gate.yml` 里没有 `repository_dispatch` ⇒ 派发
 *      也触发不了。
 * 读不到（403 / egress / 形状不对）只记「未知」，不据此判死。
 *
 * @param {(url: string, label: string) => Promise<JsonRead>} readJson 带重试/超时的请求面
 * @param {{repo: string}} ctx 上下文（只需要 `repo`）
 * @returns {Promise<DispatchChain>} 结构判定读数
 */
export async function probeDispatchChain(readJson, ctx) {
  /** @type {DispatchChain} */
  const out = {
    branchFilter: null,
    defaultBranch: "",
    event: "unknown",
    note: "",
    repo: "unknown",
    structural: "",
    workflow: "unknown",
    workflowPath: ".github/workflows/pr-gate.yml",
    workflowState: "",
  };
  /** @type {Array<string>} */
  const notes = [];
  const repoRead = await readJson(repoUrl(ctx.repo), "仓库身份");
  const repoStatus = repoRead.status ?? 0;
  if (!repoRead.ok && repoRead.kind === "http" && repoStatus === 404) {
    out.repo = "missing";
    out.structural = `仓库 ${ctx.repo} 认不到（HTTP 404：改名 / 迁移 / 删除，或 owner/repo 配错）`;
    out.note = `仓库身份：${ctx.repo} → HTTP 404（认不到）`;
    return out;
  }
  if (repoRead.ok) {
    out.repo = "ok";
    const body = /** @type {{default_branch?: unknown}} */ (repoRead.body);
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- body 是 API 回话 JSON，运行时可缺/为 null，断言不承重
    out.defaultBranch = String(body?.default_branch ?? "");
    notes.push(`仓库身份：${ctx.repo} 可查（默认分支 ${out.defaultBranch || "?"}）`);
  } else {
    notes.push(`仓库身份：${ctx.repo} → 读不到（上层 HTTP / egress），按未知处理`);
  }

  const wfRead = await readJson(workflowsUrl(ctx.repo), "workflow 清单");
  if (wfRead.ok) {
    const body = /** @type {{workflows?: unknown}} */ (wfRead.body);
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- body 是 API 回话 JSON，运行时可缺/为 null，断言不承重
    const list = Array.isArray(body?.workflows) ? body.workflows : [];
    const found = list.find((item) => {
      const wf = /** @type {{path?: unknown}} */ (item);
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- item 是 API 回话里的 unknown 条目，断言不承重
      return String(wf?.path ?? "").endsWith("/pr-gate.yml");
    });
    if (found === undefined) {
      out.workflow = "missing";
      out.structural = `GitHub 侧没有 ${out.workflowPath}（workflow 被删或从未建）`;
      notes.push(`workflow 清单：没有 ${out.workflowPath}`);
    } else {
      const wf = /** @type {{path?: unknown, state?: unknown}} */ (found);
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- item 是 API 回话里的 unknown 条目，断言不承重
      out.workflowPath = String(wf?.path ?? out.workflowPath);
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- 同上
      out.workflowState = String(wf?.state ?? "");
      if (out.workflowState === "active") {
        out.workflow = "ok";
        notes.push(`workflow 清单：${out.workflowPath} state=active`);
      } else {
        out.workflow = "disabled";
        out.structural = `workflow ${out.workflowPath} state=${out.workflowState || "?"}（被禁用，派发触发的 run 不会起跑）`;
        notes.push(`workflow 清单：${out.workflowPath} state=${out.workflowState || "?"}`);
      }
    }
  } else {
    notes.push("workflow 清单：读不到，按未知处理");
  }

  if (
    out.repo === "ok" &&
    out.workflow === "ok" &&
    out.defaultBranch !== "" &&
    out.structural === ""
  ) {
    const fileRead = await readJson(workflowFileUrl(ctx.repo, out.defaultBranch), "workflow 文件");
    const fileStatus = fileRead.status ?? 0;
    if (fileRead.ok) {
      const body = /** @type {{content?: unknown, encoding?: unknown}} */ (fileRead.body);
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- body 是 API 回话 JSON，运行时可缺/为 null，断言不承重
      const raw = String(body?.content ?? "");
      const text = raw === "" ? "" : Buffer.from(raw, "base64").toString("utf8");
      if (/\brepository_dispatch\b/u.test(text)) {
        out.event = "ok";
        out.branchFilter = dispatchBranchFilter(text);
        const filter =
          out.branchFilter === null
            ? "无（repository_dispatch 不支持 branches 过滤）"
            : `检测到 branches [${out.branchFilter.join(", ")}]（GitHub 对 repository_dispatch 不应用该过滤，仅记录）`;
        notes.push(`事件条件：repository_dispatch 在；分支过滤：${filter}`);
      } else {
        out.event = "missing";
        out.structural = `${out.workflowPath} 的 on: 里没有 repository_dispatch（事件触发条件变了，派发不会建 run）`;
        notes.push(`事件条件：${out.workflowPath} 没有 repository_dispatch`);
      }
    } else if (fileRead.kind === "http" && fileStatus === 404) {
      out.event = "missing";
      out.structural = `默认分支 ${out.defaultBranch} 上没有 ${out.workflowPath}（workflow 文件被删）`;
      notes.push(`事件条件：默认分支 ${out.defaultBranch} 上没有 ${out.workflowPath}`);
    } else {
      notes.push("事件条件：workflow 文件读不到，按未知处理");
    }
  } else if (out.structural === "" && out.workflow !== "ok") {
    notes.push("事件条件：workflow 不完整，跳过文件读数（按未知处理）");
  }

  out.note = notes.join("；");
  return out;
}

/**
 * 零条 run 短窗口到点的交账：exit 2，话术必须与「run 未到终态」分开。
 *
 * @param {(line: string) => void} log 日志出口
 * @param {string} headSha 要认领的那一笔（截断成短 sha 进正文）
 * @param {DispatchChain} chain 结构判定读数
 * @param {{dispatched: boolean, reason: string}} upstream 上游派发读数
 * @returns {number} 仓内三态退码
 */
export function reportNoRunFound(log, headSha, chain, upstream) {
  const minutes = String(NO_RUN_WINDOW_MS / 60_000);
  log(`[verdict] 结论：exit 2 —— ${minutes}m 内没找到对应 run（不是 run 未到终态）`);
  log(`[verdict]   判定依据：${chain.note}`);
  log(
    `[verdict]   触发表（event=repository_dispatch，per_page=100）里目标 sha ${headSha.slice(0, 8)} 零条；` +
      `上游派发读数：dispatched=true（${upstream.reason}）`,
  );
  log(
    "[verdict]   这不是权限问题（主路径读通了），也不是「GitHub 侧判了红」——" +
      "下一动作：查 run 为什么没建（仓库迁移 / 改名、workflow 禁用 / 删除、事件或分支过滤变化），" +
      "或把派发 payload 的 sha 与本格推的 HEAD 对上。",
  );
  return CODE.NO_FACT;
}

/**
 * 上游派发读数不可用时短窗口到点：**独立一形**，不并入零条 run。
 *
 * 缺 `mirror-dispatch.json` 时，「派发已发生」这条正证据没有，不能据此说「没找到对应
 * run」——它可能只是旧跑没落盘 / 跨格工作区丢了。话术必须把这层不确定性写出来。
 *
 * @param {(line: string) => void} log 日志出口
 * @param {DispatchChain} chain 结构判定读数
 * @returns {number} 仓内三态退码
 */
export function reportDispatchStateMissing(log, chain) {
  const minutes = String(NO_RUN_WINDOW_MS / 60_000);
  log(
    `[verdict] 结论：exit 2 —— ${minutes}m 内触发表零条 run，且上游派发读数不可用（.comfy-ci/mirror-dispatch.json 缺失/读不到）`,
  );
  log(`[verdict]   判定依据：${chain.note}`);
  log(
    "[verdict]   缺「派发已发生」这条正证据 ⇒ 不判「没找到对应 run」（可能只是旧跑没落盘 / 跨格工作区丢失）；" +
      "这不是权限问题，也不是红。",
  );
  return CODE.NO_FACT;
}

/**
 * 结构证据明确「不会有 run」的交账：exit 2，当场收工。
 *
 * @param {(line: string) => void} log 日志出口
 * @param {DispatchChain} chain 命中的结构证据
 * @returns {number} 仓内三态退码
 */
export function reportNoRunStructural(log, chain) {
  log(`[verdict] 结论：exit 2 —— 结构上不会有 run：${chain.structural}`);
  log(`[verdict]   判定依据：${chain.note}`);
  log(
    "[verdict]   这不是权限问题，也不是「GitHub 侧判了红」；按上面那条证据修 GitHub 侧 / 配置后，run 才会建出来。",
  );
  return CODE.NO_FACT;
}
