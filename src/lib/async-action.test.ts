/**
 * 「把一次异步动作的结果接到反馈通道上」的唯一出口（规范 16 §16.2.4.30）。
 *
 * 用例钉三处收口前**各判各的**地方：
 *  ① 失败文案从哪来（`errorMessage` 兜底 vs 写死一句）；
 *  ② 成功要不要说（`successText` 缺席 = 静默，是显式的）；
 *  ③ 结果信封按哪一套读（`ok` / `triggered` / 不抛即成功）。
 */
import { describe, expect, it, vi } from "vitest";

import { fireAndForget, runAsyncAction, toActionResult } from "./async-action";

describe("toActionResult", () => {
  it("`ok` 与 `triggered` 两种形状归一（调用处不必记得读哪个字段）", () => {
    expect(toActionResult({ ok: true }, "兜底")).toEqual({
      ok: true,
      detail: "兜底",
    });
    expect(toActionResult({ triggered: true }, "兜底")).toEqual({
      ok: true,
      detail: "兜底",
    });
    expect(
      toActionResult({ ok: false, detail: "服务端说的原因" }, "兜底"),
    ).toEqual({ ok: false, detail: "服务端说的原因" });
  });

  it("`error` 与 `detail` 都是可读文案的来源（先 detail 后 error）", () => {
    expect(
      toActionResult({ ok: false, error: "网络错误" }, "兜底").detail,
    ).toBe("网络错误");
    expect(
      toActionResult({ ok: false, detail: "详情", error: "错误" }, "兜底")
        .detail,
    ).toBe("详情");
  });

  it("void / null / undefined 视为成功（tRPC 不抛即成功）", () => {
    expect(toActionResult(undefined, "兜底")).toEqual({
      ok: true,
      detail: "兜底",
    });
    expect(toActionResult(null, "兜底")).toEqual({ ok: true, detail: "兜底" });
  });

  it("boolean 返回值按字面判成败", () => {
    expect(toActionResult(true, "兜底")).toEqual({ ok: true, detail: "兜底" });
    expect(toActionResult(false, "兜底")).toEqual({
      ok: false,
      detail: "兜底",
    });
  });

  it("`{ }`（既无 ok 也无 triggered）按成功 —— 与 void 同口径", () => {
    expect(toActionResult({}, "兜底")).toEqual({ ok: true, detail: "兜底" });
  });
});

