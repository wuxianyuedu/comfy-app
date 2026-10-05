/**
 * `GET /api/generated/[...path]` —— 任务产物文件流的契约。
 *
 * 这个端点把 `<产物根>/<taskId>/<file>` 按 `/api/generated/...` 前缀吐出去，
 * 是**任意路径读取**的入口，所以它的价值全在边界上：
 *
 *   · 没有会话（`loginRequired` 开着时）必须 401，且一次都不碰磁盘；
 *   · 穿越出根目录必须 403（`../` 与兄弟目录前缀碰撞是两种不同形状，分开验）；
 *   · **属于别人的产物必须 404**（与「文件不存在」同形），且判定发生在 `stat`/`open` 之前
 *     —— 这里测的是「路由没有绕开 `~/lib/media/output-access` 那道闸」，
 *     闸本身的判据由它自己的单测管（两层各判各的，才不会两边都以为自己测过了）；
 *   · **带 `Range` 也一样过闸**：分段请求是新加的一条读盘路径，必须复用同一串判定，
 *     而不是在「读哪一段」那层再长出一套权限逻辑；
 *   · 读不到（含「指到目录」）必须 404，而不是把 EISDIR/EACCES 的原文抛成 500；
 *   · 命中时 `Content-Type` 走唯一出口 `contentTypeForPath`（不是自己 `switch` 一遍），
 *     长缓存必须是 `private` + `immutable`，并且要有 `Accept-Ranges: bytes`；
 *   · `Range` 三种结论各有状态码：206（带 `Content-Range`）、416（只写总长）、
 *     不认识的形状 → 忽略并回整份 200。形状本身在 `range-request.test.ts` 判，
 *     这里只判「翻成响应那一步对不对」，其中最要紧的一条是**只读要的那一段**
 *     —— 否则「拖进度条」= 整份成片读进内存，这条支持就白做。
 *
 * 兄弟目录那条（`generated-evil`）是这里最容易被「顺手简化」掉的一档：判据写成
 * `abs.startsWith(root)` 也能挡住 `../../etc/passwd`，看起来没坏，但会把
 * `<root>-evil/…` 一起放行。代码里那个 `+ path.sep` 就是为它存在的。
 *
 * mock 边界：`fs`（`stat` + `open` 两份假象，**读的位置与长度都记下来** ——
 * 「只读那一段」与「一次都没打开」都是要断言的事）、`~/server/auth/request-user`
 * （鉴权两态）、`~/lib/app-settings/app-settings.server`（`loginRequired` 两态）、
 * `~/lib/media/output-access`（归属判决由它自己的单测钉，这里只判「路由吃没吃它」）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  stat,
  open,
  readCalls,
  disk,
  userMock,
  loginRequiredMock,
  foreignMock,
} = vi.hoisted(() => ({
  stat: vi.fn(),
  open: vi.fn(),
  readCalls: [] as { length: number; position: number }[],
  disk: { bytes: Buffer.from("") },
  userMock: vi.fn<() => Promise<{ id: string } | null>>(),
  loginRequiredMock: vi.fn<() => boolean>(() => false),
  foreignMock: vi.fn<(segments: string[], userId: string) => Promise<boolean>>(
    async () => false,
  ),
}));

vi.mock("fs", () => ({ promises: { stat, open } }));
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: userMock,
}));
vi.mock("~/lib/app-settings/app-settings.server", () => ({
  getSettingsSync: () => ({ loginRequired: loginRequiredMock() }),
}));
vi.mock("~/lib/media/output-access", () => ({
  isForeignOwnedArtifact: foreignMock,
}));

import { generatedRoot as generatedRootOf } from "~/lib/media/output-paths";

const ROOT = process.cwd();
/* 产物根从唯一出处取（不在测试里再抄一遍 `<cwd>/generated` 的形状 —— 抄了就会在
 * 搬迁那天变成一条假红：实现没错、断言先旧）。见 `output-paths.test.ts` 里那条
 * 「根不在 public/ 下」的结构判据。 */
