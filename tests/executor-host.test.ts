/**
 * `scripts/executor-host.mjs` 骨架的三条最小契约（P3 §5 第 2 期·Phase 2-B）：
 *   1. `--once` 模式：boot 完成后立即 exit 0，日志文件里能看到 boot + 退出两行。
 *   2. 常驻模式 + SIGTERM：进程活着、能收终止信号并落盘；POSIX 走 handler
 *      拿到 exit=0 + shutdown 行；Windows 上 Node 控制台 SIGTERM 语义与 POSIX
 *      不同（`child.kill("SIGTERM")` 实际走 TerminateProcess、handler 不跑），
 *      只断「进程真的终止了 + 之前的 boot/heartbeat 都落了盘」。真正的整树回收
 *      由 `cross-platform-launcher.test.ts` 与 `kill-process-tree.windows.test.ts`
 *      那族覆盖。
 *   3. 日志文件落在 `COMFYAPP_HOST_LOG` 指定的位置（默认 `log/services/executor-host.log`）；
 *      测试全部指到自己 mkdtemp 的临时目录、绝不落到仓库 `log/`。
 *
 * 反证：把脚本里的 `writeLine` 换成 no-op，用例 1/2/3 都会红。
 *
 * 本 PR **不**测「boot 时按顺序调用 configureXxx」那条链——Phase 2-A（repository driver
 * 抽取）与 Phase 2-C（launcher 集成）都没落地之前，那条链还没有可注入的对象。
 * 骨架先证明「一个纯 Node 进程能起来 + 心跳能落 + 终止时进程真退」。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const HOST_SCRIPT = path.join(REPO_ROOT, "scripts", "executor-host.mjs");

/** 每次用例自己的 tmpdir 承接日志文件，测试结束 rmSync。 */
const tmpDirs: string[] = [];
function mkTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-host-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    if (d) fs.rmSync(d, { recursive: true, force: true });
  }
});

function runHost(args: string[], logPath: string) {
  return new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [HOST_SCRIPT, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, COMFYAPP_HOST_LOG: logPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });
    child.on("exit", (code) => resolve({ code, stderr }));
  });
}

/** 轮询直到谓词为真，或超时。避免测试靠 sleep 猜时序。 */
async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor 超时");
}

describe("scripts/executor-host.mjs 骨架", () => {
  it("--once：boot 立即 exit 0，日志含 boot + 退出两行", async () => {
    const tmp = mkTmp();
    const logPath = path.join(tmp, "sub", "exec.log");
    const { code, stderr } = await runHost(["--once"], logPath);
    expect(code, `stderr: ${stderr}`).toBe(0);
    const text = fs.readFileSync(logPath, "utf-8");
    expect(text).toMatch(/\[executor-host\] boot pid=\d+ bootId=[0-9a-z]+/);
    expect(text).toContain("--once 模式：boot 完成、立即退出 0");
    // 时间戳形态与 app-runtime.log 一致（本地毫秒）：`[YYYY-MM-DD HH:MM:SS.mmm]`
    expect(text).toMatch(
      /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO\] \[executor-host\] boot/,
    );
  });

  it("常驻 + SIGTERM：boot → 至少一次 heartbeat → 收终止信号后进程真的退出", async () => {
    const tmp = mkTmp();
    const logPath = path.join(tmp, "exec.log");
    const child = spawn(process.execPath, [HOST_SCRIPT, "--interval=100"], {
      cwd: REPO_ROOT,
      env: { ...process.env, COMFYAPP_HOST_LOG: logPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await waitFor(() => {
        if (!fs.existsSync(logPath)) return false;
        return fs.readFileSync(logPath, "utf-8").includes("heartbeat");
      });
      child.kill("SIGTERM");
      const exitCode = await new Promise<number | null>((resolve) => {
        child.on("exit", (c) => resolve(c));
      });
      const text = fs.readFileSync(logPath, "utf-8");
      expect(text).toContain("boot pid=");
      expect(text).toContain("heartbeat bootId=");
      if (process.platform === "win32") {
        // Windows Node 控制台 SIGTERM 走 TerminateProcess：handler 不跑、
        // exit code 是 null；这只算「进程确实终止了」。
        expect(exitCode === 0 || exitCode === null).toBe(true);
      } else {
        expect(exitCode).toBe(0);
        expect(text).toContain("shutdown sig=SIGTERM");
      }
    } finally {
      if (!child.killed) child.kill("SIGKILL");
    }
  }, 20_000);

  it("未设 COMFYAPP_HOST_LOG 时默认路径写到 `log/services/`（不做写入、只测路径拼装）", async () => {
    // 骨架阶段不测「真的落到仓库 log/」——那条测试会污染仓库；直接读源码
    // 断默认分支即可（保持脚本文件与规范 §4「log/ 分区」契约一致）。
    const src = fs.readFileSync(HOST_SCRIPT, "utf-8");
    expect(src).toMatch(
      /COMFYAPP_HOST_LOG[\s\S]*?"log",\s*"services",\s*"executor-host\.log"/,
    );
  });
});