describe("runAsyncAction", () => {
  it("成功时用 successText 报，失败时不报", async () => {
    const report = vi.fn();
    const r = await runAsyncAction(async () => undefined, {
      report,
      failureText: "保存失败",
      successText: "已保存",
    });
    expect(r.ok).toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("ok", "已保存");
  });

  it("信封里的 detail 当成功文案（服务端自己探的结论，调用处不该抄一遍）", async () => {
    const report = vi.fn();
    await runAsyncAction(async () => ({ ok: true, detail: "已启动" }), {
      report,
      failureText: "启动失败",
    });
    expect(report).toHaveBeenCalledWith("ok", "已启动");
  });

  it("successText 优先于信封的 detail（调用处有话说时以它为准）", async () => {
    const report = vi.fn();
    await runAsyncAction(async () => ({ ok: true, detail: "已启动" }), {
      report,
      failureText: "启动失败",
      successText: "已按你的配置启动",
    });
    expect(report).toHaveBeenCalledWith("ok", "已按你的配置启动");
  });

  it("不给 successText = 成功静默（显式表达，而不是忘了写分支）", async () => {
    const report = vi.fn();
    const r = await runAsyncAction(async () => undefined, {
      report,
      failureText: "保存失败",
    });
    expect(r.ok).toBe(true);
    expect(report).not.toHaveBeenCalled();
  });

  it("抛错时走 errorMessage 兜底成可读文案（硬规则 4：失败必须有可见出口）", async () => {
    const report = vi.fn();
    const r = await runAsyncAction(
      async () => {
        throw new Error("ECONNREFUSED");
      },
      { report, failureText: "保存失败" },
    );
    expect(r.ok).toBe(false);
    const [kind, detail] = report.mock.calls[0] as [string, string];
    expect(kind).toBe("err");
    /* `errorMessage` 把网络层原文翻译成人话（`~/lib/error-message`）。 */
    expect(detail).toContain("应用服务");
  });

  it("空 message 的 Error 回落 failureText（不给空白文案）", async () => {
    const report = vi.fn();
    await runAsyncAction(
      async () => {
        throw new Error("");
      },
      { report, failureText: "删除失败" },
    );
    expect(report).toHaveBeenCalledWith("err", "删除失败");
  });

  it("非 Error 抛值（unknown）也回落 failureText", async () => {
    /* tRPC / fetch 的拒绝值不保证是 `Error` 实例 —— 收口前那几处自己写的
     * `e instanceof Error ? e.message : String(e)` 会把对象渲染成
     * `[object Object]`；出口一律回落 `failureText`。 */
    const report = vi.fn();
    const reject: unknown = { code: 500 };
    await runAsyncAction(
      async () => {
        throw reject;
      },
      { report, failureText: "上传失败" },
    );
    expect(report).toHaveBeenCalledWith("err", "上传失败");
  });

  it("`{ok:false}` 的不抛返回也报失败，并用服务端给的 detail", async () => {
    const report = vi.fn();
    const r = await runAsyncAction(
      async () => ({ ok: false, detail: "路径不存在" }),
      {
        report,
        failureText: "打开目录失败",
      },
    );
    expect(r.ok).toBe(false);
    expect(report).toHaveBeenCalledWith("err", "路径不存在");
  });

  it("`{ok:false}` 没给 detail 时回落 failureText", async () => {
    const report = vi.fn();
    await runAsyncAction(async () => ({ ok: false }), {
      report,
      failureText: "删除失败",
    });
    expect(report).toHaveBeenCalledWith("err", "删除失败");
  });

  it("readResultEnvelope=false 时只按「有没有抛」判成败", async () => {
    /* 用于端点返回体里的 `ok` 不是「这次动作成不成」的落点。 */
    const report = vi.fn();
    const r = await runAsyncAction(async () => ({ ok: false }), {
      report,
      failureText: "同步失败",
      successText: "已同步",
      readResultEnvelope: false,
    });
    expect(r.ok).toBe(true);
    expect(report).toHaveBeenCalledWith("ok", "已同步");
  });

  it("failureText / successText 支持函数（文案依赖入参）", async () => {
    const report = vi.fn();
    await runAsyncAction(
      async () => {
        throw new Error("");
      },
      { report, failureText: () => "删除「角色」失败" },
    );
    expect(report).toHaveBeenCalledWith("err", "删除「角色」失败");
  });

  it("successText 为函数时拿到归一后的结果（可读服务端 detail）", async () => {
    const report = vi.fn();
    await runAsyncAction(async () => ({ ok: true, detail: "3 个文件" }), {
      report,
      failureText: "同步失败",
      successText: (r) => `已同步：${r.detail}`,
    });
    expect(report).toHaveBeenCalledWith("ok", "已同步：3 个文件");
  });

  it("失败不向外抛 —— 调用处拿返回值决定回滚", async () => {
    const report = vi.fn();
    let rolledBack = false;
    const r = await runAsyncAction(
      async () => {
        throw new Error("boom");
      },
      { report, failureText: "更新失败" },
    );
    if (!r.ok) rolledBack = true;
    expect(rolledBack).toBe(true);
    expect(r.detail).toBe("boom");
  });
});

describe("fireAndForget", () => {
  /** 冲刷 Promise 微任务队列，让 `.catch` 里的分支跑完。 */
  const flushMicrotasks = () =>
    new Promise((resolve) => setTimeout(resolve, 0));

  it("成功的 promise：onError 不被调用、也不向 caller 返回任何东西（不制造 caller 侧的 unhandledrejection）", async () => {
    const onError = vi.fn();
    const ret = fireAndForget(Promise.resolve("ok"), onError);
    expect(ret).toBeUndefined();
    await flushMicrotasks();
    expect(onError).not.toHaveBeenCalled();
  });

  it("失败的 promise：错误原样交给 onError（本模块**不**吞错、也不加工 message）", async () => {
    const onError = vi.fn();
    const boom = new Error("boom");
    fireAndForget(Promise.reject(boom), onError);
    await flushMicrotasks();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it("onError 自己抛了 → 不再向 caller 冒（保证「本函数绝不制造新的 unhandledrejection」的承诺）", async () => {
    // 若 fireAndForget 没兜住 onError 的 throw，这里会在测试环境里
    // 冒出一条 unhandledRejection；vitest 会把它算成失败。断言不炸即通过。
    const onError = vi.fn(() => {
      throw new Error("handler blew up");
    });
    fireAndForget(Promise.reject(new Error("task failed")), onError);
    await flushMicrotasks();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
