/**
 * `PUT /api/size-presets/project-default` 的边界契约（ISSUE #3948）。
 *
 * 这一格判的是**「保存到项目代码库」这件事的对外形状**：① 未登录按其余 REST 面
 * 同一道闸回 401（不碰落盘）；② 落盘那一步交给服务端那一层（`saveSizePresetTableAsProjectDefaults`），
 * 这一格只把它的结果原样回给界面；③ 落盘失败回 500 + 可读文案（不假装成功）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireRequestUser, saveAsProjectDefaults } = vi.hoisted(() => ({
  requireRequestUser: vi.fn<() => Promise<{ id: string } | null>>(),
  saveAsProjectDefaults: vi.fn<(raw: unknown) => Promise<{ file: string; table: unknown }>>(),
}));

vi.mock("~/server/auth/request-user", () => ({ requireRequestUser }));
vi.mock("~/lib/media/size-preset.server", () => ({
  saveSizePresetTableAsProjectDefaults: saveAsProjectDefaults,
}));

import { PUT } from "./route";

function body(raw: unknown): NextRequest {
  return new NextRequest("http://x/api/size-presets/project-default", {
    body: JSON.stringify(raw),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

beforeEach(() => {
  requireRequestUser.mockReset().mockResolvedValue({ id: "user-a" });
  saveAsProjectDefaults.mockReset().mockResolvedValue({ file: "src/lib/media/x.json", table: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("「保存到项目代码库」端点", () => {
  it("未登录 → 401，且不碰落盘", async () => {
    requireRequestUser.mockResolvedValue(null);
    const res = await PUT(body({ image: {} }));
    expect(res.status).toBe(401);
    expect(saveAsProjectDefaults).not.toHaveBeenCalled();
  });

  it("登录后把整份表交给服务端那一层，并把写盘路径回给界面", async () => {
    const res = await PUT(body({ image: { "16:9 横屏": { "1k": { width: 1280, height: 720 } } } }));
    expect(res.status).toBe(200);
    expect(saveAsProjectDefaults).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ file: "src/lib/media/x.json" });
  });

  it("落盘失败 → 500 + 可读文案（不假装成功）", async () => {
    saveAsProjectDefaults.mockRejectedValue(new Error("只读文件系统"));
    const res = await PUT(body({ image: {} }));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("只读文件系统");
  });
});
