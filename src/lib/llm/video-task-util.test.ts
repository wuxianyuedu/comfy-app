import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

/* 本模块的两条契约都只在「边界输入」上才看得出来：
 *   ① `safeModelDir` 必须拦住路径穿越 —— 模型名来自用户可改的配置，是真正的外部输入；
 *   ② `saveMediaToLocalTemp` 失败一律返回 null 不抛错（本地落盘只是增强，不是主链路）。
 * 所以用例按「能写到哪 / 写不进去怎么办」来写，而不是走一遍 happy path。 */

const originalCwd = process.cwd();
let sandbox: string;

function localFiles(): string[] {
  const root = join(sandbox, "temp", "usage-test");
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(root, full));
    }
  };
  walk(root);
  return out;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "video-task-util-"));
  process.cwd = () => sandbox;
});

afterEach(() => {
  process.cwd = () => originalCwd;
  rmSync(sandbox, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("saveMediaToLocalTemp · 路径落点", () => {
  it("图片按模型名建子目录落盘，返回绝对路径", async () => {
    const { saveMediaToLocalTemp } = await import("./video-task-util");
    const dest = await saveMediaToLocalTemp(
      "image",
      "my-model",
      "data:image/png;base64,aGVsbG8=",
    );

    expect(dest).not.toBeNull();
    expect(
      dest!.startsWith(join(sandbox, "temp", "usage-test", "my-model")),
    ).toBe(true);
    expect(readFileSync(dest!, "utf-8")).toBe("hello");
    expect(localFiles()).toHaveLength(1);
  });

  it("模型名里的路径穿越被剥掉，产物只落在 temp/usage-test 之内", async () => {
    const { saveMediaToLocalTemp } = await import("./video-task-util");

    for (const evil of [
      "../../../../etc/passwd",
      "..\\..\\windows\\system32\\evil",
      "/absolute/path/model",
      "normal/../../../escape",
    ]) {
      const dest = await saveMediaToLocalTemp(
        "image",
        evil,
        "data:image/png;base64,aGVsbG8=",
      );
      expect(dest).not.toBeNull();
      const rel = relative(join(sandbox, "temp", "usage-test"), dest!);
      // 不许出现 `..`，且只应有一层子目录 + 文件名。
      expect(rel.includes("..")).toBe(false);
      expect(rel.split(/[\\/]/)).toHaveLength(2);
    }
  });

  it("文件系统特殊字符与超长名被清洗（不因非法名崩掉整条链路）", async () => {
    const { saveMediaToLocalTemp } = await import("./video-task-util");
    const dest = await saveMediaToLocalTemp(
      "image",
      'a<b>c:d"e|f?g*h' + "\u0000" + "i".repeat(200),
      "data:image/png;base64,aGVsbG8=",
    );
    expect(dest).not.toBeNull();
    const dirName = relative(join(sandbox, "temp", "usage-test"), dest!).split(
      /[\\/]/,
    )[0]!;
    expect(dirName).not.toMatch(/[<>:"|?*\u0000]/);
    expect(dirName.length).toBeLessThanOrEqual(80);
  });

  it("模型名为空白时回落到 unnamed，不产出无名路径", async () => {
    const { saveMediaToLocalTemp } = await import("./video-task-util");
    const dest = await saveMediaToLocalTemp(
      "image",
      "   ",
      "data:image/png;base64,aGVsbG8=",
    );
    expect(dest).not.toBeNull();
    expect(
      relative(join(sandbox, "temp", "usage-test"), dest!).split(/[\\/]/)[0],
    ).toBe("unnamed");
  });

  it("data URL 的扩展名跟随 mime，不再一律 png", async () => {
    const { saveMediaToLocalTemp } = await import("./video-task-util");
    const jpeg = await saveMediaToLocalTemp(
      "image",
      "m",
      "data:image/jpeg;base64,aGVsbG8=",
    );
    expect(jpeg!.endsWith(".jpg")).toBe(true);

    // 无 mime 的 data URL 回落到该 kind 的默认扩展名。
    const fallback = await saveMediaToLocalTemp(
      "video",
      "m",
      "data:application/octet-stream;base64,aGVsbG8=",
    );
    expect(fallback!.endsWith(".mp4")).toBe(true);
  });
});

describe("saveMediaToLocalTemp · 失败一律静默", () => {
  it("HTTP 非 2xx 返回 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const { saveMediaToLocalTemp } = await import("./video-task-util");
    expect(
      await saveMediaToLocalTemp("video", "m", "https://cdn.example/a.mp4"),
    ).toBeNull();
  });

  it("空文件返回 null（不留下 0 字节产物）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(0), { status: 200 })),
    );
    const { saveMediaToLocalTemp } = await import("./video-task-util");
    expect(
      await saveMediaToLocalTemp("video", "m", "https://cdn.example/a.mp4"),
    ).toBeNull();
    expect(localFiles()).toHaveLength(0);
  });

  it("fetch 抛错（超时 / 断网）返回 null 而不外抛", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const { saveMediaToLocalTemp } = await import("./video-task-util");
    await expect(
      saveMediaToLocalTemp("image", "m", "https://cdn.example/a.png"),
    ).resolves.toBeNull();
  });

  it("远端 URL 正常时按 URL 扩展名落盘", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      ),
    );
    const { saveMediaToLocalTemp } = await import("./video-task-util");
    const dest = await saveMediaToLocalTemp(
      "video",
      "m",
      "https://cdn.example/a.mp4?token=1",
    );
    expect(dest).not.toBeNull();
    expect(dest!.endsWith(".mp4")).toBe(true);
    expect(readFileSync(dest!).length).toBe(3);
  });
});

