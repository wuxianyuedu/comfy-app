/**
 * 槽锁与盘面原语（`scripts/ci-slot-apply.mjs`）的回归判据。
 *
 * #3479 退役依赖面缓存槽的执行档之后，这份文件留下的是**仍被共用的三件原语**：
 * `acquireSlotLock`（构建缓存槽建槽前互斥）、`hasRoomForSlot` / `statfsFreeBytes`
 * （构建缓存槽与发布 Bundle 共用的盘面量具）。依赖槽执行面（`applySlot` 一族 /
 * 配额与 TTL 淘汰 / 邮票）随退役剪掉 —— 机制与四条实测记录在规范 §13.5.3.4.3
 * 与 §13.5.37。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireSlotLock,
  FREE_SPACE_FLOOR_BYTES,
  hasRoomForSlot,
  statfsFreeBytes,
} from "../scripts/ci-slot-apply.mjs";

let job: string;
let cache: string;
let slot: string;

beforeEach(() => {
  job = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-slot-job-"));
  cache = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-slot-cache-"));
  slot = path.join(cache, "some-key");
});

afterEach(() => {
  for (const dir of [job, cache]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("空闲与锁：两条「不够就不做」的闸", () => {
  it("statfsFreeBytes 在真实路径上读得出正数（量具不是恒 0）", () => {
    const free = statfsFreeBytes(job);
    // 读不到就当场把「量具没量到」说清楚：这一格失败意味着机制会在唯一需要它的地方
    // 静默退回普通装，而平台日志照样绿 —— 那不是「测试红」，那是「这次什么都没证明」。
    if (free === null) {
      throw new Error(`statfsFreeBytes 在 ${job} 上读不到数`);
    }
    expect(Number.isFinite(free)).toBe(true);
    expect(free).toBeGreaterThan(0);
  });

  it("槽根还不存在时照样读得出所在卷的自由空间（这条以前反过来钉）", () => {
    // 旧断言写的是「路径不存在 ⇒ null」，而那正是**空转的成因**：槽根在第一次被建出来
    // 之前必然不存在，null 被 `hasRoomForSlot` 判成「不够」，于是开关拨下去也永远不建槽
    // —— 节点上实测到了（#2049 合并后槽根目录仍未被创建，而 CI 全绿，因为回退本来就绿）。
    // 自由空间是卷级事实，向上取最近存在的祖先读到的就是同一个数。
    const missing = path.join(cache, "这个键还没被建出来");
    const fromMissing = statfsFreeBytes(missing);
    const fromRoot = statfsFreeBytes(cache);
    expect(fromMissing).not.toBeNull();
    expect(fromRoot).not.toBeNull();
    /* ⚠️ 不能逐字节相等：自由空间是会动的卷级事实，两读之间可能有别的进程在写（本仓夹具就在写临时
     * 目录），逐字相等会在并发下必红（实测两次读差 240 KB）。真正要钉的是「读得到」（空转成因就是
     * null）；「同一个卷」只能松判 —— 读到别的卷或读不到都会被抓住。 */
    const a = fromMissing!;
    const b = fromRoot!;
    expect(Math.abs(a - b)).toBeLessThan(Math.max(b * 0.01, 64 * 1024 ** 2));
  });

  it("一路向上都没有可读的卷 ⇒ 给 null（读不到就是读不到，按不够处理）", () => {
    /* 判的是量具兜底，不是「哪条路径不存在」：`statfsFreeBytes` 向上找最近可读祖先（槽根建出前必然不存在），
     * 所以不存在的路径通常照样读得到；只有每个祖先都 ENOENT 才回 null。真盘造不出这种路径（绝对路径总
     * 会落到 `/` 或盘符根），故把「所有卷都读不到」的机器替身出来：`fs.statfsSync` 换成只报 ENOENT 的桩。 */
    const real = fs.statfsSync;
    const spy = vi.spyOn(fs, "statfsSync").mockImplementation(() => {
      throw Object.assign(new Error("no such volume"), { code: "ENOENT" });
    });
    try {
      expect(statfsFreeBytes(path.join(cache, "没有这个盘", "再深一层"))).toBeNull();
    } finally {
      spy.mockRestore();
      expect(fs.statfsSync).toBe(real);
    }
  });

  it("低于下限 ⇒ 不建槽，且原因里带两个数（读数要能自查）", () => {
    const out = hasRoomForSlot({
      path: job,
      floorBytes: 10 * 1024 ** 3,
      probe: () => 5 * 1024 ** 3,
    });
    expect(out.ok).toBe(false);
    expect(out.why).toContain("5.0");
    expect(out.why).toContain("10");
  });

  it("读不到空闲 ⇒ 按不够处理（不许猜充足）", () => {
    expect(hasRoomForSlot({ path: job, probe: () => null }).ok).toBe(false);
    expect(
      hasRoomForSlot({
        path: job,
        probe: () => {
          throw new Error("boom");
        },
      }).ok,
    ).toBe(false);
  });

  it("锁：第一次拿到、第二次抢不到；过期的那把可被接管", () => {
    fs.mkdirSync(slot, { recursive: true });
    let now = 1_000_000;
    const first = acquireSlotLock({ slot, now: () => now });
    expect(first.acquired).toBe(true);
    const second = acquireSlotLock({ slot, now: () => now });
    expect(second.acquired).toBe(false);
    expect(second.why).toContain("持锁");
    now += 21 * 60 * 1000;
    const third = acquireSlotLock({ slot, now: () => now });
    expect(third.acquired).toBe(true);
    expect(third.why).toContain("接管");
    third.release();
    expect(fs.existsSync(path.join(slot, ".ci-slot.lock"))).toBe(false);
  });

  it("锁文件读不出时刻 ⇒ 当成过期处理，而不是永久卡住", () => {
    fs.mkdirSync(slot, { recursive: true });
    fs.writeFileSync(path.join(slot, ".ci-slot.lock"), "读不出\n");
    const out = acquireSlotLock({ slot, now: () => 5_000_000 });
    expect(out.acquired).toBe(true);
  });

  it("空闲下限是 10 GiB（#3113 从 20 GiB 收窄）", () => {
    expect(FREE_SPACE_FLOOR_BYTES).toBe(10 * 1024 ** 3);
  });
});
