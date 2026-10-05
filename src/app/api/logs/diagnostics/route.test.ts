/**
 * /api/logs/diagnostics 的打包契约（ISSUE #1326）。
 *
 * 面板的「保存到本地」只导出**它看得见的行**；用户报 bug 时真正要给的现场还包括
 * `run.json`（runId / 版本 / 分支 / commit / pid / 退出码）、上一次崩溃留下的残留、
 * comfyui 原始回执。本端点复用启动编排的 `exportDiagnostics()`，把
 * `current/` + 最近几次 `runs/` 打成一个 zip 落在 `log/exports/`。
 *
 * 钉死三条：
 *   1. 产物真的是一个能解开的 zip（用 python 的 zipfile 验，不靠「文件存在」）；
 *   2. 内容含本次运行的 `current/run.json` 与历史包 —— 缺了就等于没打包；
 *   3. 鉴权与同族端点一致（未登录不打包）。
 */
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "log-diag-"));
/** 日志根（`<项目根>/log`）—— 与真实布局同形，`LOG_ROOT` 指的就是它。 */
const logRoot = path.join(tmp, "log");

/* 全部日志路径落到本用例自己的临时目录（理由同 export 用例：`log/` 在
 * .gitignore 里，CI 上不存在）。 */
vi.mock("~/lib/log/log-paths", async () => {
  const actual = await vi.importActual("~/lib/log/log-paths");
  return { ...(actual as Record<string, unknown>), LOG_ROOT: logRoot };
});

let authed = true;
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: async () =>
    authed ? { id: "u1", email: "t@example.com", name: null } : null,
}));

const { POST } = await import("./route");

/** 用 python 的 zipfile 解包（最严格的解压端：Bad CRC-32 当场报）。 */
function unzipList(file: string): string[] {
  return execFileSync(
    "python3",
    [
      "-c",
      `
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None, "bad crc"
print("\\n".join(sorted(z.namelist())))
`,
      file,
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
}

beforeEach(() => {
  authed = true;
  fs.rmSync(tmp, { recursive: true, force: true });
  // 造「本次运行」的 current/（含 run.json 与一份日志）
  const cur = path.join(logRoot, "current");
  fs.mkdirSync(path.join(cur, "launcher"), { recursive: true });
  fs.writeFileSync(
    path.join(cur, "run.json"),
    JSON.stringify({ runId: "a1b2c3", crashed: false }),
  );
  fs.writeFileSync(path.join(cur, "launcher", "dev-launcher.log"), "本次\n");
  // 造两次历史归档
  for (const name of ["2026-09-29_100000-aaaaaa", "2026-09-30_193612-a1b2c3"]) {
    const dir = path.join(logRoot, "runs", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "run.json"),
      JSON.stringify({ runId: name }),
    );
    fs.writeFileSync(path.join(dir, "launcher.log"), "旧\n");
  }
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("/api/logs/diagnostics", () => {
  it("打出能解开的 zip，含本次 current/ 与历史 runs/", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      path: string;
      relativePath: string;
      bytes: number | null;
    };
    expect(data.ok).toBe(true);
    expect(data.path.startsWith(path.join(logRoot, "exports"))).toBe(true);
    expect(data.relativePath.startsWith("exports/")).toBe(true);
    expect(fs.existsSync(data.path)).toBe(true);
    expect(data.bytes).toBeGreaterThan(0);

    const names = unzipList(data.path);
    // 本次运行的环境信息必须在包里 —— 这正是它与「保存到本地」的区别
    expect(names).toContain("current/run.json");
    expect(names).toContain("current/launcher/dev-launcher.log");
    // 历史包按「最近 3 次」带上（这里 2 个，全带）
    expect(names).toContain("runs/2026-09-29_100000-aaaaaa/launcher.log");
    expect(names).toContain("runs/2026-09-30_193612-a1b2c3/run.json");
    // 暂存目录不留痕（否则下一次会被一起打进去）
    expect(
      fs
        .readdirSync(path.join(logRoot, "exports"))
        .filter((n) => n.startsWith(".stage")),
    ).toEqual([]);
  });

  it("未登录不打包（鉴权与同族端点一致）", async () => {
    authed = false;
    const res = await POST();
    expect(res.status).toBe(401);
    expect(fs.existsSync(path.join(logRoot, "exports"))).toBe(false);
  });
});
