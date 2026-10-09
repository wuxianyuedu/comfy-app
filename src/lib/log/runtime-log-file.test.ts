/**
 * 四份 runtime 日志「一次启动一份文件」的判据（ISSUE #1326）。
 *
 * 用户原话：「comfyui-runtime.log / ollama-runtime.log /
 * drizzle-studio-runtime.log / app-runtime.log 这四份也要改成每个文件只存储单次
 * 运行的历史，单次里如果执行多次也存放多个文件，这样看起来清晰。」
 *
 * 两条会**静默出错**的现场各对应一组判据：
 *   1. 名字带冒号 → Windows 上 `appendFileSync` 直接失败，用户只看到「文件一直
 *      没出现」（所以这条要按字符判，不能只在 Linux 上跑绿）；
 *   2. 同一秒内第二次启动覆盖第一次 → 第一次的失败现场消失，而那次恰恰最该看。
 */
import { describe, expect, it } from "vitest";

import {
  RUNTIME_LOG_SOURCES,
  legacyRuntimeLogFileName,
  parseRuntimeLogFileName,
  runtimeLogFileLabel,
  runtimeLogFileName,
} from "./runtime-log-file";

/** 固定时刻（本地时区，避免用例依赖运行机器的时区）。 */
const AT = new Date(2026, 9, 5, 9, 36, 12);

describe("文件名形态", () => {
  it("是 <来源>-<YYYYMMDD-HHmmss>.log", () => {
    expect(runtimeLogFileName("comfyui-runtime", AT)).toBe(
      "comfyui-runtime-20261005-093612.log",
    );
  });

  it("**不含冒号**（Windows 下 : 是非法文件名字符，带上它就是静默失败）", () => {
    for (const source of RUNTIME_LOG_SOURCES) {
      const name = runtimeLogFileName(source, AT);
      expect(name.includes(":")).toBe(false);
      /* 同时排掉 Windows 的其它非法字符（\\ / * ? " < > |） */
      expect(/[\\/*?"<>|]/.test(name)).toBe(false);
    }
  });

  it("字典序 = 时间序（ls 一眼就是时间线）", () => {
    const a = runtimeLogFileName(
      "ollama-runtime",
      new Date(2026, 9, 5, 9, 0, 0),
    );
    const b = runtimeLogFileName(
      "ollama-runtime",
      new Date(2026, 9, 5, 10, 0, 0),
    );
    const c = runtimeLogFileName(
      "ollama-runtime",
      new Date(2026, 8, 30, 23, 59, 59),
    );
    expect([b, a, c].sort()).toEqual([c, a, b]);
  });

  it("同一秒内第二次启动分叉出 -2（**不覆盖**前一次的现场）", () => {
    expect(runtimeLogFileName("comfyui-runtime", AT, 2)).toBe(
      "comfyui-runtime-20261005-093612-2.log",
    );
    expect(runtimeLogFileName("comfyui-runtime", AT, 1)).not.toBe(
      runtimeLogFileName("comfyui-runtime", AT, 2),
    );
  });

  it("四个来源的名字都认（来源键带连字符，必须从右往左切才能容纳）", () => {
    for (const source of RUNTIME_LOG_SOURCES) {
      const name = runtimeLogFileName(source, AT);
      expect(parseRuntimeLogFileName(name)?.source).toBe(source);
    }
  });
});

describe("解析", () => {
  it("回时刻（本地时区）与序号", () => {
    const parsed = parseRuntimeLogFileName(
      "comfyui-runtime-20261005-093612.log",
    );
    expect(parsed?.source).toBe("comfyui-runtime");
    expect(parsed?.startedAt).toBe(AT.getTime());
    expect(parsed?.ordinal).toBe(1);

    const second = parseRuntimeLogFileName(
      "comfyui-runtime-20261005-093612-3.log",
    );
    expect(second?.ordinal).toBe(3);
    expect(second?.startedAt).toBe(AT.getTime());
  });

  it("形态不符返回 null（不从不相关的文件名里猜一个时刻出来）", () => {
    for (const bad of [
      "",
      "comfyui-runtime.log", // 旧固定名：它是「迁移前的历史」，不是一次启动
      "comfyui-runtime-20261005.log",
      "comfyui-runtime-20261005-0936.log",
      "nextjs-panel-12345-1769000000000.log",
      "comfyui-keepalive-2026-10-05-09-36-12.out.log",
      "comfyui-trace.log",
    ]) {
      expect(parseRuntimeLogFileName(bad)).toBeNull();
    }
  });

  it("旧固定名的形态由 legacyRuntimeLogFileName 给（读侧要认得它）", () => {
    expect(legacyRuntimeLogFileName("ollama-runtime")).toBe(
      "ollama-runtime.log",
    );
    /* 它与新形态**必须**互斥：一致的话 `parse` 会把迁移前那份也当成一次启动，
     * 于是它在列表里拿不到「更早的日志」这个说得通的位置。 */
    expect(
      parseRuntimeLogFileName(legacyRuntimeLogFileName("ollama-runtime")),
    ).toBeNull();
  });
});

describe("下拉文案", () => {
  it("日期 + 时刻都要（只有 HH:mm:ss 时「昨天那次」与「今天那次」看起来一样）", () => {
    expect(
      runtimeLogFileLabel(
        parseRuntimeLogFileName("ollama-runtime-20261005-093612.log")!,
      ),
    ).toBe("10-05 09:36:12");
    expect(
      runtimeLogFileLabel(
        parseRuntimeLogFileName("ollama-runtime-20260930-190000.log")!,
      ),
    ).toBe("09-30 19:00:00");
  });

  it("读不到时刻（旧固定名）给「更早的日志」，不是退回文件名", () => {
    /* 退回文件名的后果：`comfyui-runtime.log` 读起来像是「现在那一份」，而它
     * 实际是所有新份之前的全部历史 —— 用户会据此挑错。 */
    expect(
      runtimeLogFileLabel({ source: "", startedAt: null, ordinal: 1 }),
    ).toBe("更早的日志");
  });
});

describe("来源键的单一出处", () => {
  it("四个来源恰好是那四份（新增一个必须同批想清「面板怎么列它」）", () => {
    expect([...RUNTIME_LOG_SOURCES].sort()).toEqual([
      "app-runtime",
      "comfyui-runtime",
      "drizzle-studio-runtime",
      "ollama-runtime",
    ]);
  });
});
