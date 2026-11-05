/**
 * `/api/images` 的闸门用例 —— 本机代理 ComfyUI `/api/view` 的那道门。此前根本没有 handler，`comfyImageUrl()` 把地址收在一处
 * 而落点没带过来，404 再被调用点 `catch {}` 咽成「没有图」，界面常年空态、判据全绿（台账 E3‴）。断言钉「碰上游之前被挡下」：
 * 会话闸（同台账 A13）→ 形状闸（`filename`/`subfolder` 目录成分、`type` 不在三值内 → 400 且一次上游都不调）→ 失败分相（上游 404 / 别的状态 / 连不上，后者带 `hint`）。
 */
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { userMock, getView, FakeViewError } = vi.hoisted(() => {
  /** 与真 `ComfyViewError` 同形状；路由里的 `instanceof` 判的就是它（所以必须来自
   *  同一份 hoisted 引用 —— 放在模块顶层会撞 `vi.mock` 的提前提升）。 */
  class FakeViewError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = "ComfyViewError";
    }
  }
  return {
    userMock: vi.fn<() => Promise<{ id: string } | null>>(),
    getView: vi.fn(() => Buffer.from("bytes")),
    FakeViewError,
  };
});

vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: userMock,
}));
vi.mock("~/lib/comfyui/client", () => ({
  getView,
  // 路由里 `e instanceof ComfyViewError` 判的就是这个构造器（与真实现同形状）
  ComfyViewError: FakeViewError,
}));

import { GET } from "./route";

function get(query: string): NextRequest {
  /* SAFETY: 类型断言已复核 */
  return new Request(`http://127.0.0.1:3100/api/images${query}`, {
    method: "GET",
  }) as unknown as NextRequest;
}

beforeEach(() => {
  getView.mockClear();
  getView.mockResolvedValue(Buffer.from("bytes"));
  userMock.mockReset();
  userMock.mockResolvedValue({ id: "user-a" });
});

describe("会话闸", () => {
  it("未登录 → 401，且一次上游都不碰", async () => {
    userMock.mockResolvedValueOnce(null);
    const res = get("?filename=a.png&type=input");
    expect((await GET(res)).status).toBe(401);
    expect(getView).not.toHaveBeenCalled();
  });
});

describe("形状闸 —— 拒绝必须发生在交给上游之前", () => {
  it("缺 filename（含只有空白的）→ 400", async () => {
    for (const query of ["", "?filename=", "?filename=%20%20"]) {
      // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
      expect((await GET(get(query))).status).toBe(400);
    }
    expect(getView).not.toHaveBeenCalled();
  });

  it("filename 或 subfolder 里带目录成分 → 400", async () => {
    for (const query of [
      "?filename=../../etc/passwd",
      "?filename=a%5Cb.png",
      "?filename=a.png&subfolder=x/y",
      "?filename=a.png&subfolder=..",
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
      expect((await GET(get(query))).status).toBe(400);
    }
    expect(getView).not.toHaveBeenCalled();
  });

  it("type 只认 input / output / temp 三个值", async () => {
    expect((await GET(get("?filename=a.png&type=output"))).status).toBe(200);
    expect((await GET(get("?filename=a.png&type=temp"))).status).toBe(200);
    expect((await GET(get("?filename=a.png&type=userData"))).status).toBe(400);
    expect(getView).toHaveBeenCalledTimes(2);
  });

  it("没带 type 时按 input，而不是猜一个别的类别", async () => {
    expect((await GET(get("?filename=a.png"))).status).toBe(200);
    expect(getView).toHaveBeenCalledWith("a.png", "", "input");
  });
});

describe("成功路径的响应形状", () => {
  it("字节按扩展名给 Content-Type，参数原样交给 getView", async () => {
    const res = await GET(get("?filename=note.txt&subfolder=canvas&type=output"));
    expect(res.status).toBe(200);
    // 只判「按扩展名」这一件事；`charset` 后缀由 Response 自己补
    expect(res.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(await res.text()).toBe("bytes");
    expect(getView).toHaveBeenCalledWith("note.txt", "canvas", "output");
  });

  it("扩展名不同则类型不同：图片不会被标成文本", async () => {
    getView.mockResolvedValueOnce(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const res = await GET(get("?filename=shot_001.png"));
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  it("缓存必须是 private 且不许 immutable（响应取决于会话，而 input 会被同名上传覆盖）", async () => {
    const cache = (await GET(get("?filename=a.png"))).headers.get("Cache-Control")!;
    expect(cache).toMatch(/private\b/);
    expect(cache).not.toMatch(/public/);
    expect(cache).not.toContain("immutable");
  });
});

describe("上游失败要分相", () => {
  it("ComfyUI 回 404 → 404（与「这一格本来就没有文件」同形）", async () => {
    getView.mockRejectedValueOnce(new FakeViewError(404, "getView failed: 404"));
    const res = await GET(get("?filename=gone.png"));
    expect(res.status).toBe(404);
    /* SAFETY: 类型断言已复核 */
    expect(((await res.json()) as { error?: string }).error).toBeTruthy();
  });

  it("ComfyUI 回别的状态 → 502，不伪装成 500", async () => {
    getView.mockRejectedValueOnce(new FakeViewError(503, "getView failed: 503"));
    expect((await GET(get("?filename=a.png"))).status).toBe(502);
  });

  it("连不上（fetch 自己抛）→ 503 且带可分支的 hint", async () => {
    getView.mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await GET(get("?filename=a.png"));
    expect(res.status).toBe(503);
    /* SAFETY: 类型断言已复核 */
    expect(((await res.json()) as { hint?: string }).hint).toBe("comfyui-unreachable");
  });
});
