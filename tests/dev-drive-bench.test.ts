import { describe, expect, it } from "vitest";

import {
  compareTargets,
  formatThroughput,
  thirdPartyEngineUsage,
  topCpuConsumers,
} from "../scripts/dev-drive-bench.mjs";

/**
 * 契约测试：I/O 实测层的**纯函数**（不碰磁盘、不起进程）。
 *
 * 为什么要钉住「第三方筛选器有没有在拖慢 I/O」这件事的三档判定：
 * 「卷上挂了第三方过滤驱动」是机器状态，「它在扫」是另一回事 ——
 * 混成一档就会得出「挂着就是慢 → 去改安全策略」这种不可逆结论。
 * 实测到它没干活时，正确动作是**不动**。
 */

/** 实测结果里的一侧。 */
type Target = {
  label: string;
  dir: string;
  bigWriteMbps: number | null;
  bigReadMbps: number | null;
  smallCreatePerSec: number | null;
  smallReadPerSec: number | null;
  elapsedMs: number;
  cpuTop: Array<{ name: string; seconds: number }>;
  watched: Array<{
    filter: string;
    process: string;
    label: string;
    present: boolean;
    seconds: number;
    known: boolean;
  }>;
};

/** 造一侧的实测结果。 */
function makeTarget(overrides: Partial<Target> = {}): Target {
  return {
    label: "开发卷",
    dir: "G:\\.workbuddy\\dev-drive-bench",
    bigWriteMbps: 2900,
    bigReadMbps: 7300,
    smallCreatePerSec: 2553,
    smallReadPerSec: 8636,
    elapsedMs: 3031,
    cpuTop: [],
    watched: [],
    ...overrides,
  };
}

describe("CPU 消耗榜", () => {
  it("按消耗降序，并只留前几名", () => {
    const entries = [
      { name: "a", seconds: 1 },
      { name: "b", seconds: 9 },
      { name: "c", seconds: 5 },
    ];
    expect(topCpuConsumers(entries, 2)).toEqual([
      { name: "b", seconds: 9 },
      { name: "c", seconds: 5 },
    ]);
  });

  it("不改动传入的数组（原数组顺序不变）", () => {
    const entries = [
      { name: "a", seconds: 1 },
      { name: "b", seconds: 9 },
    ];
    topCpuConsumers(entries, 1);
    expect(entries[0]?.name).toBe("a");
  });
});

describe("吞吐渲染", () => {
  it("四项都在时逐项写出来", () => {
    const text = formatThroughput(makeTarget());
    expect(text).toContain("顺序写 2900 MB/s");
    expect(text).toContain("小文件创建 2553 个/秒");
  });

  it("缺项就不写那一项（不写 0）", () => {
    const text = formatThroughput(makeTarget({ bigReadMbps: null, smallReadPerSec: null }));
    expect(text).not.toContain("顺序读");
    expect(text).not.toContain("小文件读");
  });
});

describe("两块卷逐项比", () => {
  it("没有参考卷 → 不可比，不给结论", () => {
    const compare = compareTargets(makeTarget(), null);
    expect(compare.comparable).toBe(false);
    expect(compare.devFaster).toBeNull();
  });

  it("比值是「开发卷 ÷ 参考卷」", () => {
    const compare = compareTargets(
      makeTarget({ bigWriteMbps: 2000 }),
      makeTarget({ label: "参考卷", bigWriteMbps: 1000 }),
    );
    expect(compare.ratios.bigWrite).toBe(2);
  });

  it("开发卷四项都不慢 → 判为更快", () => {
    const compare = compareTargets(
      makeTarget(),
      makeTarget({ label: "参考卷", bigWriteMbps: 1000, smallCreatePerSec: 500 }),
    );
    expect(compare.comparable).toBe(true);
    expect(compare.devFaster).toBe(true);
  });

  it("有一项更慢 → 不判为全面更快", () => {
    const compare = compareTargets(
      makeTarget({ smallCreatePerSec: 100 }),
      makeTarget({ label: "参考卷", smallCreatePerSec: 900 }),
    );
    expect(compare.devFaster).toBe(false);
  });

  it("参考卷那一项读数为 0 → 不比那一项（不拿 0 当分母）", () => {
    const compare = compareTargets(makeTarget(), makeTarget({ label: "参考卷", bigWriteMbps: 0 }));
    expect(compare.ratios.bigWrite).toBeNull();
  });
});

describe("第三方引擎到底干没干活", () => {
  const bench = (watched: Target["watched"]) => ({
    ran: true,
    note: "",
    bigMB: 256,
    smallCount: 1000,
    targets: [makeTarget({ watched })],
  });

  it("引擎吃到了 CPU → 判定为在扫", () => {
    const usage = thirdPartyEngineUsage(
      bench([
        {
          filter: "lnvscenter",
          process: "wsctrl11",
          label: "联想 / 火绒",
          present: true,
          seconds: 12.5,
          known: true,
        },
      ]),
      ["lnvscenter"],
    );
    expect(usage.state).toBe("busy");
    expect(usage.seconds).toBe(12.5);
  });

  it("引擎在跑但 CPU 增量为 0 → 判定为没在扫", () => {
    const usage = thirdPartyEngineUsage(
      bench([
        {
          filter: "lnvscenter",
          process: "wsctrl11",
          label: "联想 / 火绒",
          present: true,
          seconds: 0,
          known: true,
        },
      ]),
      ["lnvscenter"],
    );
    expect(usage.state).toBe("idle");
  });

  it("引擎压根没在跑 → 判定为没在扫", () => {
    const usage = thirdPartyEngineUsage(
      bench([
        {
          filter: "lnvscenter",
          process: "wsctrl11",
          label: "联想 / 火绒",
          present: false,
          seconds: 0,
          known: true,
        },
      ]),
      ["lnvscenter"],
    );
    expect(usage.state).toBe("idle");
  });

  it("认不出对应进程 → 不判（不猜）", () => {
    const usage = thirdPartyEngineUsage(
      bench([
        {
          filter: "someOther",
          process: "",
          label: "未知",
          present: false,
          seconds: 0,
          known: false,
        },
      ]),
      ["someOther"],
    );
    expect(usage.state).toBe("unknown");
  });

  it("没跑实测 → 不判", () => {
    expect(thirdPartyEngineUsage(null, ["lnvscenter"]).state).toBe("unknown");
  });
});
