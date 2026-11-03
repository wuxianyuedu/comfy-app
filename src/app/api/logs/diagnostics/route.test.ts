/**
 * /api/logs/diagnostics 的打包契约（ISSUE #1326）：复用启动编排的 `exportDiagnostics()`，把 `current/` + 最近几次 `runs/`
 * 打成 zip 落 `log/exports/`（面板导出只有它看得见的行，报 bug 还要 run.json / 崩溃残留 / comfyui 原始回执）。
 * 钉三条：产物真是能解开的 zip（python zipfile 验）；内容含本次 `current/run.json` 与历史包；未登录不打包。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hasPython, runPython } from "../../../../../tests/helpers/python-exe";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "log-diag-"));
/** 日志根（`<项目根>/log`）—— 与真实布局同形，`LOG_ROOT` 指的就是它。 */
const logRoot = path.join(tmp, "log");

/* 全部日志路径落到本用例自己的临时目录（理由同 export 用例：`log/` 在
 * .gitignore 里，CI 上不存在）。 */
vi.mock("~/lib/log/log-paths", async () => {
  const actual = await vi.importActual("~/lib/log/log-paths");
  return {
    /* SAFETY: 类型断言已复核 */
    ...(actual as Record<string, unknown>),
    LOG_ROOT: logRoot,
  };
});

let authed = true;
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: async () =>
    authed ? { id: "u1", email: "t@example.com", name: null } : null,
}));

const { POST } = await import("./route");

/** Python 可用性。写成常量而不是 `it.skipIf(!hasPython())`：登记表的扫描器按
 * `[^)]*` 取守卫文本，守卫里带括号会让它匹配不上 —— 新增的 skip 站点于是在登记表里
 * **隐形**。 */
const PYTHON_OK = hasPython();

/** 用 Python 的 zipfile 解包（最严格的解压端：Bad CRC-32 当场报）。
 *
 * 解释器走共享的 `runPython()`：Windows 上没有 `python3` 这个名字，
 * 硬编码会让这条用例在自托管 Windows 构建节点上 ENOENT（见该 helper 文件头）。 */
function unzipList(file: string): Array<string> {
  return runPython(
    `
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None, "bad crc"
print("\\n".join(sorted(z.namelist())))
`,
    [file],
  )
    .split(/\r?\n/)
    .filter(Boolean);
}

beforeEach(() => {
  authed = true;
  fs.rmSync(tmp, { recursive: true, force: true });
  // 造「本次运行」的 current/（含 run.json 与一份日志）
  const cur = path.join(logRoot, "current");
  fs.mkdirSync(path.join(cur, "launcher"), { recursive: true });
  fs.writeFileSync(path.join(cur, "run.json"), JSON.stringify({ runId: "a1b2c3", crashed: false }));
  fs.writeFileSync(path.join(cur, "launcher", "dev-launcher.log"), "本次\n");
  // 造两次历史归档
  for (const name of ["2026-09-29_100000-aaaaaa", "2026-09-30_193612-a1b2c3"]) {
    const dir = path.join(logRoot, "runs", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ runId: name }));
    fs.writeFileSync(path.join(dir, "launcher.log"), "旧\n");
  }
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("/api/logs/diagnostics", () => {
  /* Python 缺失时跳过并登记（`env` 档，与 `tests/check-file-structure.test.ts` 的
   * `!python` 那一族同处置）：它在这里是**独立验证端**（`zipfile` 是最严格的解压端，
   * Bad CRC-32 当场报），缺了它只该让这一条「没跑」，不该让流水线红。 */
  it.skipIf(!PYTHON_OK)("打出能解开的 zip，含本次 current/ 与历史 runs/", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    /* SAFETY: 类型断言已复核 */
    const data = (await res.json()) as {
      bytes: number | null;
      ok: boolean;
      path: string;
      relativePath: string;
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
      fs.readdirSync(path.join(logRoot, "exports")).filter((n) => n.startsWith(".stage")),
    ).toEqual([]);
  });

  it("未登录不打包（鉴权与同族端点一致）", async () => {
    authed = false;
    const res = await POST();
    expect(res.status).toBe(401);
    expect(fs.existsSync(path.join(logRoot, "exports"))).toBe(false);
  });
});
