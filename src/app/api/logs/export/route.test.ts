/**
 * /api/logs/export 的落盘契约（ISSUE #609 反馈第 3 条）：服务端把面板文本写进 `log/exports/`
 * 并回路径（桌面壳里浏览器下载不一定落盘）。钉三条：成功回 ok + 绝对/相对路径 + 字节数且内容一致；
 * **文件名由服务端生成**（客户端只给白名单标签，否则就是任意路径写入漏洞）；空/超大内容如实报错不落盘。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "log-export-"));
const exportDir = path.join(tmp, "exports");

/* 全部日志路径落到本用例自己的临时目录：`log/` 在 .gitignore 里，CI / 干净检出
 * 上根本不存在（若不隔离，用例会往仓库里写字，或按环境不同得到不同结果）。 */
vi.mock("~/lib/log/log-paths", async () => {
  const actual = await vi.importActual("~/lib/log/log-paths");
  return {
    /* SAFETY: 类型断言已复核 */
    ...(actual as Record<string, unknown>),
    LOG_ROOT: tmp,
    LOG_EXPORT_DIR: exportDir,
  };
});

/* 鉴权在单机模式下会回落演示用户（要读库），这里直接放行：本用例断言的是
 * 落盘契约，不是鉴权（鉴权由 requireRequestUser 自身覆盖）。 */
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: () => ({
    id: "u1",
    email: "t@example.com",
    name: null,
  }),
}));

const { POST } = await import("./route");

function exportFiles(): Array<string> {
  try {
    return fs.readdirSync(exportDir);
  } catch {
    return [];
  }
}

beforeEach(() => {
  fs.rmSync(exportDir, { recursive: true, force: true });
});

afterEach(() => {
  fs.rmSync(exportDir, { recursive: true, force: true });
});

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/logs/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("/api/logs/export", () => {
  it("把内容写进 log/exports/ 并回绝对路径与相对路径", async () => {
    const res = await post({ label: "app-runtime", content: "第一行\n第二行" });
    expect(res.status).toBe(200);
    /* SAFETY: 类型断言已复核 */
    const data = (await res.json()) as {
      bytes: number;
      ok: boolean;
      path: string;
      relativePath: string;
    };
    expect(data.ok).toBe(true);
    expect(data.relativePath.startsWith("exports/")).toBe(true);
    expect(fs.readFileSync(data.path, "utf8")).toBe("第一行\n第二行");
    expect(data.bytes).toBeGreaterThan(0);
  });

  it("文件名由服务端生成：非白名单标签退化为 all，路径不被客户端左右", async () => {
    const res = await post({
      label: "../../../evil",
      content: "x",
    });
    /* SAFETY: 类型断言已复核 */
    const data = (await res.json()) as {
      path: string;
    };
    expect(path.dirname(data.path)).toBe(exportDir);
    expect(path.basename(data.path).startsWith("logs-all-")).toBe(true);
  });

  it("空内容不落盘，如实报 400", async () => {
    const res = await post({ label: "all", content: "" });
    expect(res.status).toBe(400);
    expect(exportFiles()).toHaveLength(0);
  });

  it("超大内容不落盘，如实报 413", async () => {
    const res = await post({
      label: "all",
      content: "x".repeat(9 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
    expect(exportFiles()).toHaveLength(0);
  });
});
