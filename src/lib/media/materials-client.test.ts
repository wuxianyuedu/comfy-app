// @vitest-environment jsdom
// 素材库客户端：响应收窄与失败解析单测。后端改错误信封时这里会先红。

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteMaterial,
  fetchMaterials,
  readMaterialError,
  uploadMaterial,
} from "./materials-client";

function jsonResponse(
  body: unknown,
  ok = true,
  status = ok ? 200 : 400,
): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

/** 记录调用参数：URL 与 init 都按可选处理，避免 vi.fn() 的零元组签名报错。 */
function callArgs(fetchMock: ReturnType<typeof vi.fn>): {
  url: string;
  init?: RequestInit;
} {
  const first = fetchMock.mock.calls[0] ?? [];
  return {
    url: String(first[0] ?? ""),
    init: first[1] as RequestInit | undefined,
  };
}

function item(over: Record<string, unknown> = {}) {
  return {
    id: "scope/ref/a.png",
    name: "a.png",
    folder: "ref",
    folderName: "参考素材",
    kind: "image",
    url: "/api/generated/materials/scope/ref/a.png",
    size: 1024,
    updatedAt: "2026-01-01T00:00:00.000Z",
    scope: "scope",
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readMaterialError", () => {
  it("取字符串 error", () => {
    expect(readMaterialError({ error: "无权限" })).toBe("无权限");
  });

  it("无 error 字段返回 undefined（交调用方用状态码兜底）", () => {
    expect(readMaterialError({ items: [] })).toBeUndefined();
    expect(readMaterialError(null)).toBeUndefined();
  });
});

describe("fetchMaterials", () => {
  it("返回收窄后的 folders 与 items", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        folders: [{ id: "ref", name: "参考素材", count: 1 }],
        items: [item()],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchMaterials({ scope: "project", projectId: "p-1" });
    expect(res.folders).toEqual([{ id: "ref", name: "参考素材", count: 1 }]);
    expect(res.items).toHaveLength(1);

    const { url } = callArgs(fetchMock);
    expect(url).toContain("/api/materials?");
    expect(url).toContain("projectId=p-1");
    expect(url).toContain("scope=project");
  });

  it("搜索优先于 folder：有 q 时不带 folder 参数", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ folders: [], items: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await fetchMaterials({ scope: "cross", folder: "ref", q: "角色" });
    const { url } = callArgs(fetchMock);
    expect(url).toContain("q=");
    expect(url).not.toContain("folder=ref");
  });

  it("响应不 ok 时抛服务端文案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "无权限" }, false, 403)),
    );
    await expect(fetchMaterials({ scope: "project" })).rejects.toThrow(
      "无权限",
    );
  });

  it("响应不 ok 且无 error 字段时用状态码兜底", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, false, 500)),
    );
    await expect(fetchMaterials({ scope: "project" })).rejects.toThrow(
      "请求失败 (500)",
    );
  });

  it("丢弃形状不符的条目，不把脏数据喂给视图", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          folders: [{ id: "ref" }],
          items: [item(), { id: "bad" }, "nope"],
        }),
      ),
    );
    const res = await fetchMaterials({ scope: "project" });
    expect(res.items).toHaveLength(1);
    expect(res.folders).toEqual([]);
  });

  it("body 非 JSON 时按空对象处理，不二次抛错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("not json");
        },
      })),
    );
    await expect(fetchMaterials({ scope: "project" })).rejects.toThrow(
      "请求失败 (500)",
    );
  });
});

describe("uploadMaterial", () => {
  it("有 projectId 时传 projectId，无则传 shared=true", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await uploadMaterial(new File(["x"], "a.png"), {
      folder: "ref",
      projectId: "p-1",
    });
    const fd1 = callArgs(fetchMock).init?.body as FormData;
    expect(fd1.get("folder")).toBe("ref");
    expect(fd1.get("projectId")).toBe("p-1");
    expect(fd1.get("shared")).toBeNull();

    await uploadMaterial(new File(["x"], "b.png"), {
      folder: "ref",
      projectId: null,
    });
    const fd2 = (
      (fetchMock.mock.calls[1] as unknown[] | undefined)?.[1] as
        RequestInit | undefined
    )?.body as FormData;
    expect(fd2.get("shared")).toBe("true");
  });

  it("后端拒绝时抛出原因（不支持的文件类型等）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "不支持的文件类型" }, false)),
    );
    await expect(
      uploadMaterial(new File(["x"], "a.exe"), { folder: "ref" }),
    ).rejects.toThrow("不支持的文件类型");
  });
});

describe("deleteMaterial", () => {
  it("id 参与 URL 编码（含 / 的复合 id）", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await deleteMaterial("scope/ref/a b.png");
    const { url, init } = callArgs(fetchMock);
    expect(url).toContain(encodeURIComponent("scope/ref/a b.png"));
    expect(init?.method).toBe("DELETE");
  });

  it("失败时抛出服务端文案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "删除失败：文件被占用" }, false)),
    );
    await expect(deleteMaterial("x")).rejects.toThrow("删除失败：文件被占用");
  });
});
