/**
 * `/api/custom-nodes/manifest` 的闸门与三相出口 —— 浏览器侧注册表**唯一**的灌入源。
 *
 * 这条链的事故形状很特别：handler 在基线迁移时被删掉，而客户端那两句 `fetch`
 * 活着留了下来，于是 `if (!res.ok) return 0` 每天命中 404，注册表恒空、
 * 预览卡恒空，界面上没有任何一处说「清单没拿到」（台账 E9）。所以这里的断言
 * 不只测状态码，还钉住「哪一档该说话、哪一档该安静」—— 客户端正是靠这个
 * 区分决定要不要往控制台写错误。
 *
 * mock 边界：`~/server/auth/request-user`（鉴权两态）、
 * `~/lib/comfyui/custom-nodes-manifest.server`（读盘三相；那一层自己的
 * errno→相 映射由 `custom-nodes-manifest.server.test.ts` 真读盘判，
 * 这里只判「相 → HTTP」这一跳，所以桩件给的是相本身而不是文件系统）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { userMock, readMock, pathMock } = vi.hoisted(() => ({
  userMock: vi.fn<() => Promise<{ id: string } | null>>(),
  readMock: vi.fn(),
  pathMock: vi.fn(() => "C:\\repo\\src\\generated\\customNodes.manifest.json"),
}));

vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: userMock,
}));
vi.mock("~/lib/comfyui/custom-nodes-manifest.server", () => ({
  readCustomNodesManifest: readMock,
  customNodesManifestPath: pathMock,
}));

import { GET, dynamic, runtime } from "./route";

beforeEach(() => {
  userMock.mockReset();
  userMock.mockResolvedValue({ id: "user-a" });
  readMock.mockReset();
});

describe("会话闸 —— 拒绝必须发生在读盘之前", () => {
  it("未登录 → 401，且一次磁盘都没碰", async () => {
    userMock.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      error: { code: "auth.required" },
    });
    expect(readMock).not.toHaveBeenCalled();
  });

  /* 清单里带 `packages[*].path` 与 `sources`：本机绝对路径 + 装了哪些包，
   * 那就是一份机器画像。口径同产物读取口（台账 A13 那一族）——
   * 响应取决于「你是谁」就不许公开，`public` 等于让共享缓存代读。 */
  it("成功响应是 private：共享缓存不能替别人留一份画像", async () => {
    readMock.mockReturnValue({ kind: "ok", text: "{}", stamp: "2:1" });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("private");
  });
});

describe("三相比两相：404 与 500 是两件事", () => {
  it("missing → 404 + 稳定码 custom_nodes.manifest_missing", async () => {
    readMock.mockReturnValue({ kind: "missing" });
    const res = await GET();
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("custom_nodes.manifest_missing");
    // 话里要能行动：告诉用户去哪儿生成，而不是只说「不存在」
    expect(body.error.message).toContain("解析");
  });

  it("unreadable → 500 + custom_nodes.manifest_unreadable，并带上 errno", async () => {
    readMock.mockReturnValue({ kind: "unreadable", detail: "EISDIR" });
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("custom_nodes.manifest_unreadable");
    expect(body.error.message).toContain("EISDIR");
  });

  it("两相的码互不相同：客户端按码分档说话，混了就等于没分", async () => {
    readMock.mockReturnValue({ kind: "missing" });
    const missing = (await (await GET()).json()) as { error: { code: string } };
    readMock.mockReturnValue({ kind: "unreadable", detail: "EACCES" });
    const unreadable = (await (await GET()).json()) as {
      error: { code: string };
    };
    expect(missing.error.code).not.toBe(unreadable.error.code);
  });

  it("缺清单时不回 200 + 空对象 —— 那是把 0 冒充成「解析出 0 个」", async () => {
    readMock.mockReturnValue({ kind: "missing" });
    const res = await GET();
    expect(res.status).not.toBe(200);
  });
});

describe("成功路径：原文直出，不经第二轮解析", () => {
  it("200 + 原文逐字 + application/json", async () => {
    const text = '{"nodes":{"KSampler":{"displayName":"K 采样器"}}}';
    readMock.mockReturnValue({ kind: "ok", text, stamp: "123:456" });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(text);
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });

  /* `no-store` 是这条链正确性的一部分：解析器写完文件后客户端立刻重取，
   * 任何一条中间缓存把旧清单当成新答案，复现的就是本次事故的形状（恒空 / 恒旧）。
   * 摘要端点用 (size, mtime) 指纹做服务端短路缓存是安全的，那份思路搬到这里不安全。 */
  it("Cache-Control 精确是 `private, no-store`，不许退化成 max-age", async () => {
    readMock.mockReturnValue({ kind: "ok", text: "{}", stamp: null });
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Cache-Control")).not.toMatch(/max-age/);
  });

  it("指纹为 null 的一次读取照样回原文：能不能进缓存是调用方的事", async () => {
    // 反证：handler 若拿 stamp 当「读到没读到」的判据，这一格会被误判成故障。
    readMock.mockReturnValue({ kind: "ok", text: '{"nodes":{}}', stamp: null });
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("空清单（解析器一个节点都没找到）回的是原文，不是 404", async () => {
    // 「解析出 0 个」是合法结果；把它回成 404 就把它并回了「还没解析过」。
    readMock.mockReturnValue({
      kind: "ok",
      text: '{"nodes":{}}',
      stamp: "11:1",
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"nodes":{}}');
  });
});

describe("构建期取数口径", () => {
  it("每次请求真读盘：runtime=nodejs、dynamic=force-dynamic", async () => {
    // 少了这两行，Next 可以把清单烘成静态响应 —— 于是「解析完不重进页面就不更新」
    // 会以另一种形态回来，而且这一次连 fetch 都是 200。
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });

  it("两次请求各读一次盘（没有隐藏的模块级缓存）", async () => {
    readMock.mockReturnValue({ kind: "ok", text: "{}", stamp: "2:1" });
    await GET();
    await GET();
    expect(readMock).toHaveBeenCalledTimes(2);
  });
});
