/* ── 「运行环境里的 cnb cli」调用面（只服务端消费，§12.5.2）──────────────
 * 应用不内置任何凭证：cli 自己从进程环境 CNB_TOKEN 或本机 `cnb login` 登录态
 * 取身份（硬规则 17）。这里只负责把「探测 / 建单 / 传附件」三件动作 spawn 成
 * argv 数组的命令，并把 -v 的 JSON 信封收窄成结果。
 *
 * 进程判据沿用既有地基，不另写一套：命令形态（Windows 的 .cmd / .ps1）问
 * `resolveCommandInvocation`，超时回收走 `killProcessTree`（硬规则 3）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { isRecord } from "~/lib/is-record";
import { resolveCommandInvocation } from "~/lib/process/executable-resolve";
import { killProcessTree } from "~/lib/process/kill-process-tree";
import { FEEDBACK_REPO_SLUG } from "~/lib/feedback/feedback-contract";

/** 一条命令的超时上限：cli 走网络，慢时不能让界面无限转圈。 */
const CLI_TIMEOUT_MS = 30_000;
/** 单次命令输出上限：回执是 JSON，超了说明形状不对，不该全量读进内存。 */
const MAX_OUTPUT_CHARS = 256 * 1024;

/** 一次命令执行的结果（不抛：失败给一句可见原因，硬规则 4）。 */
type CliRun = { data: unknown; error: string; ok: boolean };

/** 把 stdout 收窄成 cli 信封；不是 JSON 或形状不对都当失败，不猜。 */
function parseEnvelope(stdout: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 从失败信封里取一句可读原因；平台给 errmsg 就用，否则报状态码。 */
function cliDataError(data: unknown, status: number): string {
  if (isRecord(data) && typeof data.errmsg === "string" && data.errmsg !== "") {
    return `cnb 返回 ${status}：${data.errmsg}`;
  }
  return `cnb 返回 ${status}`;
}

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.trim().slice(0, 200) || "无输出";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 起一条 cnb 命令并收 -v 回执。
 * 用 spawn 传 argv 数组、不经 shell（硬规则 3）：命令形态由
 * `resolveCommandInvocation` 解析，超时由 `killProcessTree` 收整棵树。
 * 日志只记命令名与状态码，绝不回显 stdout 里的 token 之类内容。
 */
function runCnb(args: Array<string>): Promise<CliRun> {
  const invocation = resolveCommandInvocation("cnb", [...args, "-v"]);
  return new Promise<CliRun>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(invocation.command, invocation.args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ ok: false, data: null, error: `无法启动 cnb 命令：${errorMessage(error)}` });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: CliRun) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    /* 定时器不 clear、只 unref：finish 先 settle 之后这一拍就是空跑，
     * 不会拖住事件循环。这样 finish 不必反向引用一个后声明的量（no-use-before-define）。 */
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      if (child.pid !== undefined) {
        void killProcessTree({ pid: child.pid, detached: false, force: true });
      }
      finish({ ok: false, data: null, error: "cnb 命令超时（30 秒），已回收进程" });
    }, CLI_TIMEOUT_MS);
    timer.unref();

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < MAX_OUTPUT_CHARS) {
        stdout += chunk;
      }
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < MAX_OUTPUT_CHARS) {
        stderr += chunk;
      }
    });
    child.on("error", (error) => {
      finish({ ok: false, data: null, error: `无法启动 cnb 命令：${firstLine(error.message)}` });
    });
    child.on("close", () => {
      const envelope = parseEnvelope(stdout);
      if (envelope === null) {
        finish({
          ok: false,
          data: null,
          error: `cnb 命令没有返回可用回执：${firstLine(stderr || stdout)}`,
        });
        return;
      }
      const status = typeof envelope.status === "number" ? envelope.status : 0;
      if (status < 200 || status >= 300) {
        finish({ ok: false, data: envelope.data, error: cliDataError(envelope.data, status) });
        return;
      }
      finish({ ok: true, data: envelope.data ?? null, error: "" });
    });
  });
}

/**
 * 只读探测：cli 在不在、登录态在不在。
 * `cnb status` 输出是「✅ 已登录。」这类人读文本（不是 -v JSON），所以单独
 * 走一次 spawn 判文本，不碰任何写接口。
 */
