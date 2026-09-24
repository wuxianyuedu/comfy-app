/**
 * 「ComfyUI 为什么退出了」的判据与监督（用户原始诉求：**「有时候莫名就退出了」**）。
 *
 * 要钉住的是三件事：
 *   1. `signal` 与会优先于退出码 —— 被 SIGKILL 杀掉与「自己 exit 1」排查方向完全
 *      相反（前者是外部动作，后者是它自己的异常），日志里不能再长得一样；
 *   2. **拿不到就说拿不到** —— 保活模式没有子进程句柄，不许编一个 `code=0` 糊过去；
 *   3. 保活模式的退出监督：没这一条，用户能看到的只有下一次状态轮询里的
 *      「未运行」，原因一个字都没有。
 */
import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  describeComfyExit,
  describeStaleSession,
  formatUptime,
  reportKeepAliveExit,
  startComfyExitWatcher,
  type ComfyExitFacts,
} from "./lifecycle-exit";
import type { PidLookup } from "./proc-detect";

function facts(over: Partial<ComfyExitFacts> = {}): ComfyExitFacts {
  return {
    code: null,
    signal: null,
    stopRequested: false,
    pid: 4242,
    uptimeMs: 137_000,
    mode: "bound",
    ...over,
  };
}

describe("formatUptime", () => {
  it("秒 / 分 / 小时的写法", () => {
    expect(formatUptime(42_000)).toBe("42s");
    expect(formatUptime(137_000)).toBe("2m17s");
    expect(formatUptime(3_725_000)).toBe("1h02m");
  });

  it("未知与负数如实说「未知」（不伪造 0s）", () => {
    expect(formatUptime(null)).toBe("未知");
    expect(formatUptime(-1)).toBe("未知");
  });
});

describe("describeComfyExit", () => {
  it("用户主动关闭最先判（那是我们自己发起的）", () => {
    const r = describeComfyExit(facts({ stopRequested: true, code: 0 }));
    expect(r.reason).toBe("用户主动关闭");
    expect(r.advice).toBeNull();
  });

  it("信号优先于退出码（被杀的进程，code 是派生物）", () => {
    const r = describeComfyExit(facts({ code: 137, signal: "SIGKILL" }));
    expect(r.reason).toContain("SIGKILL");
    expect(r.reason).not.toContain("137");
  });

  it("SIGKILL 指向「外部动作」那几类嫌疑", () => {
    const r = describeComfyExit(facts({ signal: "SIGKILL" }));
    expect(r.advice).toContain("任务管理器");
  });

  it("exit 0：说「正常收工」，并提醒别被别的入口顶掉", () => {
    const r = describeComfyExit(facts({ code: 0 }));
    expect(r.reason).toContain("exit 0");
    expect(r.advice).toContain("接管");
  });

  it("非零码：给它「去看崩溃前输出」的出口", () => {
    const r = describeComfyExit(facts({ code: 1 }));
    expect(r.reason).toContain("exit 1");
    expect(r.advice).toContain("最后几行输出");
  });

  it("保活模式拿不到 code/signal：如实说，不编一个 0", () => {
    const r = describeComfyExit(
      facts({ mode: "keepAlive", signal: null, code: null }),
    );
    expect(r.reason).toContain("拿不到退出码");
    expect(r.reason).not.toContain("exit 0");
  });

  it("结构化明细含 pid / 存活 / code / signal / 模式（可事后 grep）", () => {
    const r = describeComfyExit(facts({ code: 1 }));
    expect(r.detail).toContain("pid=4242");
    expect(r.detail).toContain("存活=2m17s");
    expect(r.detail).toContain("code=1");
    expect(r.detail).toContain("signal=null");
    expect(r.detail).toContain("模式=bound");
  });
});

