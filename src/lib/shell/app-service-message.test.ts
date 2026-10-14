// 「应用服务断开 / 启动」这件事的判据与文案契约（规范 11.2：用例名即语义文档）。
//
// 这两件事此前**没有任何生产方**把它们写进消息中心——状态栏那一格翻成「应用服务已
// 断开」之后什么出口都没有（用户原话是「需要将时间和原因记录到消息中心」）。
// 判据写在这个纯函数里，于是四类最容易错的边界都能直接断言：
//   ① 抖动（持续 offline）不得逐拍发消息；
//   ② 整页刷新（进程没换新）不得被当成一次「启动」；
//   ③ 断开那一刻拿不到原因，原因必须落在恢复那条上；
//   ④ 标题分三档，不把「重启」说成「首次启动」。

import { describe, expect, it } from "vitest";

import {
  deriveAppServiceEvent,
  describeAppServiceDisconnect,
  describeAppServiceRouteStale,
  describeAppServiceStart,
  formatOfflineSpan,
  initialAppServiceCursor,
  type AppServiceEventCursor,
} from "./app-service-message";

const T0 = Date.parse("2026-10-12T14:00:00");
const T1 = T0 + 125_000;

const exitNotice = {
  why: "本地服务自身退出了（编译失败 / 端口被占 / pnpm 异常都会这样）",
  action: "看 log/nextjs/ 下最新一份输出；重新启动一次通常即可恢复",
  detail:
    "服务被 SIGKILL 结束：被强制结束（内存不足被系统结束、或任务管理器结束进程都会这样）",
};

/** 推进一拍的便捷写法：吃上一拍的游标，回下一拍的游标与事件。 */
function step(
  cursor: AppServiceEventCursor,
  facts: { state: "starting" | "online" | "offline"; processIsNew: boolean },
  now: number,
) {
  return deriveAppServiceEvent(cursor, facts, now);
}

/** 「已经探到、且这份进程是新的」——冷启动之后最常见的那一拍。 */
const RUNNING_NEW = { state: "online", processIsNew: true } as const;

describe("deriveAppServiceEvent 边沿判据", () => {
  it("首帧不产出任何事件（还没探通过，谈不上断开或启动）", () => {
    const { event } = step(
      initialAppServiceCursor(),
      { state: "starting", processIsNew: false },
      T0,
    );
    expect(event).toBeNull();
  });

  it("冷启动：首探拿到「新的进程」即记一条启动", () => {
    const { event } = step(initialAppServiceCursor(), RUNNING_NEW, T0 + 800);
    expect(event).toEqual({ type: "start", at: T0 + 800, offlineAt: null });
  });

  it("online → offline：记一条断开，游标记住断开时刻", () => {
    const first = step(initialAppServiceCursor(), RUNNING_NEW, T0);
    expect(first.cursor.offlineAt).toBeNull();
    const second = step(
      first.cursor,
      { state: "offline", processIsNew: true },
      T1,
    );
    expect(second.event).toEqual({ type: "disconnect", at: T1 });
    expect(second.cursor.offlineAt).toBe(T1);
  });

  it("持续 offline 逐拍不再发消息（否则每 2 秒一条）", () => {
    const first = step(initialAppServiceCursor(), RUNNING_NEW, T0);
    const off = step(
      first.cursor,
      { state: "offline", processIsNew: true },
      T1,
    );
    expect(off.event?.type).toBe("disconnect");
    const again = step(
      off.cursor,
      { state: "offline", processIsNew: true },
      T1 + 2000,
    );
    expect(again.event).toBeNull();
    const still = step(
      again.cursor,
      { state: "offline", processIsNew: true },
      T1 + 4000,
    );
    expect(still.event).toBeNull();
  });

  it("进程换新后恢复：记一条恢复，并带上断开的时刻与本次启动时刻", () => {
    let cursor = step(initialAppServiceCursor(), RUNNING_NEW, T0).cursor;
    cursor = step(cursor, { state: "offline", processIsNew: true }, T1).cursor;
    /* 「进程是新的」由真→假→真：重启之后要重新判一次，否则上一拍已经为真，
     * 边沿不会成立。 */
    cursor = step(
      cursor,
      { state: "offline", processIsNew: false },
      T1 + 2000,
    ).cursor;
    const up = step(cursor, RUNNING_NEW, T1 + 3000);
    expect(up.event).toEqual({ type: "start", at: T1 + 3000, offlineAt: T1 });
    /* 这一次启动已经收尾了那条断开，不该再留着等第二条消息。 */
    expect(up.cursor.offlineAt).toBeNull();
  });

  it("整页刷新（进程没换新）不算启动，一条消息都不发", () => {
    const online = step(initialAppServiceCursor(), RUNNING_NEW, T0);
    const reload = step(online.cursor, RUNNING_NEW, T0 + 10_000);
    expect(reload.event).toBeNull();
  });

  it("同一进程内断了又通：恢复也记一条，且只记一次", () => {
    let cursor = step(initialAppServiceCursor(), RUNNING_NEW, T0).cursor;
    cursor = step(cursor, { state: "offline", processIsNew: true }, T1).cursor;
    const back = step(cursor, RUNNING_NEW, T1 + 2000);
    expect(back.event).toEqual({ type: "start", at: T1 + 2000, offlineAt: T1 });
    expect(back.cursor.offlineAt).toBeNull();
    const later = step(back.cursor, RUNNING_NEW, T1 + 4000);
    expect(later.event).toBeNull();
  });

  it("「还没探通」期间反复探测不产生任何事件", () => {
    let cursor = initialAppServiceCursor();
    for (const t of [T0, T0 + 2000, T0 + 4000]) {
      const r = step(cursor, { state: "starting", processIsNew: false }, t);
      expect(r.event).toBeNull();
      cursor = r.cursor;
    }
  });

  it("游标是纯值：传入的对象不被就地改写", () => {
    const cursor = initialAppServiceCursor();
    step(cursor, { state: "offline", processIsNew: false }, T0);
    expect(cursor.offlineAt).toBeNull();
    expect(cursor.state).toBe("starting");
    expect(cursor.processIsNew).toBe(false);
  });
});

