/**
 * /api/feedback/publish 的契约（#3384）：GET 只读探测、POST 建单 + 传附件。
 * 钉几条：客户端只给包名（路径遍历的形状一律拒）、cli 不可用不建单、
 * 建单失败不出第二次写、附件引用挂到评论、未登录不碰 cli。
 * mock 边界：cnb-cli 那一层整体替身（起真进程不是本文件要测的），
 * 落盘目录指到临时目录，读真 issue.md。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isPlainRecord } from "~/lib/is-record";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-publish-"));
const exportDir = path.join(tmp, "exports");

vi.mock("~/lib/log/log-paths", async () => {
  const actual = await vi.importActual("~/lib/log/log-paths");
  return { ...(actual as Record<string, unknown>), LOG_EXPORT_DIR: exportDir };
});

const cli = vi.hoisted(() => ({
  probe: vi.fn(),
  create: vi.fn(),
  upload: vi.fn(),
  comment: vi.fn(),
}));
vi.mock("~/server/feedback/cnb-cli", () => ({
  probeCnbCli: cli.probe,
  createFeedbackIssue: cli.create,
  uploadFeedbackAsset: cli.upload,
  postFeedbackAssetsComment: cli.comment,
}));

let authed = true;
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: () => (authed ? { id: "u1", email: "t@example.com", name: null } : null),
}));

const { GET, POST } = await import("./route");

const PACKAGE = "feedback-20261108-101010-123";

function writePackage(files: Record<string, string> = {}): void {
  const dir = path.join(exportDir, PACKAGE);
  fs.mkdirSync(path.join(dir, "images"), { recursive: true });
  fs.mkdirSync(path.join(dir, "diagnostics"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "issue.md"),
    "# [运行反馈] 点了没反应\n\n## 问题描述\n\n没反应\n",
  );
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
}

/** 从响应体里读 error 文案：用守卫收窄，不做不安全断言。 */
function errorOf(value: unknown): string {
  return isPlainRecord(value) && typeof value.error === "string" ? value.error : "";
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/feedback/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  authed = true;
  fs.rmSync(exportDir, { recursive: true, force: true });
  fs.mkdirSync(exportDir, { recursive: true });
  cli.probe.mockResolvedValue({ available: true, reason: "" });
  cli.create.mockResolvedValue({ ok: true, issueNumber: "3390", error: "" });
  cli.upload.mockResolvedValue({ ok: true, link: "<img src='x' />", error: "" });
  cli.comment.mockResolvedValue({ ok: true, error: "" });
});

afterEach(() => {
  fs.rmSync(exportDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("GET /api/feedback/publish（探测）", () => {
  it("把 cli 可用性原样回给界面", async () => {
    cli.probe.mockResolvedValue({ available: false, reason: "未登录" });
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ available: false, reason: "未登录" });
  });

  it("未登录不探测 cli", async () => {
    authed = false;
    expect((await GET()).status).toBe(401);
    expect(cli.probe).not.toHaveBeenCalled();
  });
});

describe("POST /api/feedback/publish（提交）", () => {
  it("建单 + 传图片 + 传诊断包 + 挂附件评论，回 Issue 链接", async () => {
    writePackage({ "images/01.png": "png", "diagnostics/diagnostics.zip": "zip" });
    const res = await post({ packageName: PACKAGE });
    expect(res.status).toBe(200);
    const data: unknown = await res.json();
    expect(data).toMatchObject({ ok: true, issueNumber: "3390", uploaded: 2 });
    expect(cli.create).toHaveBeenCalledTimes(1);
    expect(String(cli.create.mock.calls[0]?.[0] ?? "")).toContain("[运行反馈]");
    expect(cli.upload).toHaveBeenCalledTimes(2);
    expect(cli.comment).toHaveBeenCalledTimes(1);
  });

  it("客户端给路径遍历形状一律拒，不碰 cli", async () => {
    const res = await post({ packageName: "../etc/passwd" });
    expect(res.status).toBe(400);
    expect(cli.create).not.toHaveBeenCalled();
  });

  it("cli 不可用时不建单，回可见原因", async () => {
    writePackage();
    cli.probe.mockResolvedValue({ available: false, reason: "cnb cli 未登录" });
    const res = await post({ packageName: PACKAGE });
    const data: unknown = await res.json();
    expect(data).toMatchObject({ ok: false, error: "cnb cli 未登录" });
    expect(cli.create).not.toHaveBeenCalled();
  });

  it("建单失败后不再上传附件", async () => {
    writePackage({ "images/01.png": "png" });
    cli.create.mockResolvedValue({ ok: false, issueNumber: "", error: "cnb 返回 403" });
    const res = await post({ packageName: PACKAGE });
    const data: unknown = await res.json();
    expect(data).toMatchObject({ ok: false, error: "cnb 返回 403" });
    expect(cli.upload).not.toHaveBeenCalled();
  });

  it("部分附件传失败：不推翻已建单，把半成状态如实回给界面", async () => {
    writePackage({ "images/01.png": "png" });
    cli.upload.mockResolvedValue({ ok: false, link: "", error: "上传失败" });
    const res = await post({ packageName: PACKAGE });
    const data: unknown = await res.json();
    expect(data).toMatchObject({ ok: true, issueNumber: "3390", uploaded: 0 });
    expect(errorOf(data)).toContain("部分附件未完成");
  });

  it("反馈包不存在时给可见错误，不回 500 堆栈", async () => {
    const res = await post({ packageName: PACKAGE });
    expect(res.status).toBe(500);
    const data: unknown = await res.json();
    expect(errorOf(data)).not.toBe("");
  });

  it("未登录不提交", async () => {
    authed = false;
    writePackage();
    expect((await post({ packageName: PACKAGE })).status).toBe(401);
    expect(cli.probe).not.toHaveBeenCalled();
  });
});
