// lifecycle 等待原语与事件回调的测试（ISSUE #570 第 1~3 项）。
//
// 为什么单测这一层：这些逻辑此前是 `ensureComfyUiReady` 里的两条同构等待循环
// 与三个闭包回调 —— 要验证「输出截断到 500 字符」「超过 60 行丢最旧」「判死就
// 停」都得起真子进程。抽成「注入策略 + 显式传参」后，它们成了普通函数，
// 用例名直接写出「什么情况 → 什么行为」，改动判断即红。

import { describe, expect, it, vi } from "vitest";

import {
  createChildExitHandler,
  createOutputSink,
  createRecentOutputLedger,
  waitForComfyReady,
} from "./lifecycle-wait";

describe("waitForComfyReady（单一等待循环 + 策略注入）", () => {
  it("探测到就绪即返回，且就绪文案来自注入的 readyDetail", async () => {
    const onReady = vi.fn();
    const r = await waitForComfyReady({
      deadline: null,
      timeoutDetail: "超时",
      readyDetail: "ComfyUI 已启动并就绪（保活模式）",
      onReady,
      probe: vi.fn().mockResolvedValue("http://127.0.0.1:8188"),
      isDead: vi.fn().mockResolvedValue(null),
      intervalMs: 1,
    });
    expect(r).toEqual({
      ok: true,
      base: "http://127.0.0.1:8188",
      detail: "ComfyUI 已启动并就绪（保活模式）",
    });
    expect(onReady).toHaveBeenCalledWith("http://127.0.0.1:8188");
  });

  it("判死返回文案即结束，文案原样透出（可行动的报错来源）", async () => {
    const onDead = vi.fn();
    const r = await waitForComfyReady({
      deadline: null,
      timeoutDetail: "超时",
      onDead,
      probe: vi.fn().mockResolvedValue(null),
      isDead: vi.fn().mockResolvedValue("ComfyUI 启动失败：保活进程已退出。"),
      intervalMs: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toBe("ComfyUI 启动失败：保活进程已退出。");
    expect(onDead).toHaveBeenCalledWith("ComfyUI 启动失败：保活进程已退出。");
  });

  it("早退优先于探测：用户手动关闭立即结束，不误报「进程秒退」", async () => {
    const probe = vi.fn().mockResolvedValue(null);
    const r = await waitForComfyReady({
      deadline: null,
      timeoutDetail: "超时",
      earlyExit: () => ({ ok: false, base: null, detail: "已手动关闭" }),
      probe,
      isDead: vi.fn().mockResolvedValue(null),
      intervalMs: 1,
    });
    expect(r.detail).toBe("已手动关闭");
    expect(probe).not.toHaveBeenCalled();
  });

  it("deadline 到点即超时，文案只有一份（两条路径共用同一句）", async () => {
    let t = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => t);
    const probe = vi.fn(async () => {
      t += 5000; // 每轮推进时钟，让第二轮超过 deadline
      return null;
    });
    const r = await waitForComfyReady({
      deadline: 1000,
      timeoutDetail: "comfyui 启动超过 10s 仍未就绪",
      probe,
      isDead: vi.fn().mockResolvedValue(null),
      intervalMs: 1,
    });
    nowSpy.mockRestore();
    expect(r.ok).toBe(false);
    expect(r.detail).toBe("comfyui 启动超过 10s 仍未就绪");
  });
});

describe("createOutputSink（事件回调用具名函数 + 显式依赖）", () => {
  it("按 500 字符截断后写日志与留底（此前闭包不可测）", () => {
    const logs: string[] = [];
    const recent: string[] = [];
    const sink = createOutputSink({
      appendRuntimeLog: (l) => logs.push(l),
      pushRecent: (t) => recent.push(t),
    });
    sink(Buffer.from("x".repeat(600)));
    expect(logs[0]).toBe(`[out] ${"x".repeat(500)}`);
    expect(recent[0]).toBe("x".repeat(500));
  });

  it("接受自定义截断上限", () => {
    const logs: string[] = [];
    const sink = createOutputSink({
      appendRuntimeLog: (l) => logs.push(l),
      pushRecent: () => undefined,
      maxLineChars: 3,
    });
    sink("abcdef");
    expect(logs[0]).toBe("[out] abc");
  });
});

describe("createRecentOutputLedger（进程秒退时报错来源）", () => {
  it("按行累积、丢弃空白行", () => {
    const led = createRecentOutputLedger();
    led.push("a\n\n  b  \n");
    expect(led.lines).toEqual(["a", "b"]);
  });

  it("超过上限丢弃最旧（默认 60 行）", () => {
    const led = createRecentOutputLedger(3);
    led.push("1\n2\n3\n4");
    expect(led.lines).toEqual(["2", "3", "4"]);
  });
});

describe("createChildExitHandler（退出回调可单测）", () => {
  function handler(over: {
    stopRequested?: boolean;
    onBanner?: (b: string) => void;
  }) {
    const lines: string[] = [];
    const logs: string[] = [];
    let cleared = 0;
    const onExit = createChildExitHandler({
      banner: (report) => `■ ComfyUI 进程已退出：${report.reason}`,
      appendRuntimeLog: (l) => {
        lines.push(l);
        if (l.startsWith("■")) over.onBanner?.(l);
      },
      log: (m) => logs.push(m),
      clearChild: () => {
        cleared++;
      },
      context: () => ({
        pid: 4242,
        uptimeMs: 137_000,
        stopRequested: over.stopRequested ?? false,
        mode: "bound",
      }),
    });
    return {
      onExit,
      lines,
      logs,
      cleared: () => cleared,
      /* 「横幅」在实现里是写进 runtime 文件的第一条 —— 这里按同一个形状取，
       * 让各条断言保持「读一条日志行」的语义（一次启动一份文件之后没有独立的
       * 横幅出口）。 */
      banners: () => lines.filter((l) => l.startsWith("■")),
    };
  }

  it("横幅写「为什么退出」而不是只写 code，并落 [exit] 明细 + 清句柄", () => {
    const h = handler({});
    h.onExit(137, null);
    expect(h.banners()[0]).toBe("■ ComfyUI 进程已退出：异常退出（exit 137）");
    // 结构化明细要能事后 grep：pid / 存活 / code / signal / 模式 都在
    expect(h.lines[1]).toContain("[exit] 异常退出（exit 137）");
    expect(h.lines[1]).toContain("pid=4242");
    expect(h.lines[1]).toContain("存活=2m17s");
    expect(h.lines[1]).toContain("signal=null");
    // 可行动作单独一行（规范 §9.2 第 3 条：失败要有出口）
    expect(h.lines[2]).toContain("[exit] ↩");
    expect(h.logs[0]).toContain("异常退出");
    expect(h.cleared()).toBe(1);
  });

  it("被信号杀掉时以信号为准（退出码是派生物，不是原因）", () => {
    const h = handler({});
    h.onExit(null, "SIGKILL");
    expect(h.banners()[0]).toContain("SIGKILL");
    expect(h.lines[1]).toContain("signal=SIGKILL");
  });

  it("用户主动关闭：不报「莫名退出」", () => {
    const h = handler({ stopRequested: true });
    h.onExit(0, null);
    expect(h.banners()[0]).toContain("用户主动关闭");
  });

  it("code 与 signal 都拿不到时如实说「拿不到」，不编一个 0", () => {
    const h = handler({});
    h.onExit(null, null);
    expect(h.banners()[0]).toContain("拿不到退出码");
    expect(h.banners()[0]).not.toContain("exit 0");
  });
});