const artifactRoot = normalize(generatedRootOf(ROOT));

/** 把平台分隔符统一成正斜杠再比 —— 断言的是语义，不是 path.sep 的形状。 */
function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

function paramsOf(path: string[] | undefined) {
  return { params: Promise.resolve({ path }) };
}

function get(path: string[] | undefined, range?: string) {
  return import("./route").then(({ GET }) =>
    GET(
      new Request("http://x/api/generated", {
        headers: range === undefined ? {} : { range },
      }) as never,
      paramsOf(path),
    ),
  );
}

/** 种一份「磁盘上的文件」：`stat` 报它的长度，`open` 之后按请求的位置与长度读它。 */
function putFile(bytes: Uint8Array | string) {
  disk.bytes =
    typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes);
  stat.mockImplementation(async () => ({
    isFile: () => true,
    size: disk.bytes.length,
  }));
  open.mockImplementation(async () => ({
    read: async (
      buf: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      readCalls.push({ length, position });
      disk.bytes.subarray(position, position + length).copy(buf, offset);
      return {
        bytesRead: Math.min(length, Math.max(disk.bytes.length - position, 0)),
        buffer: buf,
      };
    },
    close: async () => undefined,
  }));
}

beforeEach(() => {
  stat.mockReset();
  open.mockReset();
  readCalls.length = 0;
  disk.bytes = Buffer.from("");
  userMock.mockReset();
  loginRequiredMock.mockReset().mockReturnValue(false);
  foreignMock.mockReset().mockResolvedValue(false);
  userMock.mockResolvedValue({ id: "user-a" });
  putFile("0123456789");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("闸门顺序：每一种拒绝都发生在碰磁盘之前", () => {
  it("没有路径段时 404，不去读根目录", async () => {
    const res = await get(undefined);
    expect(res.status).toBe(404);
    expect(stat).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("未登录（loginRequired 开着）→ 401，且不做归属判定、不碰磁盘", async () => {
    loginRequiredMock.mockReturnValue(true);
    userMock.mockResolvedValueOnce(null);
    const res = await get(["t1", "a.png"]);
    expect(res.status).toBe(401);
    expect(foreignMock).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("穿越出产物根 → 403 且不碰磁盘", async () => {
    const res = await get(["..", "..", "..", "etc", "passwd"]);
    expect(res.status).toBe(403);
    expect(stat).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("兄弟目录前缀碰撞（generated-evil）也必须 403", async () => {
    // 只写 `startsWith(root)` 的实现在这条上会放行 —— 它挡住了 `../`，
    // 却把 `<root>-evil/…` 当成「还在根里」。
    const res = await get(["..", "generated-evil", "secret.png"]);
    expect(res.status).toBe(403);
    expect(open).not.toHaveBeenCalled();
  });

  it("多用户模式：属于别人的产物 → 404（与「不存在」同形）且不去读那个文件", async () => {
    loginRequiredMock.mockReturnValue(true);
    foreignMock.mockResolvedValueOnce(true);
    const res = await get(["projects", "proj-b", "t9", "a.png"]);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expect(open).not.toHaveBeenCalled();
    // 判定拿的是解码后的路径片段 + 当前用户，不自己再解析一遍字符串
    expect(foreignMock).toHaveBeenCalledWith(
      ["projects", "proj-b", "t9", "a.png"],
      "user-a",
    );
  });

  it.for(["bytes=0-3", "bytes=9999-", "seconds=1-2"])(
    "带 Range 也不许绕过闸（%s）：无会话 401、别人的 404，两次都不打开文件",
    async (range) => {
      loginRequiredMock.mockReturnValue(true);
      userMock.mockResolvedValueOnce(null);
      expect((await get(["t1", "a.png"], range)).status).toBe(401);
      expect(open).not.toHaveBeenCalled();

      userMock.mockResolvedValue({ id: "user-a" });
      foreignMock.mockResolvedValueOnce(true);
      expect((await get(["t1", "a.png"], range)).status).toBe(404);
      expect(open).not.toHaveBeenCalled();
    },
  );

  it("多用户模式：不是别人的 → 正常读出字节", async () => {
    loginRequiredMock.mockReturnValue(true);
    expect((await get(["t1", "a.png"])).status).toBe(200);
    expect(foreignMock).toHaveBeenCalledTimes(1);
  });

  it("单用户模式（默认）跳过归属判定 —— 那时人人都是同一个演示用户，判了只会误伤", async () => {
    expect((await get(["t1", "a.png"])).status).toBe(200);
    expect(foreignMock).not.toHaveBeenCalled();
  });

  it("路径段解析回根目录本身时不去 open 目录（404，不是 500）", async () => {
    stat.mockImplementation(async () => ({ isFile: () => false, size: 0 }));
    const res = await get(["."]);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    // 目录不该被打开 —— 这一条把「拿 open 去试目录」的写法挡掉
    expect(open).not.toHaveBeenCalled();
  });

  it("fs 的错误原文不许漏进响应", async () => {
    stat.mockRejectedValueOnce(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }),
    );
    const res = await get(["t1", "a.png"]);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("EACCES");
  });
});

describe("整份读（没有 Range）", () => {
  it("命中时回字节流 + 唯一出口决定的 Content-Type + private 长缓存", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    putFile(bytes);
    const res = await get(["t1", "a.png"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const cache = res.headers.get("Cache-Control") ?? "";
    expect(cache).toContain("immutable");
    // 有归属判定之后还标 public，等于让共享缓存把 A 的产物回给 B
    expect(cache).toMatch(/^private\b/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    // 读的是根目录内的那个文件，不是别处。
    expect(normalize(stat.mock.calls[0]?.[0] as string)).toBe(
      `${artifactRoot}/t1/a.png`,
    );
    expect(normalize(open.mock.calls[0]?.[0] as string)).toBe(
      `${artifactRoot}/t1/a.png`,
    );
  });

  it("Accept-Ranges 在场，客户端才知道可以分段要", async () => {
    const res = await get(["t1", "a.png"]);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Range")).toBeNull();
  });

  it("未知扩展名不裸奔：Content-Type 走兜底而不是留空", async () => {
    const res = await get(["t1", "blob.weird"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBeTruthy();
  });

  it("0 字节的产物回 200 空体，而不是被「窗口算不出来」撑成 500", async () => {
    putFile("");
    const res = await get(["t1", "a.png"]);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("整份读时被裁短：按实际读到的字节回，且不配 Content-Range", async () => {
    // 没有 Range 的那一支也要能短读 —— 少了这条，「短读只处理分段路径」这种半修
    // 会在 Coverage 的分支上留痕（这里刻意断言**没有** Content-Range：整份请求
    // 客户端没要窗口，给它一个 206 的形状才是真错）。
    open.mockImplementationOnce(async () => ({
      read: async (buf: Buffer, offset: number) => {
        Buffer.from("01").copy(buf, offset);
        return { bytesRead: 2, buffer: buf };
      },
      close: async () => undefined,
    }));
    const res = await get(["t1", "a.png"]);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("01");
    expect(res.headers.get("Content-Range")).toBeNull();
  });

  it("读完必须 close 句柄（漏了它，Windows 上产物会被自己锁住，重生成即失败）", async () => {
    let closed = 0;
    open.mockImplementationOnce(async () => ({
      read: async (
        buf: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => {
        readCalls.push({ length, position });
        disk.bytes.subarray(position, position + length).copy(buf, offset);
        return { bytesRead: length, buffer: buf };
      },
      close: async () => {
        closed += 1;
      },
    }));
    await get(["t1", "a.png"]);
    expect(closed).toBe(1);
  });

  it("读取抛错时也必须把已经拿到的句柄闭上（finally 那条路）", async () => {
    let closed = 0;
    open.mockImplementationOnce(async () => ({
      read: async () => {
        throw new Error("EIO");
      },
      close: async () => {
        closed += 1;
      },
    }));
    expect((await get(["t1", "a.png"])).status).toBe(404);
    expect(closed).toBe(1);
  });
});

describe("Range：三种结论翻成三个状态码", () => {
  it("合法窗口 → 206 + Content-Range，且**只读那一段**", async () => {
    putFile("0123456789");
    const res = await get(["t1", "a.png"], "bytes=2-5");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await res.text()).toBe("2345");
    // 这条是整个支持的目的：读的位置与长度都必须是窗口，不是整份
    expect(readCalls).toEqual([{ length: 4, position: 2 }]);
  });

  it("开放终点读到文件末尾", async () => {
    const res = await get(["t1", "a.png"], "bytes=8-");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 8-9/10");
    expect(await res.text()).toBe("89");
    expect(readCalls).toEqual([{ length: 2, position: 8 }]);
  });

  it("后缀形式取末尾若干字节", async () => {
    const res = await get(["t1", "a.png"], "bytes=-2");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 8-9/10");
    expect(await res.text()).toBe("89");
  });

  it("终点超出文件长度时裁到末尾，不回一段不存在的字节", async () => {
    const res = await get(["t1", "a.png"], "bytes=9-99999");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 9-9/10");
    expect(await res.text()).toBe("9");
    expect(readCalls).toEqual([{ length: 1, position: 9 }]);
  });

  it("起点在末尾之后 → 416 只写总长，且一次都不打开文件", async () => {
    const res = await get(["t1", "a.png"], "bytes=9999-");
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */10");
    expect(open).not.toHaveBeenCalled();
  });

  it("一个字节都没读到（文件被裁到起点之前）→ 404，而不是回一个空体的 206", async () => {
    open.mockImplementationOnce(async () => ({
      read: async (buf: Buffer) => ({ bytesRead: 0, buffer: buf }),
      close: async () => undefined,
    }));
    expect((await get(["t1", "a.png"], "bytes=2-5")).status).toBe(404);
  });

  it("0 字节产物配上 Range → 416（满足不了），不是 206 空体", async () => {
    putFile("");
    const res = await get(["t1", "a.png"], "bytes=0-10");
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */0");
  });

  it.for(["bytes=0-1,2-3", "seconds=1-2", "bytes=abc", "bytes=500-100"])(
    "不认识的形状（%s）→ 忽略并回整份 200，绝不判成 416",
    async (range) => {
      const res = await get(["t1", "a.png"], range);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("0123456789");
      expect(res.headers.get("Content-Range")).toBeNull();
      // 忽略 = 读整份一次，不是读一段
      expect(readCalls).toEqual([{ length: 10, position: 0 }]);
    },
  );

  it("416 也带 Cache-Control 与 Accept-Ranges（分段能力与这一次满不满足无关）", async () => {
    const res = await get(["t1", "a.png"], "bytes=9999-");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Cache-Control")).toMatch(/^private\b/);
  });

  it("文件在一次请求内被换短：按实际读到的字节回，别让长度比正文长", async () => {
    open.mockImplementationOnce(async () => ({
      read: async (buf: Buffer, offset: number) => {
        // 只给得出 2 个字节，尽管要 6 个（同名产物被重新生成的那一刻）
        Buffer.from("ab").copy(buf, offset);
        return { bytesRead: 2, buffer: buf };
      },
      close: async () => undefined,
    }));
    const res = await get(["t1", "a.png"], "bytes=0-5");
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("ab");
    // 关键不是长度数字，而是**承诺与实际必须一致**：窗口按实际读到的字节一起收窄，
    // 不许出现「Content-Range 说 6 个字节、body 只有 2 个」。
    expect(res.headers.get("Content-Range")).toBe("bytes 0-1/10");
  });
});
