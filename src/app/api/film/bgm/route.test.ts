/**
 * `/api/film/bgm` 上传口的闸门用例（这条此前**零执行者**）。
 *
 * 为什么值得为它写：它是唯一「把用户给的文件直接写进产物根」的 REST 口，
 * 而本批把它的落点从第五份手写的 `public/generated/films/bgm` 换成了
 * `filmBgmRoot()`。断言里刻意把 `process.cwd()` 顶到临时目录 ——
 * 谁再手写一份落点，就会写到临时目录之外，当场看得见（台账 A8 第二段）。
 *
 * mock 边界：`fs`（内存假象，写与 mkdir 的调用都记下来 —— 「拒绝发生在落盘之前」
 * 是要断言的事）、`~/server/auth/request-user`（鉴权两态）。
 */
import type { NextRequest } from "next/server";
import path from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { userMock, writes } = vi.hoisted(() => ({
  userMock: vi.fn<() => Promise<{ id: string } | null>>(),
  writes: { mkdir: [] as string[], writeFile: [] as string[] },
}));

vi.mock("fs", () => ({
  promises: {
    mkdir: async (dir: string) => {
      writes.mkdir.push(dir);
    },
    writeFile: async (file: string) => {
      writes.writeFile.push(file);
    },
  },
}));
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: userMock,
}));

import { POST } from "./route";
import { filmBgmRoot } from "~/lib/media/output-paths";

const TMP = path.resolve(path.sep + "bgm-test-root");
const cwdSpy = vi.spyOn(process, "cwd");

beforeEach(() => {
  writes.mkdir.length = 0;
  writes.writeFile.length = 0;
  userMock.mockResolvedValue({ id: "user-a" });
  cwdSpy.mockReturnValue(TMP);
});

afterEach(() => {
  cwdSpy.mockClear();
});

/** handler 只要 `formData()`，用真 Request 顶替 NextRequest。 */
function reqWith(form: FormData): NextRequest {
  return new Request("http://localhost/api/film/bgm", {
    method: "POST",
    body: form,
  }) as unknown as NextRequest;
}

function audioForm(name: string, type: string, bytes = "ID3"): FormData {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type }));
  return form;
}

describe("POST /api/film/bgm", () => {
  it("成功的落点由 filmBgmRoot() 派生：文件名带 bgm- 前缀，后缀不重复", async () => {
    const res = await POST(reqWith(audioForm("主题曲.mp3", "audio/mpeg")));
    expect(res.status).toBe(200);
    const { name } = (await res.json()) as { name: string };
    expect(writes.mkdir).toEqual([
      path.join(TMP, "public", "generated", "films", "bgm"),
    ]);
    expect(writes.writeFile).toEqual([path.join(filmBgmRoot(), name)]);
    expect(name).toMatch(/^bgm-[0-9a-z-]+_主题曲\.mp3$/);
  });

  it("无会话 → 401，且一次都不碰磁盘", async () => {
    userMock.mockResolvedValue(null);
    const res = await POST(reqWith(audioForm("a.mp3", "audio/mpeg")));
    expect(res.status).toBe(401);
    expect(writes.writeFile).toEqual([]);
  });

  it("白名单外的类型 → 400，且不落盘", async () => {
    const res = await POST(
      reqWith(audioForm("evil.exe", "application/x-msdownload")),
    );
    expect(res.status).toBe(400);
    expect(writes.writeFile).toEqual([]);
  });

  it("file 字段缺失或不是文件 → 400", async () => {
    const empty = new FormData();
    empty.set("note", "hello");
    expect((await POST(reqWith(empty))).status).toBe(400);
  });

  it("请求体不是 multipart → 400「表单解析失败」", async () => {
    const req = new Request("http://localhost/api/film/bgm", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not-a-form",
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "表单解析失败",
    });
  });
});
