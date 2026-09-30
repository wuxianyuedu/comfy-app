/**
 * `GET /api/generated/[...path]` —— 任务产物文件流的契约。
 *
 * 这个端点把 `public/generated/<taskId>/<file>` 按 `/api/generated/...` 前缀吐出去，
 * 是**任意路径读取**的入口，所以它的价值全在边界上：
 *
 *   · 没有会话（`loginRequired` 开着时）必须 401，且一次都不读盘；
 *   · 穿越出根目录必须 403（`../` 与兄弟目录前缀碰撞是两种不同形状，分开验）；
 *   · **属于别人的产物必须 404**（与「文件不存在」同形），且判定发生在 `readFile` 之前
 *     —— 这里测的是「路由没有绕开 `~/lib/media/output-access` 那道闸」，
 *     闸本身的判据由它自己的单测管（两层各判各的，才不会两边都以为自己测过了）；
 *   · 读不到（含「指到目录」）必须 404，而不是把 EISDIR/EACCES 的原文抛成 500；
 *   · 命中时 `Content-Type` 走唯一出口 `contentTypeForPath`（不是自己 `switch` 一遍），
 *     长缓存必须是 `private` + `immutable` —— 产物按 taskId 一次性写入所以敢长缓存，
 *     但标 `public` 等于允许共享缓存把 A 的产物回给 B，那会让归属闸只剩形式。
 *
 * 兄弟目录那条（`generated-evil`）是这里最容易被「顺手简化」掉的一档：判据写成
 * `abs.startsWith(root)` 也能挡住 `../../etc/passwd`，看起来没坏，但会把
 * `<root>-evil/...` 一起放行。代码里那个 `+ path.sep` 就是为它存在的。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readFile, userMock, loginRequiredMock, foreignMock } = vi.hoisted(
  () => ({
    readFile: vi.fn(),
    userMock: vi.fn<() => Promise<{ id: string } | null>>(),
    loginRequiredMock: vi.fn<() => boolean>(() => false),
    foreignMock: vi.fn<
      (segments: string[], userId: string) => Promise<boolean>
    >(async () => false),
  }),
);

vi.mock("fs", () => ({
  promises: { readFile },
}));
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: userMock,
}));
vi.mock("~/lib/app-settings/app-settings.server", () => ({
  getSettingsSync: () => ({ loginRequired: loginRequiredMock() }),
}));
vi.mock("~/lib/media/output-access", () => ({
  isForeignOwnedArtifact: foreignMock,
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

function get(path: string[] | undefined) {
  return import("./route").then(({ GET }) =>
    GET(new Request("http://x/api/generated") as never, paramsOf(path)),
  );
}

beforeEach(() => {
  readFile.mockReset();
  userMock.mockReset();
  loginRequiredMock.mockReset().mockReturnValue(false);
  foreignMock.mockReset().mockResolvedValue(false);
  userMock.mockResolvedValue({ id: "user-a" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/generated/[...path]", () => {
  it("没有路径段时 404，不去读根目录", async () => {
    const res = await get(undefined);
    expect(res.status).toBe(404);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("未登录（loginRequired 开着）→ 401，且不做归属判定、不读盘", async () => {
    loginRequiredMock.mockReturnValue(true);
    userMock.mockResolvedValueOnce(null);
    const res = await get(["t1", "a.png"]);
    expect(res.status).toBe(401);
    expect(foreignMock).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("穿越出 public/generated → 403 且不读盘", async () => {
    const res = await get(["..", "..", "..", "etc", "passwd"]);
    expect(res.status).toBe(403);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("兄弟目录前缀碰撞（generated-evil）也必须 403", async () => {
    // 只写 `startsWith(root)` 的实现在这条上会放行 —— 它挡住了 `../`，
    // 却把 `<root>-evil/…` 当成「还在根里」。
    const res = await get(["..", "generated-evil", "secret.png"]);
    expect(res.status).toBe(403);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("多用户模式：属于别人的产物 → 404（与「不存在」同形）且不去读那个文件", async () => {
    loginRequiredMock.mockReturnValue(true);
    foreignMock.mockResolvedValueOnce(true);
    const res = await get(["projects", "proj-b", "t9", "a.png"]);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expect(readFile).not.toHaveBeenCalled();
    // 判定拿的是解码后的路径片段 + 当前用户，不自己再解析一遍字符串
    expect(foreignMock).toHaveBeenCalledWith(
      ["projects", "proj-b", "t9", "a.png"],
      "user-a",
    );
  });

  it("多用户模式：不是别人的 → 正常读出字节", async () => {
    loginRequiredMock.mockReturnValue(true);
    readFile.mockResolvedValueOnce(Buffer.from([0x41]));
    const res = await get(["t1", "a.png"]);
    expect(res.status).toBe(200);
    expect(foreignMock).toHaveBeenCalledTimes(1);
  });

  it("单用户模式（默认）跳过归属判定 —— 那时人人都是同一个演示用户，判了只会误伤", async () => {
    readFile.mockResolvedValueOnce(Buffer.from([0x42]));
    const res = await get(["t1", "a.png"]);
    expect(res.status).toBe(200);
    expect(foreignMock).not.toHaveBeenCalled();
  });

  it("路径段解析回根目录本身时不去读目录（404，不是 500）", async () => {
    readFile.mockRejectedValueOnce(
      Object.assign(new Error("EISDIR: illegal operation on a directory"), {
        code: "EISDIR",
      }),
    );
    const res = await get(["."]);
    expect(res.status).toBe(404);
    const text = await res.text();
    // 不把 fs 的错误原文回给用户（规范 §10：不泄露内部细节）。
    expect(text).not.toContain("EISDIR");
  });

  it("文件不存在 → 404", async () => {
    readFile.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }),
    );
    expect((await get(["t1", "gone.png"])).status).toBe(404);
  });

  it("命中时回字节流 + 唯一出口决定的 Content-Type + private 长缓存", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    readFile.mockResolvedValueOnce(Buffer.from(bytes));
    const res = await get(["t1", "a.png"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const cache = res.headers.get("Cache-Control") ?? "";
    expect(cache).toContain("immutable");
    // 有归属判定之后还标 public，等于让共享缓存把 A 的产物回给 B
    expect(cache).toMatch(/^private\b/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    // 读的是根目录内的那个文件，不是别处。
    expect(normalize(readFile.mock.calls[0]?.[0] as string)).toBe(
      `${generatedRoot}/t1/a.png`,
    );
  });

  it("未知扩展名不裸奔：Content-Type 走兜底而不是留空", async () => {
    readFile.mockResolvedValueOnce(Buffer.from("x"));
    const res = await get(["t1", "blob.weird"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBeTruthy();
  });
});
