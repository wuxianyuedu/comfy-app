/**
 * `ci-ga-verdict-attendance.mjs` 的用例（ISSUE #3378）：`run` 全用假件、一次网络请求都不发；
 * 「现在」由 `now` 钉住（沿用出勤两族的纪律）—— 不钉住它这一档会随真实时间自己变红。
 */
import { describe, expect, it, vi } from "vitest";

import {
  CALLBACK_EVENT,
  main,
  readAttendance,
  summarizeCallbackBuilds,
} from "../scripts/ci-ga-verdict-attendance.mjs";

/* 钉住的「现在」：2026-11-08T12:00:00Z。窗口内的读数都按它算。 */
const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const IN_WINDOW = new Date(NOW - 2 * 3_600_000).toISOString();

const env = { now: NOW, slug: "moon-read/comfy-app-t3" };

/** 造一份 `get-build-logs` 的应答（不满一页 ⇒ 覆盖自证天然成立）。 */
function listResponse(rows: Array<Record<string, unknown>>) {
  return JSON.stringify({ data: { data: rows, total: String(rows.length) }, status: 200 });
}

/** 造一个假 run：只答 `get-build-logs`，其余按取不到处理。 */
function runWith(rows: Array<Record<string, unknown>> | null) {
  return (_cmd: string, args: Array<string>) => {
    if (args[1] === "get-build-logs") {
      return rows === null
        ? { error: "ENOENT", stderr: "", stdout: "", status: -1 }
        : { error: null, stderr: "", stdout: listResponse(rows), status: 0 };
    }
    return { error: "ENOENT", stderr: "", stdout: "", status: -1 };
  };
}

describe("summarizeCallbackBuilds：只认 event 原值，不猜", () => {
  it("非回调事件一条都不算，终态按原值分堆", () => {
    const got = summarizeCallbackBuilds([
      { createTime: IN_WINDOW, event: "pull_request", status: "success" },
      { createTime: IN_WINDOW, event: CALLBACK_EVENT, status: "success" },
      { createTime: IN_WINDOW, event: CALLBACK_EVENT, status: "error" },
      { createTime: IN_WINDOW, event: CALLBACK_EVENT, status: "success" },
      { createTime: IN_WINDOW, event: "api_trigger_ga_verdict_probe", status: "success" },
    ]);
    expect(got.total).toBe(5);
    expect(got.matched).toBe(3);
    expect(got.byStatus).toEqual({ success: 2, error: 1 });
    expect(got.latest).toBe(IN_WINDOW);
  });

  it("列表不是数组时给空读数，不抛", () => {
    expect(summarizeCallbackBuilds(null).matched).toBe(0);
    expect(summarizeCallbackBuilds({ data: [] }).matched).toBe(0);
  });
});

describe("readAttendance：三态 + 覆盖自证", () => {
  it("窗口内有回调 build ⇒ 0（出勤）", () => {
    const got = readAttendance({
      ...env,
      run: runWith([{ createTime: IN_WINDOW, event: CALLBACK_EVENT, status: "success" }]),
    });
    expect(got.ok).toBe(true);
    if (!got.ok) throw new Error("unreachable：ok=true 已由上一行断言");
    expect(got.code).toBe(0);
    expect(got.summary.matched).toBe(1);
    expect(got.coverage).toContain("取满窗口");
  });

  it("窗口盖满但一条都没有 ⇒ 1（缺勤），不是没结论", () => {
    const got = readAttendance({
      ...env,
      run: runWith([{ createTime: IN_WINDOW, event: "pull_request", status: "success" }]),
    });
    expect(got.ok).toBe(true);
    if (!got.ok) throw new Error("unreachable：ok=true 已由上一行断言");
    expect(got.code).toBe(1);
    expect(got.summary.matched).toBe(0);
  });

  it("列表取不到 ⇒ 2（没结论），不冒充缺勤", () => {
    const got = readAttendance({ ...env, run: runWith(null) });
    expect(got.ok).toBe(false);
    if (got.ok) throw new Error("unreachable：ok=false 已由上一行断言");
    expect(got.why).toContain("取不到构建列表");
    expect(main([], { ...env, run: runWith(null) })).toBe(2);
  });
});

describe("main：0 出勤那行要把边界念出来", () => {
  it("缺勤时明说「CNB 侧没收到 ≠ GA 判红」", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const code = main([], {
        ...env,
        run: runWith([{ createTime: IN_WINDOW, event: "pull_request", status: "success" }]),
      });
      expect(code).toBe(1);
      const lines = spy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(lines).toContain("不等于 GA 判红");
      expect(lines).toContain("覆盖自证");
    } finally {
      spy.mockRestore();
    }
  });

  it("--json 给机器可读的三态", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(
        main(["--json"], {
          ...env,
          run: runWith([{ createTime: IN_WINDOW, event: CALLBACK_EVENT, status: "success" }]),
        }),
      ).toBe(0);
      const out = spy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(out).toContain('"matched": 1');
      expect(out).toContain('"code": 0');
    } finally {
      spy.mockRestore();
    }
  });
});
