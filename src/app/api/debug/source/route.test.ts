/**
 * `GET /api/debug/source?file=…` —— 画布调试模式读源码端点的边界。
 *
 * 这是一个「按调用方给的路径读项目内文件」的端点，所以它的正确性**全部**落在闸门上：
 *   · 未登录不读盘（401 走 `~/server/lib/error-response` 的唯一信封形态，不在这里手抄
 *     `{ error: { code: "auth.required" … } }` —— 那是 §10.9 与 ISSUE #573 收过一次的形状）；
 *   · 缺参数 / 含 NUL / 扩展名不在白名单 → 400，且**各自是不同的原因**，不能糊成一句；
 *   · 逃出 `src/` → 403。这里最有价值的一条是 `<项目根>/.env`：它**在项目里**，
 *     唯一挡住它的是「必须落在 src 下」这一条 containment，而不是 `../` 检查；
 *   · 读不到 → 404，不把 fs 原文回出去。
 *
 * NUL 那条另有一层：源码里嵌一个真 NUL 会让整份文件被 git/diff/grep 判成二进制
 * （AGENTS 硬规则 19 / §12.11），所以这个端点收到带 NUL 的 query 时必须显式拒，
 * 而不是让它进到 `path.resolve` 里。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireRequestUser, readFile, stat } = vi.hoisted(() => ({
  requireRequestUser: vi.fn<() => Promise<{ id: string } | null>>(),
  readFile: vi.fn<(p: string) => Promise<string>>(),
  stat: vi.fn<(p: string) => Promise<{ size: number; mtime: Date }>>(),
}));

vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: () => requireRequestUser(),
}));

vi.mock("fs", () => ({
  promises: {
    readFile: (p: string) => readFile(p),
    stat: (p: string) => stat(p),
  },
}));

const LOGGED_IN = { id: "u-1" };

function requestWith(file: string | null): NextRequest {
  const url = new URL("http://x/api/debug/source");
  if (file !== null) url.searchParams.set("file", file);
  return new NextRequest(url);
}

beforeEach(() => {
  requireRequestUser.mockReset();
  requireRequestUser.mockResolvedValue(LOGGED_IN);
  readFile.mockReset();
  stat.mockReset();
});

describe("GET /api/debug/source", () => {
  it("未登录 → 401（唯一信封形态）且一次都不读盘", async () => {
    requireRequestUser.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(requestWith("src/app/page.tsx"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: { code: "auth.required", message: "未登录或会话已失效" },
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  it("缺 file 参数 → 400 且原因是「缺参数」", async () => {
    const { GET } = await import("./route");
    const res = await GET(requestWith(null));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "missing file param" });
  });

  it("参数含 NUL → 400，不进 path.resolve", async () => {
    const { GET } = await import("./route");
    const res = await GET(requestWith("src/app/page.tsx\0.png"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid file param" });
    expect(readFile).not.toHaveBeenCalled();
  });

  it("用 ../ 逃出 src/ → 403", async () => {
    const { GET } = await import("./route");
    const res = await GET(requestWith("../README.md"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "forbidden: outside src/",
    });
  });

  it("项目根内的 .env 也读不到（挡它的是 src 包含判据，不是 ../ 检查）", async () => {
    // 密钥文件与 src 同在项目内 —— 只写「不许有 ..」的实现会把它交出去。
    const { GET } = await import("./route");
    const res = await GET(requestWith("../.env"));
    expect(res.status).toBe(403);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("绝对路径 → 403（跨平台：relative 变绝对也算逃出）", async () => {
    const outside =
      process.platform === "win32" ? "C:/Windows/win.ini" : "/etc/passwd";
    const { GET } = await import("./route");
    const res = await GET(requestWith(outside));
    expect(res.status).toBe(403);
  });

  it("白名单外的扩展名 → 400，且原因说清是「不是源码」", async () => {
    const { GET } = await import("./route");
    const res = await GET(requestWith("src/assets/blob.exe"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "not a source file" });
    expect(readFile).not.toHaveBeenCalled();
  });

  it("白名单内的源码文件 → 200，回相对显示路径 + 可打开的绝对路径 + 内容", async () => {
    readFile.mockResolvedValueOnce("export const x = 1;");
    const mtime = new Date("2026-01-02T03:04:05.000Z");
    stat.mockResolvedValueOnce({ size: 19, mtime });
    const { GET } = await import("./route");
    const res = await GET(requestWith("src/lib/clamp.ts"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string | number>;
    expect(body.content).toBe("export const x = 1;");
    expect(body.size).toBe(19);
    expect(body.modifiedAt).toBe(mtime.toISOString());
    // 两个路径字段的分工：一个给人看（相对），一个给 vscode:// 协议用（绝对、正斜杠）。
    expect(String(body.file).replace(/\\/g, "/")).toBe("src/lib/clamp.ts");
    expect(String(body.absolutePath).replace(/\\/g, "/")).toContain(
      "/src/lib/clamp.ts",
    );
  });

  it("文件不存在 → 404，不把 fs 的错误原文回出去", async () => {
    readFile.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT: no such file or directory, open 'x'"), {
        code: "ENOENT",
      }),
    );
    const { GET } = await import("./route");
    const res = await GET(requestWith("src/lib/does-not-exist.ts"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("file not found");
    expect(body.error).not.toContain("ENOENT");
  });
});
