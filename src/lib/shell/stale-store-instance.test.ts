// 陈旧实例告警的判据契约（规范 11.2：用例名即语义文档）。
// 这是「该不该弹提示、弹什么」的唯一来源：只有两个事实都成立才提示，
// 否则会把「另有原因的动作缺失」误导成「重载就好」。

import { describe, expect, it } from "vitest";

import {
  deriveStaleStoreNotification,
  STALE_STORE_RELOAD_STEPS,
  STALE_STORE_SAFETY_NOTE,
  type StaleStoreSignalInput,
} from "./stale-store-instance";

const signal = (
  over: Partial<StaleStoreSignalInput> = {},
): StaleStoreSignalInput => ({
  codeUpdatedSinceLoad: true,
  reason: "missing-store-action",
  ...over,
});

describe("deriveStaleStoreNotification", () => {
  it("跑过代码更新 + 观测到动作缺失 → 给出提示", () => {
    const n = deriveStaleStoreNotification(signal());
    expect(n).not.toBeNull();
    expect(n!.title).toContain("重载");
  });

  it("没有做任何一次代码更新 → 不提示（一切正常，不该打扰）", () => {
    expect(
      deriveStaleStoreNotification(signal({ codeUpdatedSinceLoad: false })),
    ).toBeNull();
  });

  it("跑过代码更新但没观测到动作缺失 → 不提示（HMR 已覆盖的常态）", () => {
    expect(deriveStaleStoreNotification(signal({ reason: null }))).toBeNull();
  });

  it("正文必须给出「怎么办」的步骤，而不是只说出了什么事", () => {
    const n = deriveStaleStoreNotification(signal())!;
    for (const step of STALE_STORE_RELOAD_STEPS) {
      expect(n.body).toContain(step);
    }
    // 步骤编号连续，读者能照着做
    expect(n.body).toContain("1. ");
    expect(n.body).toContain(`${STALE_STORE_RELOAD_STEPS.length}. `);
  });

  it("正文必须说明「不会丢工作」，否则用户不敢重载", () => {
    const n = deriveStaleStoreNotification(signal())!;
    expect(n.body).toContain(STALE_STORE_SAFETY_NOTE);
    expect(n.body).toContain("不受影响");
  });

  it("正文点明这是运行态与源码不一致，不是工作流坏了", () => {
    const n = deriveStaleStoreNotification(signal())!;
    expect(n.body).toContain("不是工作流本身坏了");
  });

  it("概要是一句话，不复述正文（toast 位置很短）", () => {
    const n = deriveStaleStoreNotification(signal())!;
    expect(n.summary.length).toBeLessThan(80);
    expect(n.body).not.toContain(n.summary);
  });
});
