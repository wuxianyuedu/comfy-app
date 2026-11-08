/**
 * /api/feedback/export 的落盘契约（ISSUE #3371）：把问题描述 / 截图 / 诊断包
 * 收成一个本机反馈包并回路径 + 预填 Issue 正文。钉几条：文件名由服务端自造、
 * 图片走白名单（svg / 非图片拒）、描述为空不落盘、诊断包开关生效、未登录不落盘。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isPlainRecord } from "~/lib/is-record";
import type { FeedbackDraft } from "~/lib/feedback/feedback-contract";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-export-"));
const logRoot = path.join(tmp, "log");
const exportDir = path.join(logRoot, "exports");

vi.mock("~/lib/log/log-paths", async () => {
  const actual = await vi.importActual("~/lib/log/log-paths");
  return {
    /* SAFETY: 类型断言已复核 */
    ...(actual as Record<string, unknown>),
    LOG_ROOT: logRoot,
    LOG_EXPORT_DIR: exportDir,
  };
});

let authed = true;
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: () => (authed ? { id: "u1", email: "t@example.com", name: null } : null),
}));

/* 诊断 zip 不真打：造一个占位文件当 exportDiagnostics 的产物，验「复制进包」
 * 这条接线就够（zip 内容由 /api/logs/diagnostics 自己的用例钉）。 */
const fakeZip = path.join(tmp, "diagnostics.zip");
vi.mock("../../../../../scripts/launcher-core/run.mjs", () => ({
  exportDiagnostics: () => Promise.resolve(fakeZip),
}));

const { POST } = await import("./route");

function draft(overrides: Partial<FeedbackDraft> = {}): FeedbackDraft {
  return {
    description: "点了生成没反应",
    images: [],
    environment: {
      appVersion: "1.2.3",
      platform: "Win32",
      userAgent: "test-agent",
      when: "2026-11-08 10:00:00",
    },
    includeDiagnostics: false,
    ...overrides,
  };
}

/** 1×1 透明 PNG（合法 base64 载荷）。 */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/feedback/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

type Payload = {
  diagnosticsIncluded: boolean;
  error: string;
  imageCount: number;
  issueBody: string;
  issueTitle: string;
  ok: boolean;
  packageName: string;
  packagePath: string;
  relativePath: string;
};

function isPayload(v: unknown): v is Payload {
  return (
    isPlainRecord(v) &&
    typeof v.ok === "boolean" &&
    typeof v.issueBody === "string" &&
    typeof v.issueTitle === "string" &&
    typeof v.packagePath === "string" &&
    typeof v.packageName === "string"
  );
}

function packageDirs(): Array<string> {
  try {
    return fs.readdirSync(exportDir).filter((name) => name.startsWith("feedback-"));
  } catch {
    return [];
  }
}

beforeEach(() => {
  authed = true;
  fs.rmSync(exportDir, { recursive: true, force: true });
  fs.writeFileSync(fakeZip, "zip-placeholder");
});

afterEach(() => {
  fs.rmSync(exportDir, { recursive: true, force: true });
});

describe("/api/feedback/export", () => {
  it("落盘反馈包：issue.md 含标题与正文，文件名由服务端自造", async () => {
    const res = await post(draft());
    expect(res.status).toBe(200);
    const data: unknown = await res.json();
    if (!isPayload(data)) {
      throw new Error(`响应形状不符：${JSON.stringify(data)}`);
    }
    expect(data.ok).toBe(true);
    expect(data.packageName).toMatch(/^feedback-\d{8}-\d{6}-\d{3}$/);
    expect(data.issueTitle).toContain("[运行反馈]");
    expect(data.issueBody).toContain("点了生成没反应");
    const dirs = packageDirs();
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toBe(data.packageName);
    const issueMd = fs.readFileSync(path.join(exportDir, data.packageName, "issue.md"), "utf8");
    expect(issueMd).toContain(data.issueTitle);
    expect(issueMd).toContain(data.issueBody);
  });

  it("截图按序号写成图片文件，张数回给界面", async () => {
    const res = await post(
      draft({
        images: [
          { dataUrl: PNG, name: "shot.png" },
          { dataUrl: PNG, name: "shot2.png" },
        ],
      }),
    );
    const data: unknown = await res.json();
    if (!isPayload(data)) {
      throw new Error("响应形状不符");
    }
    expect(data.imageCount).toBe(2);
    expect(fs.readdirSync(path.join(exportDir, data.packageName, "images")).sort()).toEqual([
      "01.png",
      "02.png",
    ]);
  });

  it("不放行的图片类型（svg）拒收，且不落半个包", async () => {
    const svg = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
    const res = await post(draft({ images: [{ dataUrl: svg, name: "x.svg" }] }));
    expect(res.status).toBe(400);
    expect(packageDirs()).toHaveLength(0);
  });

  it("描述为空 / 超限时如实 400，不落盘", async () => {
    expect((await post(draft({ description: "  " }))).status).toBe(400);
    expect((await post(draft({ description: "x".repeat(8001) }))).status).toBe(400);
    expect(packageDirs()).toHaveLength(0);
  });

  it("打开诊断开关时把 zip 复制进 diagnostics/", async () => {
    const res = await post(draft({ includeDiagnostics: true }));
    const data: unknown = await res.json();
    if (!isPayload(data)) {
      throw new Error("响应形状不符");
    }
    expect(data.diagnosticsIncluded).toBe(true);
    expect(fs.readdirSync(path.join(exportDir, data.packageName, "diagnostics"))).toContain(
      "diagnostics.zip",
    );
  });

  it("未登录不落盘", async () => {
    authed = false;
    const res = await post(draft());
    expect(res.status).toBe(401);
    expect(packageDirs()).toHaveLength(0);
  });
});