describe("路由表不完整（stale）的边沿与文案", () => {
  it("进入 stale 那一拍记一条 route-stale，持续期间不重复记", () => {
    const first = deriveAppServiceEvent(
      initialAppServiceCursor(),
      { state: "stale", processIsNew: false },
      1_000,
    );
    expect(first.event).toEqual({ type: "route-stale", at: 1_000 });
    /* 下一拍仍是 stale：边沿不成立，不再记一条（否则每 2 秒刷一条）。 */
    const second = deriveAppServiceEvent(
      first.cursor,
      { state: "stale", processIsNew: false },
      3_000,
    );
    expect(second.event).toBeNull();
  });

  it("stale 不冒充断开：游标里不写下 offlineAt，转回 online 也不报「已恢复」", () => {
    const stale = deriveAppServiceEvent(
      initialAppServiceCursor(),
      { state: "stale", processIsNew: false },
      1_000,
    );
    expect(stale.cursor.offlineAt).toBeNull();
    /* 路由修好后转 online：这是一次「服务一直都在」，不该报恢复。 */
    const back = deriveAppServiceEvent(
      stale.cursor,
      { state: "online", processIsNew: false },
      5_000,
    );
    expect(back.event).toBeNull();
  });

  it("文案说清「服务在应答、坏的是路由表」并给出两步出口", () => {
    const { title, body } = describeAppServiceRouteStale(1_000);
    expect(title).toBe("应用服务路由异常");
    /* 「页面还能打开」这一句是这条消息存在的理由：它正是用户容易以为「再等等
       就好」的地方，必须显式点出来，并紧跟「重启应用」这个出口。 */
    expect(body).toContain("还能打开");
    expect(body).toContain("404");
    expect(body).toContain("重新启动");
    expect(body).toContain(".next");
  });
});

describe("formatOfflineSpan 断开时长", () => {
  it("秒 / 分 / 小时三档都是人能读的写法", () => {
    expect(formatOfflineSpan(0, 5_000)).toBe("5 秒");
    expect(formatOfflineSpan(0, 125_000)).toBe("2 分 05 秒");
    expect(formatOfflineSpan(0, 3_725_000)).toBe("1 小时 02 分 05 秒");
  });

  it("负时长（时钟漂移）说成「拿不到」，不写成「-3 秒」", () => {
    expect(formatOfflineSpan(1_000, 0)).toBeNull();
    expect(formatOfflineSpan(Number.NaN, 0)).toBeNull();
  });
});

