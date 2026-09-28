// 队列与运行第①层的纯派生单测。
//
// 三条最容易被改坏的判据都在这里锁住：
//   · **位次方向** —— `task.list` 一律按 createdAt 倒序回来，而执行器排队是先入先出。
//     直接把倒序下标当位次，会把最后提交的那条显示成「第 1 位」，用户会据此判断
//     「我这条还要等很久」，而实际马上开跑。
//   · **算不出就不给数** —— 进度为 0 时任何估算都是编的，必须返回 null。
//   · **桶的边界** —— 未知状态不许被当成在跑（那会显示成「永远在生成中」）。
import { describe, expect, it } from "vitest";

import {
  QUEUED_WINDOW,
  RECENT_WINDOW,
  bucketQueueRows,
  estimateRemainingMs,
  offlineBannerText,
  offlineEmptyText,
  offlineRunningCardNote,
  queuedWithPosition,
  recentWithin,
  remainingText,
  reprintText,
  runningElapsedText,
  runningHintText,
  type QueueRow,
} from "./queue-monitor-config";

/** 只造这一屏真的会读到的字段，其余按契约填死。 */
function row(over: Partial<QueueRow> & Pick<QueueRow, "status">): QueueRow {
  return {
    id: over.id ?? `t-${over.status}`,
    type: "IMAGE",
    workflowName: over.workflowName ?? "测试工作流",
    status: over.status,
    prompt: over.prompt ?? "一句提示词",
    createdAt: over.createdAt ?? new Date("2026-01-01T00:00:00Z"),
    cover: null,
    checkpoint: null,
    mediaType: "image",
    projectId: null,
    progress: over.progress ?? 0,
    error: over.error ?? null,
  };
}

describe("bucketQueueRows", () => {
  it("四个状态各归各位", () => {
    const buckets = bucketQueueRows([
      row({ status: "RUNNING" }),
      row({ status: "QUEUED" }),
      row({ status: "SUCCEEDED" }),
      row({ status: "FAILED" }),
      row({ status: "CANCELLED" }),
    ]);
    expect(buckets.running).toHaveLength(1);
    expect(buckets.queued).toHaveLength(1);
    expect(buckets.recent).toHaveLength(3);
  });

  it("未知状态不被当成在跑、也不许从屏面上消失 —— 归进等待堆", () => {
    const buckets = bucketQueueRows([row({ status: "PAUSED_BY_HUMAN" })]);
    expect(buckets.running).toHaveLength(0);
    // 落在「排队中」而不是「最近结果」：它没被报成正在跑，就更不该显示成已结束。
    expect(buckets.recent).toHaveLength(0);
    expect(buckets.queued.map((r) => r.status)).toEqual(["PAUSED_BY_HUMAN"]);
  });

  it("单并发是现状但不是判据：多条 RUNNING 都留在跑动中一堆", () => {
    const buckets = bucketQueueRows([
      row({ id: "a", status: "RUNNING" }),
      row({ id: "b", status: "RUNNING" }),
    ]);
    expect(buckets.running).toHaveLength(2);
  });
});

describe("queuedWithPosition", () => {
  it("位次 1 = 提交最早的那条（入参是 createdAt 倒序）", () => {
    const early = row({ id: "early", status: "QUEUED" });
    const late = row({ id: "late", status: "QUEUED" });
    const ordered = queuedWithPosition([late, early]);
    expect(ordered.map((e) => [e.row.id, e.position])).toEqual([
      ["early", 1],
      ["late", 2],
    ]);
  });

  it("位次连续且从 1 起，不留空洞", () => {
    const rows = [
      row({ id: "c", status: "QUEUED" }),
      row({ id: "b", status: "QUEUED" }),
      row({ id: "a", status: "QUEUED" }),
    ];
    expect(queuedWithPosition(rows).map((e) => e.position)).toEqual([1, 2, 3]);
  });

  it("超过窗口上限就截断（列表必须有上限）", () => {
    const many = Array.from({ length: QUEUED_WINDOW + 10 }, (_unused, index) =>
      row({ id: `q-${String(index)}`, status: "QUEUED" }),
    );
    expect(queuedWithPosition(many)).toHaveLength(QUEUED_WINDOW);
  });
});

describe("estimateRemainingMs", () => {
  it("进度为 0 时不给数 —— 没有比例的估算都是编的", () => {
    expect(estimateRemainingMs(30_000, 0)).toBeNull();
  });

  it("进度已 100 时也不给数（它在收尾，报剩余只会跳）", () => {
    expect(estimateRemainingMs(60_000, 100)).toBeNull();
  });

  it("跑了 30 秒、完成 25% ⇒ 剩余约 90 秒", () => {
    expect(estimateRemainingMs(30_000, 25)).toBe(90_000);
  });

  it("读侧拿到 null 必须写「估算中」，不留空也不给假数", () => {
    expect(remainingText(null)).toBe("估算中");
    expect(remainingText(90_000)).toBe("约 01:30");
  });

  it("elapsedMs 为 null 的含义是没在跑，不是 0 秒", () => {
    expect(runningElapsedText(null)).toBe("尚未开跑");
    expect(runningElapsedText(65_000)).toBe("01:05");
  });
});

describe("离线文案三件套", () => {
  it("整页空态（离线且一条任务都没有）：只说没连上，不报排队数", () => {
    const state = offlineEmptyText();
    expect(state.title).toContain("未运行");
    expect(state.description).toContain("自动接上");
  });

  it("离线横幅（列表还在时）：说「不会开始」与自动接上，不整页替换", () => {
    const banner = offlineBannerText();
    expect(banner.title).toContain("未连接");
    expect(banner.description).toContain("暂时不会开始");
  });

  it("跑动中空位（在线有排队）：说清「还有几个」", () => {
    const hint = runningHintText(true, 3);
    expect(hint.title).toContain("刚跑完");
    expect(hint.description).toContain("3");
  });

  it("跑动中空位（在线全空）：给出「提交后会发生什么」", () => {
    expect(runningHintText(true, 0).description).toContain("出现在这里");
  });

  it("跑动中空位（离线）：不说「上一条刚跑完」（离线没跑完任何东西），不重复「未连接」", () => {
    const hint = runningHintText(false, 7);
    expect(hint.title).toBe("没有在跑的任务");
    expect(hint.title).not.toContain("刚跑完");
    expect(hint.description).not.toContain("未连接");
  });

  it("离线兜底跑动卡如实说明缺哪些明细，不留空格", () => {
    expect(offlineRunningCardNote()).toContain("未连接");
    expect(offlineRunningCardNote()).toContain("耗时与节点");
  });
});

describe("recentWithin", () => {
  it("最近结果按窗口截断", () => {
    const many = Array.from({ length: RECENT_WINDOW + 5 }, (_unused, index) =>
      row({ id: `r-${String(index)}`, status: "SUCCEEDED" }),
    );
    expect(recentWithin(many)).toHaveLength(RECENT_WINDOW);
  });
});

describe("reprintText", () => {
  it("带上重投要用的三项内容", () => {
    const text = reprintText(
      row({ status: "FAILED", prompt: "海岸黎明", workflowName: "SDXL 风光" }),
    );
    expect(text).toContain("海岸黎明");
    expect(text).toContain("SDXL 风光");
    expect(text).toContain("IMAGE");
  });

  it("不声称复制了参数 —— task.list 里没有参数表", () => {
    expect(reprintText(row({ status: "FAILED" }))).not.toContain("参数");
  });
});
