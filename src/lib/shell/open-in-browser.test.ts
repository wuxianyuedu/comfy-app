/**
 * `open-in-browser.ts` 的闸门用例：把控制权交给系统浏览器之前，协议必须先过闸。
 *
 * 这一层是台账 A5 那条口径（「URL 协议只许 http(s)」）漏掉的第四个落点，也是
 * 危害最大的一个：`setting.openExternal` 的目标地址**由请求方给**，此前只有
 * `z.url()` 那道闸 —— 它管「是不是一个 URL」，`file:` / `javascript:` /
 * 自定义协议全都算「是」。Windows 上 `cmd /c start "" <协议>:…` 会直接拉起协议
 * 处理器对应的本机程序，`file:` 则是读本机文件。
 *
 * 所以判据分两层：**拒绝必须发生在 spawn 之前**（拦不住就等于动作已经发出去了），
 * 以及「命令 + 参数数组」的形态不许退化成拼整串（模块头部记着那次
 * `"start"""` 引号剥离事故）。
 *
 * mock 边界：`child_process`（换成可编程的假句柄，绝不真起 cmd / open / xdg-open）。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

type Cb = (...args: unknown[]) => void;

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("child_process", () => ({ spawn: spawnMock }));

import { openUrlInBrowser } from "./open-in-browser";

/** 假子进程：注册完 handler 后延一拍发 `spawn`（等价于「命令已交给 OS」）。 */
function installFakeChild(errorCode?: string) {
  const handlers: Record<string, Cb[]> = {};
  spawnMock.mockImplementation(() => {
    const handle = {
      on: (ev: string, cb: Cb) => {
        (handlers[ev] ??= []).push(cb);
      },
      unref: vi.fn(),
      kill: vi.fn(),
      pid: 4242,
    };
    setTimeout(() => {
      if (errorCode) {
        for (const cb of handlers.error ?? [])
          cb(
            Object.assign(new Error(`spawn ${errorCode}`), { code: errorCode }),
          );
        return;
      }
      for (const cb of handlers.spawn ?? []) cb();
    }, 0);
    return handle;
  });
}

const platform = process.platform;

beforeEach(() => {
  vi.clearAllMocks();
  installFakeChild();
});

describe("openUrlInBrowser 的协议闸门", () => {
  it("http / https 放行：真的调用系统浏览器", async () => {
    const res = await openUrlInBrowser("https://example.com/video.mp4");
    expect(res.ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("大写协议不再被误拒（旧的前缀正则在这里判 false）", async () => {
    const res = await openUrlInBrowser("HTTPS://example.com/a.png");
    expect(res.ok).toBe(true);
  });

  /* 每一条都能过 `z.url()`，也每一条都必须在这里被拦下。 */
  it.for([
    ["file:///C:/Users/me/.env"],
    ["file:///etc/passwd"],
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["comfyapp://open?path=C:/"],
    ["search-ms:query=x"],
    ["about:blank"],
  ] as const)("拒绝 %j 且一次都不 spawn", async ([url]) => {
    const res = await openUrlInBrowser(url);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("http/https");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("畸形地址（不是合法 URL）→ 拒绝，不起进程", async () => {
    for (const url of ["http://  ", "not a url", ""]) {
      const res = await openUrlInBrowser(url);
      expect(res.ok).toBe(false);
    }
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("openUrlInBrowser 的命令形态", () => {
  it("命令与参数分开发给 spawn，URL 是独立的一个 argv 元素（不拼整串）", async () => {
    await openUrlInBrowser("http://127.0.0.1:8188?a=1&b=2");
    const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
    if (platform === "win32") {
      // `start` 是 cmd 内建命令，必须由 cmd /c 承载；空串是窗口标题（防 & 被吞）
      expect(cmd).toBeTruthy();
      expect(args.slice(0, 3)).toEqual(["/c", "start", ""]);
    } else {
      expect(args).toHaveLength(1);
    }
    expect(args.at(-1)).toBe("http://127.0.0.1:8188?a=1&b=2");
    // 走的是 execFile 语义的 spawn + 数组参数：任何一段里都不出现 shell 二次解析
    expect(args.some((a) => a.includes("cmd /c"))).toBe(false);
  });

  it("起进程失败时给可行动的说明而不是抛错（硬规则 4）", async () => {
    installFakeChild("ENOENT");
    const res = await openUrlInBrowser("https://example.com");
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("https://example.com");
  });
});