describe("describeAppServiceDisconnect 断开文案", () => {
  it("给时刻、给影响，并指明原因会在恢复那条里给（不给原因、不编「未知」）", () => {
    const m = describeAppServiceDisconnect(T1);
    expect(m.title).toBe("应用服务已断开");
    expect(m.body).toContain("断开时间");
    expect(m.body).toContain("会失败");
    expect(m.body).toContain("应用服务已恢复");
    expect(m.body).not.toContain("未知原因");
  });
});

describe("describeAppServiceStart 启动/恢复文案", () => {
  it("恢复：时刻 + 持续时长 + 为什么 + 建议，四件都给全", () => {
    const m = describeAppServiceStart({
      at: T1 + 3000,
      offlineAt: T1,
      exitAt: T1,
      notice: exitNotice,
    });
    expect(m.title).toBe("应用服务已恢复");
    expect(m.body).toContain("断开");
    expect(m.body).toContain("恢复");
    expect(m.body).toContain("持续 3 秒");
    expect(m.body).toContain(exitNotice.why);
    expect(m.body).toContain(exitNotice.detail);
    expect(m.body).toContain(exitNotice.action);
  });

  it("读得到上一份进程的结束记录 → 标题是「已重启」，不冒充首次启动", () => {
    const m = describeAppServiceStart({
      at: T0 + 800,
      offlineAt: null,
      exitAt: T0,
      notice: exitNotice,
    });
    expect(m.title).toBe("应用服务已重启");
    expect(m.body).toContain("上一份进程");
    expect(m.body).not.toContain("持续");
    expect(m.body).toContain(exitNotice.why);
  });

  it("冷启动且读不到记录：说清「本次运行还没有服务结束过」，不编一个成因", () => {
    const m = describeAppServiceStart({
      at: T0,
      offlineAt: null,
      exitAt: null,
      notice: null,
    });
    expect(m.title).toBe("应用服务已启动");
    expect(m.body).toContain("冷启动");
    expect(m.body).toContain("诊断包");
    expect(m.body).not.toContain(exitNotice.why);
  });

  it("读不到记录时**不把成因猜成「手工 pnpm dev」**（手验：双击 exe 也被这么说）", () => {
    /* 「读不到记录」有三条互斥成因（从未写过 / 写侧只覆盖启动期 / 记录与当前
     * runId 相同被判掉），从这一个事实里分辨不出是哪一条。把其中一条写死
     * 等于对**所有人**断言一个自己并不知道的成因 —— 走启动编排的正式入口
     * （双击 exe）读到的正是这句，而那次现场里服务根本没有退出过。 */
    for (const offlineAt of [null, T0]) {
      const m = describeAppServiceStart({
        at: T0 + 3000,
        offlineAt,
        exitAt: null,
        notice: null,
      });
      expect(m.body).not.toContain("pnpm dev");
      expect(m.body).not.toContain("没有经过启动编排");
      // 能确定的那一件（这次是冷启动还是恢复）必须说出来
      expect(m.body).toContain(
        offlineAt === null ? "冷启动" : "这次断开没有留下结束记录",
      );
    }
  });

  it("退出时刻读不出来时仍讲清原因（不因为缺一个字段就少讲一半）", () => {
    const m = describeAppServiceStart({
      at: T0,
      offlineAt: null,
      exitAt: null,
      notice: exitNotice,
    });
    expect(m.title).toBe("应用服务已重启");
    expect(m.body).toContain(exitNotice.why);
    expect(m.body).toContain(exitNotice.action);
  });

  it("断开时长算不出来（时钟漂移）时不写「持续 -N 秒」", () => {
    const m = describeAppServiceStart({
      at: T0,
      offlineAt: T1,
      exitAt: null,
      notice: null,
    });
    expect(m.body).not.toContain("持续");
    expect(m.body).toContain("断开");
  });

  it("三档标题互不相同（状态必须一眼可辨）", () => {
    const titles = [
      describeAppServiceStart({
        at: T0,
        offlineAt: T1,
        exitAt: null,
        notice: null,
      }).title,
      describeAppServiceStart({
        at: T0,
        offlineAt: null,
        exitAt: null,
        notice: exitNotice,
      }).title,
      describeAppServiceStart({
        at: T0,
        offlineAt: null,
        exitAt: null,
        notice: null,
      }).title,
    ];
    expect(new Set(titles).size).toBe(3);
  });
});
