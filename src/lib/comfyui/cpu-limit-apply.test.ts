import { describe, expect, it, vi } from "vitest";

import { applyComfyCpuLimit } from "./cpu-limit-apply";

/** 注入式执行器：记下调了什么，并按需伪造失败。 */
function recorder(failFor: string[] = []) {
  const calls: Array<{ command: string; args: string[] }> = [];
  return {
    calls,
    exec: (command: string, args: string[]) => {
      calls.push({ command, args });
      return Promise.resolve(
        failFor.includes(command)
          ? { ok: false, detail: `${command}: command not found` }
          : { ok: true, detail: "" },
      );
    },
  };
}

describe("施加 CPU 档位（ISSUE #1959）", () => {
  it("off 一条命令都不发 —— 「关了」必须是真的什么都没做", async () => {
    const r = recorder();
    const outcome = await applyComfyCpuLimit({
      pid: 1234,
      mode: "off",
      platform: "linux",
      exec: r.exec,
    });
    expect(r.calls).toEqual([]);
    expect(outcome.results).toEqual([]);
  });

  it("PID 拿不到时不施加，但**不算失败**（keepAlive 的孙进程要靠 main.py 反查，调用方随后补一次）", async () => {
    const r = recorder();
    for (const pid of [null, 0, -1]) {
      const outcome = await applyComfyCpuLimit({
        pid,
        mode: "yield",
        platform: "linux",
        exec: r.exec,
      });
      expect(outcome.results).toEqual([]);
    }
    expect(r.calls).toEqual([]);
  });

  it("让路档只发一条（优先级），限核档发两条（优先级 + 亲和性）", async () => {
    const a = recorder();
    await applyComfyCpuLimit({
      pid: 100,
      mode: "yield",
      platform: "linux",
      exec: a.exec,
    });
    expect(a.calls.map((c) => c.command)).toEqual(["renice"]);

    const b = recorder();
    await applyComfyCpuLimit({
      pid: 100,
      mode: "throttle",
      platform: "linux",
      cpuCount: 8,
      exec: b.exec,
    });
    expect(b.calls.map((c) => c.command)).toEqual(["renice", "taskset"]);
  });

  it("命令失败**如实回报**而不是静默 —— 静默的表现是「设置页说限了、实际没限」", async () => {
    const r = recorder(["renice"]);
    const outcome = await applyComfyCpuLimit({
      pid: 100,
      mode: "yield",
      platform: "linux",
      exec: r.exec,
    });
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]!.ok).toBe(false);
    expect(outcome.results[0]!.detail).toContain("command not found");
    /* 说明文字照旧带出去 —— 用户要知道「哪一档没生效」。 */
    expect(outcome.results[0]!.describe.length).toBeGreaterThan(0);
  });

  it("一条失败不影响另一条照发（taskset 缺失时优先级仍然调上了）", async () => {
    const r = recorder(["taskset"]);
    const outcome = await applyComfyCpuLimit({
      pid: 100,
      mode: "throttle",
      platform: "linux",
      cpuCount: 8,
      exec: r.exec,
    });
    expect(r.calls).toHaveLength(2);
    expect(outcome.results.map((x) => x.ok)).toEqual([true, false]);
  });

  it("exec 自身 reject 时如实向上抛 —— 吞掉它的责任人写在调用方（applyCpuLimitAsync 的 .catch）", async () => {
    /* 这条钉的是**分工**：施加层不吞 exec 的 reject（命令**失败**才收进
     * results、不抛），因为「该不该把启动带下去」是调用方的决定 —— 那里已经
     * 有一条 `.catch` 写一行可读原因。这里改变分工必须当场红。 */
    await expect(
      applyComfyCpuLimit({
        pid: 100,
        mode: "yield",
        platform: "linux",
        exec: () => Promise.reject(new Error("boom")),
      }),
    ).rejects.toThrow("boom");
  });

  it("不真去改跑用例这台机器的优先级（注入执行器不是可选项）", async () => {
    /* 反向验证：不注入 exec 时**会**去调真的 renice —— 所以本文件的每个用例
     * 都必须注入。这条守住「有人图省事把注入删掉」：删掉后上面几条会在
     * 无 renice 的机器上变成红，或更坏 —— 悄悄改了跑用例的机器。 */
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const outcome = await applyComfyCpuLimit({
      pid: process.pid,
      mode: "yield",
      platform: "linux",
    });
    /* 真执行时结论可能是 ok 也可能是 not-found，两种都不重要 —— 重要的是
     * 它**真的去跑了**（call 记录落在 results 里而不是空数组）。 */
    expect(outcome.results).toHaveLength(1);
    spy.mockRestore();
  });
});
