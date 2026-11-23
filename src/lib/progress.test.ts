/**
 * 「异步动作的进度」数值口径的判据（规范 16 §16.2.4.19）。
 *
 * 这条账与 `display-value` / `list-filter` 同族：**不是重复代码，是口径**。
 * 全库 10 处各写一遍「把某个数变成进度条宽度」，而写法分四派：
 *
 *   · `Math.max(4, p)`  —— 一个**下限**（0% 时也画一格），另外六处没有
 *   · `Math.min(100, (done / total) * 100)` —— 自己算比例
 *   · 直接 `${x}%`      —— 不夹取，接口给 120 就溢出
 *
 * 三条都编译、都运行、类型都对，差别只在几个**语义决定**上。用例重点即这几点：
 *   1. 夹取到 `[0, 100]`（负值不反着画、超量不溢出）；
 *   2. 非有限数（NaN / Infinity）**不当 0** 之外还得分清「确定 0」与「不确定」；
 *   3. `toPct` 在分母不可用时给 `null`（不确定态），不是 0；
 *   4. `pctToWidth` 的**下限只抬非零值** —— 0 恒为 0（这正是 `Math.max(4, 0)`
 *      那个旧写法的缺陷：没开始也画成跑了 4%）。
 */
import { describe, expect, it } from "vitest";

import {
  PROGRESS_MAX,
  clampPct,
  describeSampleProgress,
  estimateRemainingMsFrom,
  formatDurationMs,
  formatSampleRateText,
  formatStepsText,
  pctToWidth,
  readProgressNodeSteps,
  toPct,
} from "./progress";