describe("startComfyExitWatcher —— 保活模式的退出监督", () => {
  /** 可控定时器：测试自己决定什么时候「到了下一轮」。 */
  function harness(findPid: () => Promise<PidLookup>, stopRequested = false) {
    const ticks: Array<() => void> = [];
    let stopped = false;
    const onExit = vi.fn();
    const watcher = startComfyExitWatcher({
      findPid,
      onExit,
      isStopped: () => stopRequested,
      setTimer: (fn) => {
        ticks.push(fn);
        return 0 as unknown as ReturnType<typeof setInterval>;
      },
      clearTimer: () => {
        stopped = true;
      },
      now: () => 1_000_000,
    });
    return {
      onExit,
      watcher,
      stopped: () => stopped,
      /** 跑一轮（等它内部的 await 落定）。 */
      tick: async () => {
        for (const fn of ticks) fn();
        await new Promise((resolve) => setImmediate(resolve));
      },
    };
  }

  it("先见到进程、之后连续两次查不到 → 报一次退出并自停", async () => {
    const findPid = vi
      .fn<() => Promise<PidLookup>>()
      .mockResolvedValueOnce({ pid: 7001, failed: false })
      .mockResolvedValue({ pid: null, failed: false });
    const h = harness(findPid);

    await h.tick(); // 第一次见到它：记开头
    expect(h.onExit).not.toHaveBeenCalled();

    await h.tick(); // 第 1 次 miss：还没到阈值
    expect(h.onExit).not.toHaveBeenCalled();

    await h.tick(); // 第 2 次 miss：判死
    expect(h.onExit).toHaveBeenCalledTimes(1);
    expect(h.onExit).toHaveBeenCalledWith({ pid: 7001, uptimeMs: 0 });
    expect(h.stopped()).toBe(true);
  });

  it("还没第一次见到它就查不到 → 不抢答（拉起失败由启动循环自己报）", async () => {
    const h = harness(
      vi
        .fn<() => Promise<PidLookup>>()
        .mockResolvedValue({ pid: null, failed: false }),
    );
    await h.tick();
    await h.tick();
    await h.tick();
    expect(h.onExit).not.toHaveBeenCalled();
    expect(h.stopped()).toBe(false);
  });

  it("中间又见到进程 → miss 计数复位（冷启动抖动不误报）", async () => {
    const findPid = vi
      .fn<() => Promise<PidLookup>>()
      .mockResolvedValueOnce({ pid: 7001, failed: false })
      .mockResolvedValueOnce({ pid: null, failed: false })
      .mockResolvedValueOnce({ pid: 7001, failed: false })
      .mockResolvedValue({ pid: null, failed: false });
    const h = harness(findPid);
    await h.tick();
    await h.tick(); // miss 1
    await h.tick(); // 又见到 → 复位
    await h.tick(); // miss 1（复位后重新数）
    expect(h.onExit).not.toHaveBeenCalled();
  });

  it("用户主动关 → 监督器自停，不报「莫名退出」", async () => {
    const h = harness(
      vi
        .fn<() => Promise<PidLookup>>()
        .mockResolvedValue({ pid: null, failed: false }),
      true,
    );
    await h.tick();
    expect(h.onExit).not.toHaveBeenCalled();
    expect(h.stopped()).toBe(true);
  });

  it("stop() 之后不再回调（宿主重新拉起前会调它）", async () => {
    const h = harness(
      vi
        .fn<() => Promise<PidLookup>>()
        .mockResolvedValue({ pid: 7001, failed: false }),
    );
    h.watcher.stop();
    await h.tick();
    expect(h.onExit).not.toHaveBeenCalled();
  });

  it("进程表查询失败（超时）不当作进程消失：连续失败不报退出，恢复后仍正常判死", async () => {
    const findPid = vi
      .fn<() => Promise<PidLookup>>()
      .mockResolvedValue({ pid: null, failed: true });
    const h = harness(findPid);
    await h.tick();
    await h.tick();
    await h.tick();
    expect(h.onExit).not.toHaveBeenCalled();
    expect(h.stopped()).toBe(false);

    // 之后恢复：见到进程 → 再两次查不到才判死
    findPid.mockResolvedValueOnce({ pid: 7001, failed: false });
    findPid.mockResolvedValue({ pid: null, failed: false });
    await h.tick(); // 见到
    await h.tick(); // miss 1
    await h.tick(); // miss 2 → 判死
    expect(h.onExit).toHaveBeenCalledTimes(1);
    expect(h.stopped()).toBe(true);
  });
});

describe("reportKeepAliveExit —— 把保活崩溃尾部带进 runtime 日志", () => {
  it("传入 keepAliveLogs 时，把 .err/.out 末尾带进 [exit][err]/[exit][out]", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keepalive-exit-"));
    const errFile = path.join(dir, "comfyui-keepalive-x.err.log");
    const outFile = path.join(dir, "comfyui-keepalive-x.out.log");
    fs.writeFileSync(
      errFile,
      'boot ok\nTraceback (most recent call last):\n  File "main.py", line 1\nValueError: boom\n',
    );
    fs.writeFileSync(outFile, "started ok\n");
    const runtime: string[] = [];
    const banners: string[] = [];
    reportKeepAliveExit({
      facts: { pid: 149720, uptimeMs: 26 * 60_000 + 13_000 },
      stopRequested: false,
      keepAliveLogs: { out: outFile, err: errFile },
      appendSessionBanner: (b) => banners.push(b),
      appendRuntimeLog: (l) => runtime.push(l),
      log: vi.fn(),
    });
    const tailErr = runtime.filter((l) => l.startsWith("[exit][err]"));
    const tailOut = runtime.filter((l) => l.startsWith("[exit][out]"));
    expect(tailErr.some((l) => l.includes("ValueError: boom"))).toBe(true);
    expect(tailOut.some((l) => l.includes("started ok"))).toBe(true);
    expect(banners[0]).toContain("进程消失");
  });

  it("没有 keepAliveLogs 时不带尾部（向后兼容）", () => {
    const runtime: string[] = [];
    reportKeepAliveExit({
      facts: { pid: 1, uptimeMs: 1000 },
      stopRequested: false,
      appendSessionBanner: vi.fn(),
      appendRuntimeLog: (l) => runtime.push(l),
      log: vi.fn(),
    });
    expect(runtime.some((l) => l.startsWith("[exit][err]"))).toBe(false);
  });
});

describe("describeStaleSession —— 应用自己也一起没了的那一档", () => {
  it("有开始没结束 → 反推出「应用或系统先没了」并给出那几类嫌疑", () => {
    const notice = describeStaleSession({
      pid: 1234,
      mode: "keepAlive",
      startedAt: "2026-09-21T03:00:00.000Z",
      exited: null,
    });
    expect(notice).toContain("没有退出记录");
    expect(notice).toContain("连带杀树");
  });

  it("有始有终 / 没有标记 → 不提示", () => {
    expect(
      describeStaleSession({
        pid: 1,
        mode: "bound",
        startedAt: "2026-09-21T03:00:00.000Z",
        exited: {
          at: "2026-09-21T03:10:00.000Z",
          reason: "异常退出（exit 1）",
        },
      }),
    ).toBeNull();
    expect(describeStaleSession(null)).toBeNull();
  });
});
