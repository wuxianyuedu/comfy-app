/**
 * `scripts/executor-host.mjs` 的两组契约：
 *   1. **骨架形态**（2-B 三条，**显式** `COMFY_EXECUTOR=inline`）：`--once` 起落、
 *      常驻 + SIGTERM、日志路径——骨架必须**不碰 DB**，这三条钉的就是它的极简性。
 *      为什么要显式给值而不是「不设」：判据自 4-A4（ADR §14 D5）起会回读仓库
 *      `.env`，而开发机那份完全可能写着 `COMFY_EXECUTOR=host`（4-A4 实测就是这种
 *      机器）——让本地配置决定用例结论，得到的不是绿就是假绿。进程 env 优先于
 *      `.env`，给一个 `inline` 就把这一组钉住了。
 *      常驻模式的 POSIX 细节：能收终止信号并落盘；Windows 上 Node 控制台
 *      SIGTERM 语义与 POSIX 不同（`child.kill("SIGTERM")` 实际走
 *      TerminateProcess、handler 不跑），只断「进程真的终止了 + 之前的
 *      boot/heartbeat 都落了盘」。真正的整树回收由 `cross-platform-launcher.test.ts`
 *      与 `kill-process-tree.windows.test.ts` 那族覆盖。
 *   2. **运行时注入链**（3-B0 两条，`COMFY_EXECUTOR=host`）：golden 跨片不误杀
 *      （inline 片的排队行在 host boot 后原样 QUEUED、零误杀）+ 库不可达时大声退出 1。
 *   日志文件一律落各用例自己 mkdtemp 的临时目录、绝不落到仓库 `log/`。
 *
 * 反证：把脚本里的 `writeLine` 换成 no-op，用例 1/2/3 都会红；去掉 reaper 的
 * owner 分片，golden 那条会红（host Q2 数到并试图回收 inline 的行）。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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
      // 显式 inline：见文件头——不钉住就会被开发机的 `.env` 判成运行时形态。
      env: {
        ...process.env,
        COMFY_EXECUTOR: "inline",
        COMFYAPP_HOST_LOG: logPath,
      },
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
      env: {
        ...process.env,
        COMFY_EXECUTOR: "inline",
        COMFYAPP_HOST_LOG: logPath,
      },
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

/** Phase 3-B0：`COMFY_EXECUTOR=host` 的运行时注入链。与上方骨架契约分组的
 *  意义——骨架形态（未设 env）必须**一行都不碰 DB**，运行时形态才 tsx 加载
 *  TS + 注入 reaper(owner=host)/enqueue/trace + Q2 扫自己那片。 */
