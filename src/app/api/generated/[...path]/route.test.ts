/**
 * `GET /api/generated/[...path]` —— 任务产物文件流的契约。
 *
 * 这个端点把 `public/generated/<taskId>/<file>` 按 `/api/generated/...` 前缀吐出去，
 * 是**任意路径读取**的入口，所以它的价值全在边界上，而边界此前一条用例都没有：
 *
 *   · 穿越出根目录必须 403（`../` 与兄弟目录前缀碰撞是两种不同形状，分开验）；
 *   · 读不到（含「指到目录」）必须 404，而不是把 EISDIR/EACCES 的原文抛成 500；
 *   · 命中时 `Content-Type` 走唯一出口 `contentTypeForPath`（不是自己 `switch` 一遍），
 *     且带 `immutable` 长缓存 —— 产物按 taskId 一次性写入，这个承诺是前端敢缓存的依据。
 *
 * 兄弟目录那条（`generated-evil`）是这里最容易被「顺手简化」掉的一档：判据写成
 * `abs.startsWith(root)` 也能挡住 `../../etc/passwd`，看起来没坏，但会把
 * `<root>-evil/...` 一起放行。代码里那个 `+ path.sep` 就是为它存在的。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }));

vi.mock("fs", () => ({
  promises: { readFile },
}));

const ROOT = process.cwd();
const generatedRoot = `${ROOT}/public/generated`.replace(/\\/g, "/");

/** 把平台分隔符统一成正斜杠再比 —— 断言的是语义，不是 path.sep 的形状。 */
function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

function paramsOf(path: string[] | undefined) {
  return { params: Promise.resolve({ path }) };
}

beforeEach(() => {
  readFile.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/generated/[...path]", () => {
  it("没有路径段时 404，不去读根目录", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://x/api/generated"),
      paramsOf(undefined),
    );
    expect(res.status).toBe(404);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("穿越出 public/generated → 403 且不读盘", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://x/api/generated/x"),
      paramsOf(["..", "..", "..", "etc", "passwd"]),
    );
    expect(res.status).toBe(403);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("兄弟目录前缀碰撞（generated-evil）也必须 403", async () => {
    // 只写 `startsWith(root)` 的实现在这条上会放行 —— 它挡住了 `../`，
    // 却把 `<root>-evil/…` 当成「还在根里」。
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://x/api/generated/x"),
      paramsOf(["..", "generated-evil", "secret.png"]),
    );
    expect(res.status).toBe(403);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("路径段解析回根目录本身时不去读目录（404，不是 500）", async () => {
    readFile.mockRejectedValueOnce(
      Object.assign(new Error("EISDIR: illegal operation on a directory"), {
        code: "EISDIR",
      }),
    );
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://x/api/generated/."),
      paramsOf(["."]),
    );
    expect(res.status).toBe(404);
    const text = await res.text();
    // 不把 fs 的错误原文回给用户（规范 §10：不泄露内部细节）。
    expect(text).not.toContain("EISDIR");
  });

  it("文件不存在 → 404", async () => {
    readFile.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }),
    );
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://x/api/generated/t1/gone.png"),
      paramsOf(["t1", "gone.png"]),
    );
    expect(res.status).toBe(404);
  });

  it("命中时回字节流 + 由唯一出口决定的 Content-Type + immutable 长缓存", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    readFile.mockResolvedValueOnce(Buffer.from(bytes));
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://x/api/generated/t1/a.png"),
      paramsOf(["t1", "a.png"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    // 读的是根目录内的那个文件，不是别处。
    expect(normalize(readFile.mock.calls[0]?.[0] as string)).toBe(
      `${generatedRoot}/t1/a.png`,
    );
  });

  it("未知扩展名不裸奔：Content-Type 走兜底而不是留空", async () => {
    readFile.mockResolvedValueOnce(Buffer.from("x"));
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://x/api/generated/t1/blob.weird"),
      paramsOf(["t1", "blob.weird"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBeTruthy();
  });
});
