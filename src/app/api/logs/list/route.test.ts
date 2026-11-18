/**
 * `GET /api/logs/list` 的路由级用例（ISSUE #4215）：同族 current / sessions /
 * export / diagnostics 都有测试，list 是当轮漏掉的存量。钉两件——
 *
 *  1. 鉴权闸返回 null 时路由回 401、且不触达日志读（防回退判据）。
 *     ⚠️ 口径：#3827 起应用无需登录，`requireRequestUser()` 真实实现无会话回落
 *     演示用户、**从不返回 null**。这里的 401 是把闸 mock 成 null 造出的「防御分支」——
 *     测的是「万一闸将来真的返回 null，路由必须挡在最前面别读日志」，不是「应用要求登录」。
 *  2. 正常契约：递归列 .log、排除 dev-launcher.log、按 mtime 倒序。
 *
 * 路由的 LOG_DIR 是模块加载时按 `process.cwd()` 算的常量，所以在 import 之前
 * chdir 到本用例自己的临时目录（vitest 每份测试文件独立 worker，chdir 不串台），
 * 既不碰真实 log/（gitignore 的运行期目录，本机/CI 内容不一致），也不用假 fs  brittle。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isRecord } from "~/lib/is-record";

process.env.SKIP_ENV_VALIDATION = "1";

const originalCwd = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "log-list-"));
const logDir = path.join(tmp, "log");
fs.mkdirSync(path.join(logDir, "sub"), { recursive: true });
process.chdir(tmp);

/* 可翻面鉴权桩：默认放行，401 用例翻面。必须在 chdir 之后、import 之前声明。 */
let authed = true;
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: () => (authed ? { id: "u-test" } : null),
}));

const { GET } = await import("./route");

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
});

type LogFile = { name: string; relativePath: string; size: number };

function isListPayload(v: unknown): v is { files: Array<LogFile> } {
  return (
    isRecord(v) &&
    Array.isArray(v.files) &&
    v.files.every(
      (f) =>
        isRecord(f) &&
        typeof f.name === "string" &&
        typeof f.relativePath === "string" &&
        typeof f.size === "number",
    )
  );
}

/** 重建夹具：先清空 log/，再按给定文件（相对 log/ 的路径 + mtime + 内容）造。 */
function seed(files: Array<{ body?: string; mtimeMs: number; rel: string }>): void {
  fs.rmSync(logDir, { recursive: true, force: true });
  fs.mkdirSync(logDir, { recursive: true });
  for (const f of files) {
    const full = path.join(logDir, f.rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.body ?? "x");
    fs.utimesSync(full, new Date(f.mtimeMs), new Date(f.mtimeMs));
  }
}

beforeEach(() => {
  authed = true;
  seed([]);
});

describe("GET /api/logs/list 鉴权防御分支（ISSUE #4215）", () => {
  it("鉴权闸返回 null ⇒ 401，不读日志文件", async () => {
    seed([{ rel: "secret.log", mtimeMs: 1 }]);
    authed = false;
    const res = await GET();
    expect(res.status).toBe(401);
    const body: unknown = await res.json();
    expect(isRecord(body)).toBe(true);
  });
});

describe("GET /api/logs/list 列表契约（ISSUE #4215）", () => {
  it("递归列 .log、排除 dev-launcher.log、按 mtime 倒序", async () => {
    seed([
      { rel: "old.log", mtimeMs: 100, body: "0123456789" },
      { rel: "new.log", mtimeMs: 300, body: "01234567890123456789" },
      { rel: "dev-launcher.log", mtimeMs: 999 },
      { rel: "notes.txt", mtimeMs: 400 },
      { rel: "sub/deep.log", mtimeMs: 200, body: "12345" },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(isListPayload(body)).toBe(true);
    if (!isListPayload(body)) {
      return;
    }
    expect(body.files.map((f) => f.name)).toEqual(["new.log", "deep.log", "old.log"]);
    expect(body.files.map((f) => f.relativePath)).toEqual(["new.log", "sub/deep.log", "old.log"]);
    expect(body.files.find((f) => f.name === "new.log")?.size).toBe(20);
  });

  it("log/ 目录不存在 ⇒ 空列表（不是 500）", async () => {
    fs.rmSync(logDir, { recursive: true, force: true });
    const res = await GET();
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(isListPayload(body) && body.files.length === 0).toBe(true);
  });
});