export async function probeCnbCli(): Promise<{ available: boolean; reason: string }> {
  const invocation = resolveCommandInvocation("cnb", ["status"]);
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(invocation.command, invocation.args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ available: false, reason: `无法启动 cnb 命令：${errorMessage(error)}` });
      return;
    }
    let stdout = "";
    let settled = false;
    const finish = (result: { available: boolean; reason: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      if (child.pid !== undefined) {
        void killProcessTree({ pid: child.pid, detached: false, force: true });
      }
      finish({ available: false, reason: "cnb status 探测超时（30 秒）" });
    }, CLI_TIMEOUT_MS);
    timer.unref();
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", (error) => {
      finish({ available: false, reason: `无法执行 cnb status：${firstLine(error.message)}` });
    });
    child.on("close", () => {
      if (!stdout.includes("已登录")) {
        finish({
          available: false,
          reason: "cnb cli 未登录，请先在终端执行 cnb login（或确保运行环境注入了 CNB_TOKEN）",
        });
        return;
      }
      finish({ available: true, reason: "" });
    });
  });
}

/** 从 create-issue 的 201 回执里取平台给的 Issue 号（只信 data.number 原值）。 */
function readIssueNumber(data: unknown): string | null {
  if (!isRecord(data)) {
    return null;
  }
  const number = data.number;
  if (typeof number === "string" && /^\d+$/.test(number)) {
    return number;
  }
  return typeof number === "number" && Number.isInteger(number) ? String(number) : null;
}

/** 从 upload-image/file 的 200 回执里取可引用链接（asset_link）。 */
function readAssetLink(data: unknown): string | null {
  if (!isRecord(data) || typeof data.asset_link !== "string" || data.asset_link === "") {
    return null;
  }
  return data.asset_link;
}

/** 把一段正文写进临时文件并给出路径（cli 的 --body-file 只认本地文件）。 */
async function writeTempBody(body: string): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "feedback-cnb-"));
  const file = path.join(dir, "body.md");
  await fs.promises.writeFile(file, body, "utf8");
  return file;
}

/** 建单：正文走 --body-file（argv 里塞多行会带 $ 前缀，实测形态），标题由服务端给。 */
export async function createFeedbackIssue(
  title: string,
  body: string,
): Promise<{ error: string; issueNumber: string; ok: boolean }> {
  const file = await writeTempBody(body);
  try {
    const run = await runCnb([
      "issues",
      "create-issue",
      "--repo",
      FEEDBACK_REPO_SLUG,
      "--title",
      title,
      "--body-file",
      file,
    ]);
    if (!run.ok) {
      return { ok: false, issueNumber: "", error: run.error };
    }
    const number = readIssueNumber(run.data);
    return number === null
      ? { ok: false, issueNumber: "", error: "cnb 建单回执里没有 Issue 号" }
      : { ok: true, issueNumber: number, error: "" };
  } finally {
    await fs.promises
      .rm(path.dirname(file), { recursive: true, force: true })
      .catch(() => undefined);
  }
}

/** 上传一个附件到已建 Issue，回可引用链接（失败不抛，交调用方汇总）。 */
export async function uploadFeedbackAsset(
  issueNumber: string,
  filePath: string,
  kind: "image" | "file",
): Promise<{ error: string; link: string; ok: boolean }> {
  const tool = kind === "image" ? "upload-image" : "upload-file";
  const run = await runCnb([
    "issues",
    tool,
    "--repo",
    FEEDBACK_REPO_SLUG,
    "--number",
    issueNumber,
    "--file",
    filePath,
  ]);
  if (!run.ok) {
    return { ok: false, link: "", error: run.error };
  }
  const link = readAssetLink(run.data);
  return link === null
    ? { ok: false, link: "", error: "cnb 上传回执里没有附件链接" }
    : { ok: true, link, error: "" };
}

/** 把本次上传成功的附件引用写进一条 Issue 评论（链接里带引号 / 尖括号，走 body-file）。 */
export async function postFeedbackAssetsComment(
  issueNumber: string,
  lines: Array<string>,
): Promise<{ error: string; ok: boolean }> {
  if (lines.length === 0) {
    return { ok: true, error: "" };
  }
  const body = ["## 反馈附件（由应用内反馈自动上传）", "", ...lines].join("\n");
  const file = await writeTempBody(body);
  try {
    const run = await runCnb([
      "issues",
      "post-issue-comment",
      "--repo",
      FEEDBACK_REPO_SLUG,
      "--number",
      issueNumber,
      "--body-file",
      file,
    ]);
    return run.ok ? { ok: true, error: "" } : { ok: false, error: run.error };
  } finally {
    await fs.promises
      .rm(path.dirname(file), { recursive: true, force: true })
      .catch(() => undefined);
  }
}