describe("pollRemoteVideoTask", () => {
  it("第一个候选地址就绪即返回该 URL（不再等满窗口）", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ url: "https://cdn.example/out.mp4" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { pollRemoteVideoTask } = await import("./video-task-util");
    vi.useFakeTimers();
    const p = pollRemoteVideoTask(
      "https://api.example",
      "/v1/videos/generations",
      "m",
      "task-1",
      {},
    );
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBe("https://cdn.example/out.mp4");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://api.example/v1/videos/task-1",
    );
  });

  it("首个地址无 URL 时换下一个候选（agnes 形状）", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(String(url));
        if (String(url).includes("agnesapi")) {
          return new Response(
            JSON.stringify({
              data: { video_url: "https://cdn.example/agnes.mp4" },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ status: "pending" }), {
          status: 200,
        });
      }),
    );
    const { pollRemoteVideoTask } = await import("./video-task-util");
    vi.useFakeTimers();
    const p = pollRemoteVideoTask(
      "https://api.example",
      "/v1/videos/generations",
      "m",
      "t2",
      {},
    );
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBe("https://cdn.example/agnes.mp4");
    expect(seen.some((u) => u.includes("/v1/videos/t2"))).toBe(true);
    expect(seen.some((u) => u.includes("agnesapi"))).toBe(true);
  });

  it("网络异常 / 非 JSON 响应不终止轮询，窗口内最终拿到产物", async () => {
    // 每轮都会把两个候选地址各打一次，所以第 3 次调用落在**第二轮的首个候选**上。
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) throw new Error("connection reset"); // 连接被重置
        if (call === 2) return new Response("not json", { status: 200 });
        // 第三轮起返回真实媒体键（`video_url`）—— 只有 `MEDIA_URL_KEYS` 里的键才被认。
        return new Response(
          JSON.stringify({ video_url: "https://cdn.example/late.mp4" }),
          { status: 200 },
        );
      }),
    );
    const { pollRemoteVideoTask } = await import("./video-task-util");
    vi.useFakeTimers();
    const p = pollRemoteVideoTask(
      "https://api.example",
      "/v1/videos/generations",
      "m",
      "t3",
      {},
    );

    await vi.advanceTimersByTimeAsync(5000);
    expect(call).toBe(2); // 首轮两候选都失败，但循环没退出
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBe("https://cdn.example/late.mp4");
  });

  it("窗口耗尽仍未就绪返回 null（调用方据此报 pending）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "pending" }), { status: 200 }),
      ),
    );
    const { pollRemoteVideoTask, VIDEO_POLL_TOTAL_MS } =
      await import("./video-task-util");
    vi.useFakeTimers();
    const p = pollRemoteVideoTask(
      "https://api.example",
      "/v1/videos/generations",
      "m",
      "t4",
      {},
    );
    await vi.advanceTimersByTimeAsync(VIDEO_POLL_TOTAL_MS + 10_000);
    await expect(p).resolves.toBeNull();
  });

  it("上游 4xx 也不终止 —— 换下一轮而不是放弃", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call < 2) {
          // 首次两个候选都 404，轮空之后第二轮给结果。
          return new Response("missing", { status: 404 });
        }
        return new Response(
          JSON.stringify({ url: "https://cdn.example/after-404.mp4" }),
          { status: 200 },
        );
      }),
    );
    const { pollRemoteVideoTask } = await import("./video-task-util");
    vi.useFakeTimers();
    const p = pollRemoteVideoTask(
      "https://api.example",
      "/v1/videos/generations",
      "m",
      "t5",
      {},
    );
    await vi.advanceTimersByTimeAsync(5000 * 3);
    await expect(p).resolves.toBe("https://cdn.example/after-404.mp4");
  });

  it("请求头原样透传（鉴权不能丢）", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ url: "https://cdn.example/x.mp4" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { pollRemoteVideoTask } = await import("./video-task-util");
    vi.useFakeTimers();
    const p = pollRemoteVideoTask(
      "https://api.example",
      "/v1/videos/generations",
      "m",
      "t6",
      { Authorization: "Bearer k" },
    );
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(fetchMock.mock.calls[0]![1]!.headers).toEqual({
      Authorization: "Bearer k",
    });
  });
});