describe("clampPct", () => {
  it("夹取到 [0, 100] 并取整", () => {
    expect(clampPct(0)).toBe(0);
    expect(clampPct(42.4)).toBe(42);
    expect(clampPct(42.6)).toBe(43);
    expect(clampPct(100)).toBe(100);
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(120)).toBe(100);
  });

  it("非有限数落到 0（此处是「确定值」语义）", () => {
    expect(clampPct(Number.NaN)).toBe(0);
    expect(clampPct(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampPct(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("上限就是 100", () => {
    expect(PROGRESS_MAX).toBe(100);
  });
});

describe("toPct", () => {
  it("正常分母给出百分比", () => {
    expect(toPct(3, 10)).toBe(30);
    expect(toPct(1, 3)).toBe(33);
    expect(toPct(0, 10)).toBe(0);
    expect(toPct(10, 10)).toBe(100);
  });

  it("分母不可用 → null（不确定态），不是 0", () => {
    /* 「总数未知」与「进度是 0」是两件事：前者该给滑动条纹，
       后者该给空条。混为一谈正是 ParseProgressBanner 那处
       `progress.total > 0 ? … : 0` 的写法要修的地方。 */
    expect(toPct(3, 0)).toBeNull();
    expect(toPct(3, -1)).toBeNull();
    expect(toPct(3, Number.NaN)).toBeNull();
    expect(toPct(3, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("分子不可用 → null", () => {
    expect(toPct(Number.NaN, 10)).toBeNull();
    expect(toPct(Number.POSITIVE_INFINITY, 10)).toBeNull();
  });

  it("超量与负量都夹取", () => {
    expect(toPct(20, 10)).toBe(100);
    expect(toPct(-3, 10)).toBe(0);
  });
});

describe("pctToWidth", () => {
  it("无下限时就是夹取后的值", () => {
    expect(pctToWidth(0)).toBe(0);
    expect(pctToWidth(50)).toBe(50);
    expect(pctToWidth(150)).toBe(100);
    expect(pctToWidth(-10)).toBe(0);
  });

  it("null（不确定态）宽度为 0 —— 不确定的动效由组件给条纹，不是宽度", () => {
    expect(pctToWidth(null)).toBe(0);
  });

  it("minVisible 只抬非零值：0 恒为 0", () => {
    /* 这一条是本出口存在的理由。旧写法 `Math.max(4, p)` 会把「没开始」
       也画成 4% 宽；新口径是「0 就是 0，刚开始才给一格」。 */
    expect(pctToWidth(0, { minVisible: 4 })).toBe(0);
    expect(pctToWidth(1, { minVisible: 4 })).toBe(4);
    expect(pctToWidth(3.2, { minVisible: 4 })).toBe(4);
    expect(pctToWidth(50, { minVisible: 4 })).toBe(50);
  });

  it("minVisible 也不越过 100", () => {
    expect(pctToWidth(100, { minVisible: 200 })).toBe(100);
  });
});

// ── 采样进度的人类可读描述（生图进度条上的 tqdm 式明细）────────────
// 用户在 ComfyUI 控制台看到的是 `7%|▋| 553/8196 [00:42<10:07, 12.58it/s]`；
// 应用侧从结构化 progress 帧（value/max）+ 开始时刻算出同一套信息。

describe("formatDurationMs", () => {
  it("mm:ss，不满一小时不带小时位", () => {
    expect(formatDurationMs(0)).toBe("00:00");
    expect(formatDurationMs(42_000)).toBe("00:42");
    expect(formatDurationMs(10 * 60_000 + 7000)).toBe("10:07");
  });

  it("满一小时进位 h:mm:ss", () => {
    expect(formatDurationMs(3_600_000)).toBe("1:00:00");
    expect(formatDurationMs(3_723_000)).toBe("1:02:03");
  });

  it("负数当 0（不显示负时长）", () => {
    expect(formatDurationMs(-5)).toBe("00:00");
  });
});

describe("estimateRemainingMsFrom", () => {
  it("线性外推：25% 用了 30s ⇒ 还剩 90s", () => {
    expect(estimateRemainingMsFrom(30_000, 25)).toBe(90_000);
  });

  it("两端与非法输入给 null（不编数）", () => {
    expect(estimateRemainingMsFrom(30_000, 0)).toBeNull();
    expect(estimateRemainingMsFrom(60_000, 100)).toBeNull();
    expect(estimateRemainingMsFrom(30_000, 120)).toBeNull();
    expect(estimateRemainingMsFrom(Number.NaN, 50)).toBeNull();
  });
});

describe("formatStepsText", () => {
  it("已完成 / 总步数", () => {
    expect(formatStepsText(553, 8196)).toBe("553/8196");
  });

  it("小数取整（帧里偶发带小数）", () => {
    expect(formatStepsText(10.4, 20.6)).toBe("10/21");
  });

  it("任一侧不可用给 null，不显示假步数", () => {
    expect(formatStepsText(null, 10)).toBeNull();
    expect(formatStepsText(5, null)).toBeNull();
    expect(formatStepsText(5, 0)).toBeNull();
    expect(formatStepsText(-1, 10)).toBeNull();
    expect(formatStepsText(Number.NaN, 10)).toBeNull();
  });
});

describe("formatSampleRateText", () => {
  it("平均速率 = 步数 ÷ 秒，两位小数", () => {
    /* tqdm 的 12.58it/s 是平滑瞬时值；这里是全程平均，口径不同、都对。 */
    expect(formatSampleRateText(553, 44_000)).toBe("12.57 it/s");
    expect(formatSampleRateText(100, 10_000)).toBe("10.00 it/s");
  });

  it("步数或耗时不可用给 null", () => {
    expect(formatSampleRateText(null, 1000)).toBeNull();
    expect(formatSampleRateText(10, null)).toBeNull();
    expect(formatSampleRateText(0, 1000)).toBeNull();
    expect(formatSampleRateText(10, 0)).toBeNull();
  });
});

describe("readProgressNodeSteps", () => {
  it("executor-ws 落库的形状 {id, value, max, …}", () => {
    expect(readProgressNodeSteps({ id: "7", classType: "KSampler", value: 3, max: 20 })).toEqual({
      value: 3,
      max: 20,
    });
  });

  it("数字串也认（JSON 列里可能存成串）", () => {
    expect(readProgressNodeSteps({ value: "12", max: "100" })).toEqual({ value: 12, max: 100 });
  });

  it("null / 非对象 / 缺字段 → 两个字段都 null（按拿不到降级）", () => {
    expect(readProgressNodeSteps(null)).toEqual({ value: null, max: null });
    expect(readProgressNodeSteps("x")).toEqual({ value: null, max: null });
    expect(readProgressNodeSteps({})).toEqual({ value: null, max: null });
    expect(readProgressNodeSteps({ value: "abc", max: null })).toEqual({
      value: null,
      max: null,
    });
  });
});

describe("describeSampleProgress", () => {
  const snap = { pct: 7, value: 553, max: 8196, startedAtMs: 1_000_000 };

  it("tqdm 那一行的四个数都能算出来", () => {
    const d = describeSampleProgress(snap, 1_000_000 + 42_000);
    expect(d.pct).toBe(7);
    expect(d.stepsText).toBe("553/8196");
    expect(d.elapsedText).toBe("00:42");
    /* 平均速率：553 步 / 42s ≈ 13.17 it/s。 */
    expect(d.rateText).toBe("13.17 it/s");
    /* 线性外推：42s 跑了 7% ⇒ 全程 600s，还剩 558s = 09:18。 */
    expect(d.etaText).toBe("09:18");
  });

  it("没有开始时刻：耗时 / 剩余 / 速度不编数，步数照常", () => {
    const d = describeSampleProgress({ ...snap, startedAtMs: null }, 1_000_000);
    expect(d.elapsedText).toBeNull();
    expect(d.etaText).toBeNull();
    expect(d.rateText).toBeNull();
    expect(d.stepsText).toBe("553/8196");
  });

  it("没有步数：速度与步数不给，时间照常", () => {
    const d = describeSampleProgress({ pct: 50, value: null, max: null, startedAtMs: 0 }, 30_000);
    expect(d.stepsText).toBeNull();
    expect(d.rateText).toBeNull();
    expect(d.elapsedText).toBe("00:30");
    expect(d.etaText).toBe("00:30");
  });

  it("0% 与 100% 不给剩余（还没起步 / 已收尾）", () => {
    expect(describeSampleProgress({ ...snap, pct: 0 }, 1_042_000).etaText).toBeNull();
    expect(describeSampleProgress({ ...snap, pct: 100 }, 1_042_000).etaText).toBeNull();
  });
});
