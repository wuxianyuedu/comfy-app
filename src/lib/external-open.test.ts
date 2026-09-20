// @vitest-environment jsdom
/**
 * `~/lib/external-open` —— 「触发一次外部动作」的唯一出口（规范 16 §16.2.4.25）。
 *
 * 用例钉的是收口前**各判各的**那几处：
 *  ① 结果字段不统一（`ok` / `triggered`）→ `toExternalResult` 归一；
 *  ② 空目标只有一处拦过 → `isEmptyTarget` / `emptyTargetText`；
 *  ③ 失败文案各处手写 → `externalFailureText`；
 *  ④ 自定义协议「助手是否接管」的探测只有一处写了 → `detectFolderHelper`。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detectFolderHelper,
  emptyTargetText,
  externalFailureText,
  isEmptyTarget,
  toExternalResult,
} from "./external-open";

afterEach(() => {
  vi.useRealTimers();
});

describe("toExternalResult", () => {
  it("读 ok（openExternal / comfyOpen / dbStudioOpen 的形状）", () => {
    expect(toExternalResult({ ok: true, detail: "已打开" })).toEqual({
      ok: true,
      detail: "已打开",
    });
    expect(toExternalResult({ ok: false, detail: "端口变了" })).toEqual({
      ok: false,
      detail: "端口变了",
    });
  });

  it("也读 triggered（更新器的形状）—— 这正是三处各自记错的地方", () => {
    expect(toExternalResult({ triggered: true, detail: "即将重启" })).toEqual({
      ok: true,
      detail: "即将重启",
    });
    expect(toExternalResult({ triggered: false, detail: "下载失败" }).ok).toBe(
      false,
    );
  });

  it("两个字段都没有时按失败处理（不是「默认成功」）", () => {
    const r = toExternalResult({});
    expect(r.ok).toBe(false);
    expect(r.detail).toBeTruthy();
  });

  it("`error` 与 `detail` 都能当说明（服务端两种都出现过）", () => {
    expect(toExternalResult({ ok: false, error: "目录不存在" }).detail).toBe(
      "目录不存在",
    );
    expect(
      toExternalResult({ ok: false, detail: "详情", error: "错误" }).detail,
    ).toBe("详情");
  });

  it("成功也带说明（用户据此确认「点了有反应」）", () => {
    expect(toExternalResult({ ok: true }).detail).toBeTruthy();
  });
});

describe("空目标拦截", () => {
  it("null / undefined / 空串 / 全空白都算空", () => {
    expect(isEmptyTarget(null)).toBe(true);
    expect(isEmptyTarget(undefined)).toBe(true);
    expect(isEmptyTarget("")).toBe(true);
    expect(isEmptyTarget("   ")).toBe(true);
    expect(isEmptyTarget("https://x")).toBe(false);
  });

  it("按目标类别给可读文案（不是服务端 zod 的英文报错）", () => {
    expect(emptyTargetText("browser")).toContain("资源地址");
    expect(emptyTargetText("folder")).toContain("目录");
    expect(emptyTargetText("update")).toContain("更新");
    expect(emptyTargetText("relaunch")).toContain("重启");
  });
});

describe("失败文案", () => {
  it("按目标给动词（不在各处手写）", () => {
    expect(externalFailureText("browser")).toBe("在浏览器打开失败");
    expect(externalFailureText("folder")).toBe("打开目录失败");
    expect(externalFailureText("update")).toBe("检查更新失败");
  });
});

describe("detectFolderHelper", () => {
  it("窗口内页面失焦 → handled（OS 已接管）", async () => {
    vi.useFakeTimers();
    const onHandled = vi.fn();
    const helper = detectFolderHelper(onHandled, 2000);
    window.dispatchEvent(new Event("blur"));
    expect(onHandled).toHaveBeenCalledTimes(1);
    await expect(
      vi.advanceTimersByTimeAsync(2000).then(() => helper.settle()),
    ).resolves.toBe("handled");
  });

  it("窗口内没有失焦 → missing（助手未注册，必须给出安装引导）", async () => {
    vi.useFakeTimers();
    const helper = detectFolderHelper(undefined, 2000);
    const settled = helper.settle();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(settled).resolves.toBe("missing");
  });

  it("多次失焦只回调一次（onHandled 不该被按次数重复触发）", () => {
    vi.useFakeTimers();
    const onHandled = vi.fn();
    detectFolderHelper(onHandled, 2000);
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("blur"));
    expect(onHandled).toHaveBeenCalledTimes(1);
  });

  it("失焦发生在超时窗口内也按 handled 收尾（不是 missing）", async () => {
    vi.useFakeTimers();
    const helper = detectFolderHelper(undefined, 2000);
    const settled = helper.settle();
    /* 先失焦、再走到超时回调：落点在「超时那一刻再读一次 handled」。 */
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(2000);
    await expect(settled).resolves.toBe("handled");
  });

  it("已失焦时立刻拿到 handled（不白等一个窗口）", async () => {
    vi.useFakeTimers();
    const helper = detectFolderHelper(undefined, 2000);
    window.dispatchEvent(new Event("blur"));
    await expect(helper.settle()).resolves.toBe("handled");
  });
});