describe("scripts/executor-host.mjs 运行时注入链（Phase 3-B0/3-B1）", () => {
  /** 在临时目录建一份最小 `task` 表库（列取 reaper/领取实际触达的集合），
   *  种一行 **inline 片**的超时排队行（ISSUE #1204 起它不再是「孤儿」形状）。
   *  `claimedAt` 在这份清单里是因为领取语句写它（ADR §14 D1 的 4-B2）——缺列的
   *  表现是 host 侧 `claim-tick FAILED` 并以退出码 1 收场（本用例正是这么抓到的），
   *  而不是「少记了一个时间」。 */
  function mkDbWithInlineQueued(dir: string): {
    dbPath: string;
    rowId: string;
  } {
    const dbPath = path.join(dir, "host.db");
    const db = new DatabaseSync(dbPath);
    db.exec(
      `CREATE TABLE task (
        id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'QUEUED',
        promptId TEXT, finishedAt TEXT, createdAt TEXT NOT NULL,
        workflowName TEXT, params TEXT, execPayload TEXT, claimedBy TEXT,
        claimedAt TEXT
      )`,
    );
    const staleAt = new Date(Date.now() - 120_000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 23);
    db.prepare(
      "INSERT INTO task (id,status,createdAt,workflowName) VALUES (?,'QUEUED',?,?)",
    ).run("inline-queued-1", staleAt, "w");
    db.close();
    return { dbPath, rowId: "inline-queued-1" };
  }

  /** 往同一份临时库补一行 host 片的 QUEUED 任务（带执行载荷）。 */
  function seedHostRow(dbPath: string, id: string): void {
    const db = new DatabaseSync(dbPath);
    db.prepare(
      "INSERT INTO task (id,status,createdAt,workflowName,params,execPayload,claimedBy) VALUES (?,'QUEUED',datetime('now'),?,?,?,?)",
    ).run(id, "w", "{}", '{"nodes":[{"id":"1"}]}', "host");
    db.close();
  }

  function readTaskRow(dbPath: string, id: string): Record<string, unknown> {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare("SELECT * FROM task WHERE id=?").get(id) ?? {};
    } finally {
      db.close();
    }
  }

  it("golden：host boot 的排队计数只数 host 片——inline 片排队行原样 QUEUED、零误杀", async () => {
    const tmp = mkTmp();
    const logPath = path.join(tmp, "host.log");
    const { dbPath, rowId } = mkDbWithInlineQueued(tmp);
    const { code, stderr } = await new Promise<{
      code: number | null;
      stderr: string;
    }>((resolve) => {
      const child = spawn(process.execPath, [HOST_SCRIPT, "--once"], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          COMFY_EXECUTOR: "host",
          DATABASE_URL: `file:${dbPath}`,
          COMFYAPP_HOST_LOG: logPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let err = "";
      child.stderr.on("data", (b: Buffer) => {
        err += b.toString("utf8");
      });
      child.on("exit", (c) => resolve({ code: c, stderr: err }));
    });
    const text = fs.readFileSync(logPath, "utf-8");
    expect(code, `stderr: ${stderr}\nlog:\n${text}`).toBe(0);
    expect(text).toContain("mode=runtime");
    expect(text).toContain("runtime inject-ok");
    // NULL 归属行不算 host 片：Q2 计数必须为 0……
    expect(text).toMatch(/q2-scan hostShardQueued=0/);
    // ……且那行 inline 片的排队行在 host boot 前后一字未动（仍 QUEUED、没被 FAIL）。
    const row = readTaskRow(dbPath, rowId);
    expect(row.status).toBe("QUEUED");
    expect(row.claimedBy ?? null).toBeNull();
  }, 90_000);

  it("失败路径大声死：库不可达（目录不存在）→ 注入链失败 → exit 1 + 日志行，不退化成心跳假活", async () => {
    const tmp = mkTmp();
    const logPath = path.join(tmp, "host-fail.log");
    const missing = path.join(tmp, "no-such-dir", "x.db");
    const { code } = await new Promise<{ code: number | null }>((resolve) => {
      const child = spawn(process.execPath, [HOST_SCRIPT, "--once"], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          COMFY_EXECUTOR: "host",
          DATABASE_URL: `file:${missing}`,
          COMFYAPP_HOST_LOG: logPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.on("exit", (c) => resolve({ code: c }));
    });
    expect(code).toBe(1);
    expect(fs.readFileSync(logPath, "utf-8")).toContain("runtime boot FAILED");
  }, 90_000);

  /** 用指定 args/env 跑一次 host 子进程，回 exit code（stderr 一并带回防哑）。 */
  function runHostWith(
    args: string[],
    extraEnv: Record<string, string>,
    logPath: string,
  ): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [HOST_SCRIPT, ...args], {
        cwd: REPO_ROOT,
        env: { ...process.env, COMFYAPP_HOST_LOG: logPath, ...extraEnv },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let err = "";
      child.stderr.on("data", (b: Buffer) => {
        err += b.toString("utf8");
      });
      child.on("exit", (c) => resolve({ code: c, stderr: err }));
    });
  }

  it("--claim-once：领走恰好一行 host 行（QUEUED→RUNNING + claim-dispatched），不碰 inline 行", async () => {
    const tmp = mkTmp();
    const logPath = path.join(tmp, "claim.log");
    const { dbPath, rowId } = mkDbWithInlineQueued(tmp);
    seedHostRow(dbPath, "host-job-1");
    const { code, stderr } = await runHostWith(
      ["--claim-once"],
      { COMFY_EXECUTOR: "host", DATABASE_URL: `file:${dbPath}` },
      logPath,
    );
    const text = fs.readFileSync(logPath, "utf-8");
    expect(code, `stderr: ${stderr}\nlog:\n${text}`).toBe(0);
    expect(text).toContain("claim-dispatched taskId=host-job-1");
    const claimed = readTaskRow(dbPath, "host-job-1");
    expect(claimed.status).toBe("RUNNING");
    expect(claimed.claimedBy).toBe("host");
    // 领取跨片红线：同库的 inline 片排队行不被这条 tick 动到
    expect(readTaskRow(dbPath, rowId).status).toBe("QUEUED");
  }, 90_000);

  it("--claim-once 在骨架形态（显式 COMFY_EXECUTOR=inline）被拒 → exit 1（骨架没有可领取的运行时）", async () => {
    const tmp = mkTmp();
    const logPath = path.join(tmp, "claim-skel.log");
    const { code } = await runHostWith(
      ["--claim-once"],
      { COMFY_EXECUTOR: "inline" },
      logPath,
    );
    expect(code).toBe(1);
    expect(fs.readFileSync(logPath, "utf-8")).toContain(
      "--claim-once 需要 COMFY_EXECUTOR=host",
    );
  }, 60_000);
});
