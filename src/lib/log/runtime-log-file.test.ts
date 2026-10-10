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
  parseLaunchStamp,
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

/* ── 本次启动的名字戳（跨进程补齐通道）──────────────────────────────
 *
 * `app-runtime` 的预检提醒（壳过期 / pnpm 不匹配）发生在 dev server 就绪**之前**，
 * 只能由 launcher 自己落盘。它落进去的必须是**同一份** —— 判据就是「同一个戳
 * 解析出的时刻，喂回 `runtimeLogFileName` 得到同一个名字」。
 */
describe("parseLaunchStamp（launcher → dev server 的名字戳）", () => {
  it("解出与 runtimeLogFileName 同一个名字（两个进程落在同一份上）", () => {
    const stamp = "20261010-053059";
    const at = parseLaunchStamp(stamp);
    expect(at).not.toBeNull();
    expect(runtimeLogFileName("app-runtime", at!)).toBe(
      `app-runtime-${stamp}.log`,
    );
  });

  it("缺值 / 空串给 null（非双击链路启动：根本没有 launcher 要合并）", () => {
    expect(parseLaunchStamp(undefined)).toBeNull();
    expect(parseLaunchStamp("")).toBeNull();
  });

  it("形态不符给 null —— **不硬拼一个名字**", () => {
    /* 硬拼的后果是写进一份谁都认不出、也不在本模块轮转清单里的文件：它永远
     * 不被清理，只在磁盘慢慢涨起来时才被发现（静默）。所以判据是「宁可退回
     * 当前时刻另开一份，也不拼半个名字」。 */
    for (const bad of [
      "2026-10-10-05-30-59", // runStamp 的形态（带分隔符）—— 两个形态别混
      "20261010-0530", // 缺秒
      "20261010053 059",
      "app-runtime-20261010-053059.log",
      "今晚",
    ]) {
      expect(parseLaunchStamp(bad)).toBeNull();
    }
  });
});
