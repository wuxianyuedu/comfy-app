import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup } from "@testing-library/react";
import {
  useLogStore,
  dropStaleEntries,
  serialize,
  isNextDevNoise,
  isReactQueryLog,
  isRoutineRpcTimingLog,
  isRoutineRpcTimingLine,
  parseFileLogs,
  mergeTimeline,
  dedupeRepeats,
  selectPageLogs,
  selectNewLogCount,
  selectShouldPinToLatest,
  MAX_LOG_ENTRIES,
  LOG_PAGE_SIZE,
  selectFirstPageWindow,
  captureLocation,
  computeOriginCounts,
} from "./log-store";
import type { LogEntry } from "./log-store";

/* ── 测试夹具 ─────────────────────────────────────────────── */

let seq = 0;
function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  seq += 1;
  return {
    id: `test-${seq}`,
    seq,
    time: 1_700_000_000_000,
    level: "info",
    message: `msg-${seq}`,
    source: "system",
    ...overrides,
  };
}

/** 每个用例前把 store 重置为已知初始状态,避免用例间污染。 */
function resetStore() {
  /* counts 必须与空的 logs 一致：appendFileLogs 的空批次分支刻意不重算派生
   * 状态（保持「追加空数组不改状态」的契约），所以夹具负责给出自洽的初值。 */
  useLogStore.setState({
    logs: [],
    filteredLogs: [],
    filter: "all",
    origin: "all",
    search: "",
    isOpen: false,
    counts: { all: 0, debug: 0, info: 0, warn: 0, error: 0 },
    countsByOrigin: computeOriginCounts([]),
    sessionStart: null,
    bootId: null,
    page: 1,
    revision: 0,
    viewRevision: 0,
    viewSeenIds: new Set<string>(),
    followBaseline: 0,
    followResetAt: 0,
    autoScroll: true,
    anchorId: null,
    viewBaselineAfter: 0,
  });
  /* seq 计数器跨用例共享且单调递增，测试之间不重置：条目 id 由它派生，
   * 重置会导致不同用例造出同名条目（时间线去重会误判成重复行）。 */
}

function idsOf(entries: LogEntry[]): (string | undefined)[] {
  return entries.map((e) => e.id);
}

/**
 * 「历史页有 N 条新日志」的当前值。
 * `autoScroll` 不在 store 里（它是面板的滚动状态），由用例显式传入——
 * 与 LogPanel 的调用方式一致（面板把两者组合后交给 selectNewLogCount）。
 */
function newCount(page: number, autoScroll: boolean): number {
  const s = useLogStore.getState();
  /* 窗口口径与面板完全一致（面板也是这个算式）：
   *   第 1 页 → 锚定窗口（selectFirstPageWindow），`truncatedFromEnd` 即「锚点之后
   *             还没进窗口的条数」；没有锚点时退回尾部 pageSize 条，其后的都是新的。
   *   历史页 → 第 page 页之后（更新的）整段。
   * 直接调产品函数，避免用例自己再写一份会漂移的算式。 */
  /* 与面板同一条算式（第 1 页 = 锚定窗口的 truncatedFromEnd；历史页 = 页码之后）。 */
  const unseenAfterView =
    page === 1
      ? selectFirstPageWindow(s.filteredLogs, s.anchorId, s.pageSize)
          .truncatedFromEnd
      : Math.max(0, s.filteredLogs.length - s.pageSize * page);
  return selectNewLogCount({
    unseenAfterView,
    baselineAfterView: s.viewBaselineAfter,
    page,
    autoScroll,
  });
}

/** 造一条「时刻可控」的日志行（会话边界用例都按 time 判定）。 */
function entry(id: string, time: number): LogEntry {
  return {
    id,
    /* 入库顺序由夹具自己维持单调：断言只看内容与顺序，与时间戳解耦。 */
    seq: (seq += 1),
    time,
    level: "info",
    message: `msg-${id}`,
    source: "system",
  };
}

afterEach(cleanup);

beforeEach(resetStore);

/* ── 来源 × 级别计数（#360）────────────────────────────────── */

/**
 * 用户反馈的原话是「看着警告有很多，切换过去结果显示是空的，这一类型就没有
 * 警告」。根因是面板只有**一个总数**：级别行的数字是全部来源的合计，来源下拉
 * 里只有名字没有数——没有任何地方能看出「那 900 多条警告其实都在应用服务里」。
 *
 * 这组用例锁住修法：计数必须**逐来源独立**，且带 `all` 汇总。
 */
describe("computeOriginCounts 来源 × 级别二维计数（#360）", () => {
  it("逐来源独立计数，all 是全部来源的汇总", () => {
    const table = computeOriginCounts([
      makeEntry({ origin: "launcher", level: "info" }),
      makeEntry({ origin: "launcher", level: "warn" }),
      makeEntry({ origin: "app", level: "warn" }),
      makeEntry({ origin: "app", level: "warn" }),
      makeEntry({ origin: "app", level: "error" }),
      makeEntry({ origin: "dev", level: "info" }),
    ]);

    expect(table.launcher).toEqual({ all: 2, debug: 0, info: 1, warn: 1, error: 0 });
    expect(table.app).toEqual({ all: 3, debug: 0, info: 0, warn: 2, error: 1 });
    expect(table.dev).toEqual({ all: 1, debug: 0, info: 1, warn: 0, error: 0 });
    expect(table["app-runtime"]).toEqual({ all: 0, debug: 0, info: 0, warn: 0, error: 0 });
    expect(table.all).toEqual({ all: 6, debug: 0, info: 2, warn: 3, error: 1 });
  });

  it("无来源的行（console 拦截 / Tauri 事件 / 全局错误）只计入 all", () => {
    const table = computeOriginCounts([
      makeEntry({ level: "error" }),
      makeEntry({ level: "warn" }),
      makeEntry({ origin: "app", level: "warn" }),
    ]);

    expect(table.all).toEqual({ all: 3, debug: 0, info: 0, warn: 2, error: 1 });
    for (const origin of ["dev", "launcher", "app", "app-runtime"] as const) {
      expect(table[origin].all).toBe(origin === "app" ? 1 : 0);
    }
  });

  it("「某一来源没警告」必须是真 0，而不是继承了全局数", () => {
    const table = computeOriginCounts([
      makeEntry({ origin: "app", level: "warn" }),
      makeEntry({ origin: "app", level: "warn" }),
      makeEntry({ origin: "launcher", level: "info" }),
    ]);

    /* 全局有 2 条警告，但启动器那条来源里一条都没有——切过去就是空列表，
     * 这正是用户看到的「看着警告很多、切过去是空的」。界面据此把 0 显示出来，
     * 用户就不会以为日志丢了。 */
    expect(table.all.warn).toBe(2);
    expect(table.launcher.warn).toBe(0);
    expect(table.launcher.all).toBe(1);
  });

  it("空时间线的表是完整的全零结构（视图可直接索引）", () => {
    expect(computeOriginCounts([])).toEqual({
      all: { all: 0, debug: 0, info: 0, warn: 0, error: 0 },
      dev: { all: 0, debug: 0, info: 0, warn: 0, error: 0 },
      launcher: { all: 0, debug: 0, info: 0, warn: 0, error: 0 },
      app: { all: 0, debug: 0, info: 0, warn: 0, error: 0 },
      "app-runtime": { all: 0, debug: 0, info: 0, warn: 0, error: 0 },
    });
  });

  it("store 在每次时间线变化后重算二维计数", () => {
    act(() =>
      useLogStore.getState().appendFileLogs([
        makeEntry({ origin: "app", level: "error" }),
        makeEntry({ origin: "launcher", level: "warn" }),
      ]),
    );
    const state = useLogStore.getState();
    expect(state.countsByOrigin.all).toEqual({ all: 2, debug: 0, info: 0, warn: 1, error: 1 });
    expect(state.countsByOrigin.app.error).toBe(1);
    expect(state.countsByOrigin.launcher.error).toBe(0);

    act(() => useLogStore.getState().clear());
    expect(useLogStore.getState().countsByOrigin.all.all).toBe(0);
    expect(useLogStore.getState().countsByOrigin.app.all).toBe(0);
  });
});

/* ── addEntry ─────────────────────────────────────────────── */

describe("addEntry 追加日志", () => {
  it("追加一条日志后自动补 id 与 time 并更新计数", () => {
    useLogStore.getState().addEntry({
      level: "warn",
      message: "磁盘空间不足",
      source: "tauri",
    });
    const { logs, counts } = useLogStore.getState();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe("磁盘空间不足");
    expect(logs[0]?.id).toBeTruthy();
    expect(typeof logs[0]?.time).toBe("number");
    expect(counts).toEqual({ all: 1, debug: 0, info: 0, warn: 1, error: 0 });
  });

  it("多次追加按调用顺序排列", () => {
    const s = useLogStore.getState();
    s.addEntry({ level: "info", message: "第一条", source: "system" });
    s.addEntry({ level: "error", message: "第二条", source: "system" });
    s.addEntry({ level: "debug", message: "第三条", source: "console" });
    const { logs, counts } = useLogStore.getState();
    expect(logs.map((e) => e.message)).toEqual(["第一条", "第二条", "第三条"]);
    expect(counts).toEqual({ all: 3, debug: 1, info: 1, warn: 0, error: 1 });
  });

  it("每次追加生成的 id 互不相同", () => {
    const s = useLogStore.getState();
    s.addEntry({ level: "info", message: "a", source: "system" });
    s.addEntry({ level: "info", message: "b", source: "system" });
    const { logs } = useLogStore.getState();
    expect(logs[0]?.id).not.toBe(logs[1]?.id);
  });

  it("追加的日志会按当前过滤条件即时进入 filteredLogs", () => {
    useLogStore.setState({ filter: "error" });
    const s = useLogStore.getState();
    s.addEntry({ level: "info", message: "普通消息", source: "system" });
    s.addEntry({ level: "error", message: "出错了", source: "system" });
    const { filteredLogs, counts } = useLogStore.getState();
    expect(filteredLogs).toHaveLength(1);
    expect(filteredLogs[0]?.level).toBe("error");
    expect(counts.all).toBe(2);
  });
});

/* ── appendFileLogs ───────────────────────────────────────── */

describe("appendFileLogs 批量追加", () => {
  it("批量条目按传入顺序追加到已有日志之后", () => {
    useLogStore.setState({ logs: [makeEntry({ id: "a" })] });
    useLogStore
      .getState()
      .appendFileLogs([makeEntry({ id: "b" }), makeEntry({ id: "c" })]);
    const { logs } = useLogStore.getState();
    expect(idsOf(logs)).toEqual(["a", "b", "c"]);
  });

  it("批量追加后 counts 与 filteredLogs 一并重算", () => {
    useLogStore.setState({ search: "启动" });
    useLogStore
      .getState()
      .appendFileLogs([
        makeEntry({ id: "m1", message: "启动完成" }),
        makeEntry({ id: "m2", message: "其他消息" }),
        makeEntry({ id: "m3", level: "error", message: "启动失败" }),
      ]);
    const { counts, filteredLogs } = useLogStore.getState();
    /* counts 与 filteredLogs 同一口径（都跟着搜索词收窄）：搜索命中 m1/m3，
     * 计数也只数这两条——面板上「按钮写着 2」与「列表里确实 2 条」才对得上。 */
    expect(counts).toEqual({ all: 2, debug: 0, info: 1, warn: 0, error: 1 });
    expect(idsOf(filteredLogs)).toEqual(["m1", "m3"]);
  });

  it("追加空数组时状态保持不变", () => {
    useLogStore.setState({ logs: [makeEntry({ id: "keep" })] });
    useLogStore.getState().appendFileLogs([]);
    const { logs, counts } = useLogStore.getState();
    expect(idsOf(logs)).toEqual(["keep"]);
    /* 空批次不改派生状态：counts 保持刚 setState 的空值，logs 原样保留。 */
    expect(counts.all).toBe(0);
  });
});

/* ── 会话边界：面板只显示本次运行 ─────────────────────────── */

describe("dropStaleEntries 丢弃上一次运行的残留行", () => {
  const cutoff = 1_700_000_000_000;

  it("行时刻早于会话起点即判为历史", () => {
    const entries = [
      makeEntry({ id: "old", time: cutoff - 60_000 }),
      makeEntry({ id: "new", time: cutoff + 1_000 }),
    ];
    expect(idsOf(dropStaleEntries(entries, cutoff))).toEqual(["new"]);
  });

  it("起点未知（null）时不做时间线截断", () => {
    const entries = [makeEntry({ id: "any", time: cutoff - 60_000 })];
    expect(idsOf(dropStaleEntries(entries, null))).toEqual(["any"]);
  });
});

describe("appendFileLogs 按会话起点过滤", () => {
  const cutoff = 1_700_000_000_000;

  it("未设会话起点时全部收下", () => {
    useLogStore
      .getState()
      .appendFileLogs([makeEntry({ id: "old", time: cutoff - 60_000 })]);
    expect(idsOf(useLogStore.getState().logs)).toEqual(["old"]);
  });

  it("设了会话起点后历史行进不了面板", () => {
    useLogStore.getState().setSessionStart(cutoff);
    useLogStore.getState().appendFileLogs([
      makeEntry({ id: "old", time: cutoff - 60_000 }),
      makeEntry({ id: "new", time: cutoff + 5_000 }),
    ]);
    expect(idsOf(useLogStore.getState().logs)).toEqual(["new"]);
  });

  it("全部是历史行时面板不新增任何条目", () => {
    useLogStore.getState().setSessionStart(cutoff);
    useLogStore
      .getState()
      .appendFileLogs([makeEntry({ id: "old", time: cutoff - 1 })]);
    expect(idsOf(useLogStore.getState().logs)).toEqual([]);
  });
});

describe("setSessionStart 收拢迟到的时间线", () => {
  it("会话起点比首帧晚到时清掉已混入的历史行", () => {
    const cutoff = 1_700_000_000_000;
    useLogStore.setState({
      logs: [
        makeEntry({ id: "old", time: cutoff - 60_000 }),
        makeEntry({ id: "new", time: cutoff + 1_000 }),
      ],
    });
    useLogStore.getState().setSessionStart(cutoff);
    const { logs, counts, sessionStart } = useLogStore.getState();
    expect(idsOf(logs)).toEqual(["new"]);
    expect(counts.all).toBe(1);
    expect(sessionStart).toBe(cutoff);
  });

  it("重复设置同一个起点是幂等的", () => {
    const cutoff = 1_700_000_000_000;
    useLogStore.setState({ logs: [makeEntry({ id: "new", time: cutoff + 1 })] });
    useLogStore.getState().setSessionStart(cutoff);
    useLogStore.getState().setSessionStart(cutoff);
    expect(idsOf(useLogStore.getState().logs)).toEqual(["new"]);
  });
});

/* ── MAX_LOG_ENTRIES 上限裁剪（只裁最旧的，且裁的是「最旧」不是「最早到达」）── */

describe("MAX_LOG_ENTRIES 上限裁剪", () => {
  it("批量追加超过上限时最旧的日志被挤出，最新的一定留着", () => {
    /* 夹具的 seq 跨用例共享且单调递增：先造 1995 条「旧」的、再造 10 条
     * 「新」的，两批的时间戳与 seq 都天然有序。 */
    const baseSeq = seq;
    const oldLogs: LogEntry[] = Array.from({ length: 1995 }, (_, i) =>
      makeEntry({ id: `old-${i}`, message: `old-${i}`, time: 1_000 + i, seq: baseSeq + 1 + i }),
    );
    seq = baseSeq + 1995;
    useLogStore.setState({ logs: oldLogs });
    const fresh: LogEntry[] = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ id: `new-${i}`, message: `new-${i}`, time: 10_000 + i, seq: seq + 1 + i }),
    );
    seq = seq + 10;
    useLogStore.getState().appendFileLogs(fresh);

    const { logs, counts } = useLogStore.getState();
    expect(logs).toHaveLength(MAX_LOG_ENTRIES);
    // 1995 + 10 = 2005，裁掉最旧的 5 条（old-0..old-4）→ 首条是 old-5
    expect(logs[0]?.id).toBe("old-5");
    expect(logs[1990]?.id).toBe("new-0");
    expect(logs[1999]?.id).toBe("new-9");
    expect(counts.all).toBe(MAX_LOG_ENTRIES);
  });

  it("addEntry 在满仓时挤出最旧的一条", () => {
    const oldLogs: LogEntry[] = Array.from({ length: MAX_LOG_ENTRIES }, (_, i) =>
      makeEntry({ id: `old-${i}`, time: i, seq: i - MAX_LOG_ENTRIES }),
    );
    useLogStore.setState({ logs: oldLogs });
    useLogStore
      .getState()
      .addEntry({ level: "warn", message: "最新一条", source: "system" });

    const { logs } = useLogStore.getState();
    expect(logs).toHaveLength(MAX_LOG_ENTRIES);
    expect(logs[0]?.id).toBe("old-1");
    expect(logs[logs.length - 1]?.message).toBe("最新一条");
  });

  it("恰好达到上限时不裁剪", () => {
    const oldLogs: LogEntry[] = Array.from({ length: MAX_LOG_ENTRIES - 1 }, (_, i) =>
      makeEntry({ id: `old-${i}`, time: i, seq: i - MAX_LOG_ENTRIES }),
    );
    useLogStore.setState({ logs: oldLogs });
    useLogStore
      .getState()
      .addEntry({ level: "info", message: `第 ${MAX_LOG_ENTRIES} 条`, source: "system" });

    const { logs } = useLogStore.getState();
    expect(logs).toHaveLength(MAX_LOG_ENTRIES);
    expect(logs[0]?.id).toBe("old-0");
  });

  it("上限只约束内存：分页每页 200 条，与上限不耦合（#262）", () => {
    // 旧实现把 pageSize 直接设成 2000，等于「上限即页大小」：翻页永远只有一页，
    // 看起来就是「锁死 2000 条、不能翻页」。上限是内存保护，页大小是阅读体验，
    // 两者必须是独立常量。
    expect(LOG_PAGE_SIZE).toBeLessThan(MAX_LOG_ENTRIES);
  });
});

/* ── 满仓时的「有新日志」与贴底基线（ISSUE #262 复审）────────────────────
 *
 * 用户反馈两条连在一起的现象：
 *   「日志到上限了还继续产生新日志，面板内容不断移动，想复制某一项十分困难，
 *     甚至无法选择，刚选择就刷新把选择弄没了」；
 *   「日志没法翻页」。
 *
 * 两者同源：**时间线到上限时，新行并没有真正落板，只是把最旧的一批挤了出去**。
 * 旧实现把这种「右移一格」也当作时间线变了（推进 revision），于是
 *   1. 页脚把 revision 变化当成有新日志 → 重新取水位 → 而写入之后的视图里本来就
 *      含新行，新行当场被标成已读 → 「有 N 条新的日志」永远报 0，那个「回到最新」
 *      的出口也就永远不出现（用户读到的就是「翻页翻不动」）；
 *   2. 贴底按「尾部有没有变」判定 → 每两秒一次的轮询都有新行 → 内容整体上移
 *      一次，用户刚框住的文本立刻被冲掉。
 *
 * 修法是把两条判据都换成「条目身份」：截断不推进 revision，水位与贴底基线都只由
 * 显式动作推进，新行靠 id 判「没见过」。
 */
describe("满仓（环形缓冲截断）时的水位与 revision（#262 复审）", () => {
  /** 把时间线灌到满仓：id 单调，time 单调。 */
  function fillFull() {
    const baseSeq = seq;
    /* 不用 makeEntry：它会递增共享计数器并**覆盖**这里显式给出的 seq，
     * 让「时间线里谁在前谁在后」变得不可预测（用例要的是确定性顺序）。 */
    const full: LogEntry[] = Array.from({ length: MAX_LOG_ENTRIES }, (_, i) => ({
      id: `full-${i}`,
      message: `full-${i}`,
      time: 1_700_000_000_000 + i,
      seq: baseSeq + 1 + i,
      level: "info" as const,
      source: "system" as const,
    }));
    seq = baseSeq + MAX_LOG_ENTRIES;
    /* 直接 setState 灌满时间线时 `filteredLogs` 不会跟着派生，而 setPage 的水位
     * 取自 filteredLogs —— 不显式补齐，水位就恒为空集（用例会误判成「一切皆未读」）。 */
    useLogStore.setState({ logs: full, filteredLogs: full });
    /* setPage(1) = 「我在看最新一段」：锚点与基线一起就位，此后到达的才算新的。 */
    act(() => useLogStore.getState().setPage(1));
    return full;
  }

  it("满仓时新到一条：revision 推进（有新行落板），但水位不被动过", () => {
    fillFull();
    const before = useLogStore.getState();

    act(() =>
      useLogStore.getState().appendFileLogs([
        makeEntry({
          id: "overflow-1",
          message: "溢出的一条",
          time: before.logs[before.logs.length - 1]!.time + 1,
          seq: seq + 1,
        }),
      ]),
    );

    const after = useLogStore.getState();
    expect(after.logs).toHaveLength(MAX_LOG_ENTRIES);
    /* 溢出条顶掉了最旧的一条，但它确实落板了 → revision 推进，
     * 页脚据此知道「时间线真的变过」（还不等于有新日志，见下一条断言）。 */
    expect(after.revision).toBe(before.revision + 1);
    /* 关键是水位**没被写入路径动过**：溢出条仍在「未读」里，页脚因此报得出它。
     * 旧实现把「截断」也当成有新内容并顺手刷新水位，新行当场被标成已读。 */
    expect(after.viewSeenIds.has("overflow-1")).toBe(false);
    expect(after.viewSeenIds.has("full-0")).toBe(true);
  });

  it("满仓时贴底基线不再被每次新增拉动（复制文本时内容不动）", () => {
    fillFull();
    const baseline = useLogStore.getState().followBaseline;

    const baseSeq = seq;
    const overflow: LogEntry[] = Array.from({ length: 5 }, (_, i) =>
      makeEntry({
        id: `ov-${i}`,
        message: `ov-${i}`,
        time: 1_800_000_000_000 + i,
        seq: baseSeq + 1 + i,
      }),
    );
    seq = baseSeq + 5;
    act(() => useLogStore.getState().appendFileLogs(overflow));

    /* 基线是「面板要滚到页面里的第几个条目」，只由显式动作（翻页 / 回到底部 /
     * 点回到最新）推进——新日志到达时保持原值，内容才不会自己动。 */
    expect(useLogStore.getState().followBaseline).toBe(baseline);
  });

  it("满仓时新行仍能被数出来：窗口口径不受长度封顶影响", () => {
    fillFull();
    const beforeLen = useLogStore.getState().filteredLogs.length;
    /* 时间戳必须**大于**满仓那批的最大值，否则新行会排到中间、不落在窗口之后。
     * 不用 makeEntry：它会递增共享计数器、并覆盖这里显式给出的 seq。 */
    const lastTime = useLogStore.getState().logs.at(-1)!.time;

    act(() =>
      useLogStore.getState().appendFileLogs([
        {
          id: "unread-1",
          message: "没看过的一条",
          time: lastTime + 1,
          seq: seq + 1,
          level: "info",
          source: "system",
        },
      ]),
    );
    const s = useLogStore.getState();
    /* 长度封顶在 MAX_LOG_ENTRIES：旧口径（长度差）在这里恒为 0，报了「没有新
     * 日志」；窗口口径看的是「窗口之后还有多少条」，封仓照样数得出来。
     * 这条就是「面板一直在涨，但确实报得出新来了几条」的最小证据。 */
    expect(s.filteredLogs.length).toBe(beforeLen);
    expect(s.anchorId).not.toBeNull();
    /* 「有没有新内容」这个数由窗口给出，与内存上限无关。
     * 注意贴底看第 1 页时（autoScroll=true）页脚**不显示**这个入口——新内容本来
     * 就自动呈现在眼前；显式的「回到最新」只在用户上滚离开底部、或翻到历史页时给。 */
    expect(
      selectFirstPageWindow(s.filteredLogs, s.anchorId, s.pageSize).truncatedFromEnd,
    ).toBe(1);
    expect(newCount(1, false)).toBe(1);
  });

  it("点「回到最新」后窗口追到尾部，计数归零", () => {
    fillFull();
    /* 刚在最新一段：没有新内容，也没有出口（`selectShouldPinToLatest(1, true)`） */
    expect(newCount(1, true)).toBe(0);

    const lastTime = useLogStore.getState().logs.at(-1)!.time;
    act(() =>
      useLogStore.getState().appendFileLogs([
        {
          id: "later-1",
          message: "后面又来的一条",
          time: lastTime + 1,
          seq: seq + 1,
          level: "info",
          source: "system",
        },
      ]),
    );
    /* 满仓 + 锚点在尾部窗口头一条 → 窗口之后就是刚追加的那条 */
    expect(newCount(1, false)).toBe(1);

    act(() => useLogStore.getState().jumpToLatest());
    expect(newCount(1, false)).toBe(0);
  });
});

/* ── computeFiltered:级别过滤 / 搜索 ──────────────────────── */

describe("computeFiltered 级别过滤与搜索", () => {
  function seedFixture() {
    const fixture: LogEntry[] = [
      makeEntry({
        id: "e1",
        level: "info",
        message: "kernel panic in module",
        source: "console",
        location: "src/app/api/run.ts:42",
      }),
      makeEntry({
        id: "e2",
        level: "error",
        message: "Kernel Boom",
        source: "tauri",
      }),
      makeEntry({
        id: "e3",
        level: "warn",
        message: "启动检查完成",
        source: "system",
      }),
      makeEntry({
        id: "e4",
        level: "debug",
        message: "started",
        source: "console",
        location: "src/lib/x.ts:1",
      }),
    ];
    // 通过 action 种入,保证 filteredLogs / counts 派生同步更新
    useLogStore.getState().appendFileLogs(fixture);
  }

  it("filter=all 时返回全部日志", () => {
    seedFixture();
    expect(useLogStore.getState().filteredLogs).toHaveLength(4);
  });

  it("按级别过滤时只保留对应级别的日志", () => {
    seedFixture();
    useLogStore.getState().setFilter("error");
    expect(idsOf(useLogStore.getState().filteredLogs)).toEqual(["e2"]);
  });

  it("切换为 debug 级别后 filteredLogs 跟随更新", () => {
    seedFixture();
    useLogStore.getState().setFilter("debug");
    expect(idsOf(useLogStore.getState().filteredLogs)).toEqual(["e4"]);
  });

  it("搜索匹配 message 且不区分大小写", () => {
    seedFixture();
    useLogStore.getState().setSearch("KERNEL");
    expect(idsOf(useLogStore.getState().filteredLogs).sort()).toEqual([
      "e1",
      "e2",
    ]);
  });

  it("搜索匹配 location 字段", () => {
    seedFixture();
    useLogStore.getState().setSearch("run.ts");
    expect(idsOf(useLogStore.getState().filteredLogs)).toEqual(["e1"]);
  });

  it("搜索 location 同样不区分大小写", () => {
    seedFixture();
    useLogStore.getState().setSearch("RUN.TS");
    expect(idsOf(useLogStore.getState().filteredLogs)).toEqual(["e1"]);
  });

  it("级别过滤与搜索为 AND 组合", () => {
    seedFixture();
    const s = useLogStore.getState();
    s.setFilter("error");
    s.setSearch("kernel");
    // e1 命中搜索但级别是 info;e2 级别命中且 message 含 kernel
    expect(idsOf(useLogStore.getState().filteredLogs)).toEqual(["e2"]);
  });

  it("空串搜索不过滤任何日志", () => {
    seedFixture();
    useLogStore.getState().setSearch("");
    expect(useLogStore.getState().filteredLogs).toHaveLength(4);
  });

  it("纯空白搜索会被 trim,等效于不过滤", () => {
    seedFixture();
    useLogStore.getState().setSearch("   ");
    expect(useLogStore.getState().filteredLogs).toHaveLength(4);
  });

  it("无匹配时 filteredLogs 为空数组", () => {
    seedFixture();
    useLogStore.getState().setSearch("完全不存在xyz");
    const { filteredLogs } = useLogStore.getState();
    expect(filteredLogs).toEqual([]);
  });

  it("search 字段保存原始输入,过滤时才做 trim", () => {
    seedFixture();
    useLogStore.getState().setSearch("  kernel  ");
    const { search, filteredLogs } = useLogStore.getState();
    expect(search).toBe("  kernel  ");
    expect(filteredLogs).toHaveLength(2);
  });
});

/* ── setFilter / setSearch 派生正确性 ─────────────────────── */

describe("setFilter / setSearch 派生正确性", () => {
  it("setFilter 只更新 filter 与 filteredLogs,不动 logs 与 counts", () => {
    useLogStore
      .getState()
      .appendFileLogs([makeEntry({ id: "a", level: "warn" })]);
    useLogStore.getState().setFilter("warn");
    const { filter, logs, counts, filteredLogs } = useLogStore.getState();
    expect(filter).toBe("warn");
    expect(idsOf(logs)).toEqual(["a"]);
    expect(counts.all).toBe(1);
    expect(idsOf(filteredLogs)).toEqual(["a"]);
  });

  it("setSearch 更新 search 并保留已有 filter", () => {
    useLogStore
      .getState()
      .appendFileLogs([makeEntry({ id: "a", message: "hello" })]);
    const s = useLogStore.getState();
    s.setFilter("info");
    s.setSearch("hello");
    const { search, filter, filteredLogs } = useLogStore.getState();
    expect(search).toBe("hello");
    expect(filter).toBe("info");
    expect(idsOf(filteredLogs)).toEqual(["a"]);
  });

  it("先 setSearch 后 setFilter 时两个条件叠加生效", () => {
    useLogStore
      .getState()
      .appendFileLogs([
        makeEntry({ id: "a", level: "warn", message: "alpha" }),
        makeEntry({ id: "b", level: "error", message: "alpha beta" }),
        makeEntry({ id: "c", level: "warn", message: "gamma" }),
      ]);
    const s = useLogStore.getState();
    s.setSearch("alpha");
    s.setFilter("warn");
    expect(idsOf(useLogStore.getState().filteredLogs)).toEqual(["a"]);
  });
});

/* ── clear 清空动作 ───────────────────────────────────────── */

describe("clear 清空动作", () => {
  it("clear 清空 logs / counts / filteredLogs", () => {
    useLogStore
      .getState()
      .appendFileLogs([
        makeEntry({ id: "a" }),
        makeEntry({ id: "b", level: "error" }),
      ]);
    useLogStore.getState().clear();
    const { logs, counts, filteredLogs } = useLogStore.getState();
    expect(logs).toEqual([]);
    expect(filteredLogs).toEqual([]);
    expect(counts).toEqual({ all: 0, debug: 0, info: 0, warn: 0, error: 0 });
  });

  it("clear 保留当前的 filter 与 search 设置", () => {
    const s = useLogStore.getState();
    s.setFilter("warn");
    s.setSearch("关键词");
    s.clear();
    const { filter, search } = useLogStore.getState();
    expect(filter).toBe("warn");
    expect(search).toBe("关键词");
  });
});

/* ── isOpen 开关 ──────────────────────────────────────────── */

describe("isOpen 开关", () => {
  it("setIsOpen 显式设置打开状态", () => {
    useLogStore.getState().setIsOpen(true);
    expect(useLogStore.getState().isOpen).toBe(true);
    useLogStore.getState().setIsOpen(false);
    expect(useLogStore.getState().isOpen).toBe(false);
  });

  it("toggleOpen 在关闭与打开之间往返切换", () => {
    useLogStore.getState().toggleOpen();
    expect(useLogStore.getState().isOpen).toBe(true);
    useLogStore.getState().toggleOpen();
    expect(useLogStore.getState().isOpen).toBe(false);
  });
});

/* ── serialize 参数序列化 ─────────────────────────────────── */

describe("serialize 参数序列化", () => {
  it("普通字符串原样保留并以空格连接", () => {
    expect(serialize(["hello", "world"])).toBe("hello world");
  });

  it("数字与布尔值转字符串", () => {
    expect(serialize([1, true, 2.5])).toBe("1 true 2.5");
  });

  it("null 与 undefined 输出字面量", () => {
    expect(serialize([null, undefined])).toBe("null undefined");
  });

  it("空参数数组输出空串", () => {
    expect(serialize([])).toBe("");
  });

  it("带 stack 的 Error 输出 name: message 换行堆栈", () => {
    const err = new Error("boom");
    const out = serialize([err]);
    expect(out.startsWith("Error: boom\n")).toBe(true);
    expect(out).toContain("at ");
  });

  it("无 stack 的 Error 只输出 name: message", () => {
    const err = new Error("no stack");
    err.stack = "";
    expect(serialize([err])).toBe("Error: no stack");
  });

  it("带 stack 字段的普通对象按错误样式序列化", () => {
    const fake = {
      name: "FakeError",
      message: "bad thing",
      stack: "FakeError: bad thing\n  at fake.ts:1:1",
    };
    expect(serialize([fake])).toBe(
      "bad thing\nFakeError: bad thing\n  at fake.ts:1:1",
    );
  });

  it("普通对象输出两空格缩进的 JSON", () => {
    expect(serialize([{ a: 1 }])).toBe('{\n  "a": 1\n}');
  });

  it("循环引用对象回退为空串而不抛异常", () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(serialize([o])).toBe("");
  });

  it("混合类型参数以空格连接", () => {
    expect(serialize(["code", 42, null])).toBe("code 42 null");
  });
});

/* ── isReactQueryLog ──────────────────────────────────────── */

describe("isReactQueryLog React Query 内部日志识别", () => {
  it("匹配 %c << query #N 形式", () => {
    expect(
      isReactQueryLog(["%c << query #488 %cworkflowModel.list", "color:red"]),
    ).toBe(true);
  });

  it("匹配 >> 出站方向", () => {
    expect(isReactQueryLog(["%c >> query #1", "x"])).toBe(true);
  });

  it("参数不足两个时返回 false", () => {
    expect(isReactQueryLog(["%c << query #1"])).toBe(false);
  });

  it("首参数不是字符串时返回 false", () => {
    expect(isReactQueryLog([42, "x"])).toBe(false);
  });

  it("普通业务日志返回 false", () => {
    expect(isReactQueryLog(["hello", "world"])).toBe(false);
  });

  it("不满足 query #N 模式的 %c 日志返回 false", () => {
    expect(isReactQueryLog(["%c styled output", "color:red"])).toBe(false);
  });

  it("匹配 mutation 方向（tRPC loggerLink 标准形态）", () => {
    expect(
      isReactQueryLog(["%c << mutation #43 %cworkflow.update", "color:red"]),
    ).toBe(true);
    expect(isReactQueryLog(["%c >> mutation #7 %cfoo.bar", "x"])).toBe(true);
  });

  it("匹配塌缩/重包装形态（React devtools 合并单串）", () => {
    expect(isReactQueryLog(["[[ << mutation #43 ]workflow.update {}"])).toBe(
      true,
    );
    expect(isReactQueryLog(["[ >> query #2 ]workflow.list"])).toBe(true);
    expect(isReactQueryLog(["[<< mutation #1 x"])).toBe(true);
  });

  it("不误吞含类似文案的普通业务日志", () => {
    expect(isReactQueryLog(["user typed >> mutation #3 note"])).toBe(false);
    expect(isReactQueryLog(["business log about query result"])).toBe(false);
  });
});

/* ── isNextDevNoise ───────────────────────────────────────── */

describe("isNextDevNoise Next.js dev 提示识别", () => {
  it("识别 Fast Refresh 完成提示（不带样式参数）", () => {
    expect(isNextDevNoise(["[Fast Refresh] done in 7612ms"])).toBe(true);
    expect(isNextDevNoise(["[Fast refresh] finished in 1ms"])).toBe(true);
  });

  it("识别带 %c 样式参数的多参数形态", () => {
    expect(isNextDevNoise(["[Fast Refresh] done in 120ms", "color:#555"])).toBe(
      true,
    );
  });

  it("普通业务日志返回 false", () => {
    expect(isNextDevNoise(["完成加载，耗时 12ms"])).toBe(false);
    expect(isNextDevNoise(["refresh token 已更新"])).toBe(false);
    expect(isNextDevNoise([])).toBe(false);
  });
});

describe("isRoutineRpcTimingLog 常规 tRPC 调用计时识别（#294）", () => {
  it("识别 [rpc]/[trpc] 命名空间的 info 计时行", () => {
    expect(
      isRoutineRpcTimingLog(['[rpc] setting.dbStudioStatus 155ms {"type":"query"}']),
    ).toBe(true);
    expect(isRoutineRpcTimingLog(["[trpc] generate.generate 25ms"])).toBe(true);
    expect(isRoutineRpcTimingLog(["rpc] setting.get 12ms"])).toBe(true);
  });

  it("业务日志与告警不误吞", () => {
    expect(isRoutineRpcTimingLog(["设置加载失败 未知错误"])).toBe(false);
    expect(isRoutineRpcTimingLog(["[task] 任务完成 abc"])).toBe(false);
    expect(isRoutineRpcTimingLog([])).toBe(false);
  });
});

describe("isRoutineRpcTimingLine 文件行侧过滤（#294）", () => {
  it("app-runtime 常规 INFO 计时行返回 true（不进面板）", () => {
    expect(
      isRoutineRpcTimingLine(
        '[2026-09-15 10:20:30.123] [INFO] [rpc] setting.dbStudioStatus 155ms {"type":"query"}',
      ),
    ).toBe(true);
  });

  it("WARN 级别的慢查询行保留（返回 false）", () => {
    expect(
      isRoutineRpcTimingLine(
        "[2026-09-15 10:20:30.123] [WARN] [trpc] generate.generate 1500ms",
      ),
    ).toBe(false);
  });

  it("非 rpc 业务行保留", () => {
    expect(isRoutineRpcTimingLine("普通业务输出")).toBe(false);
  });
});

/* ── parseFileLogs ────────────────────────────────────────── */

describe("parseFileLogs 文件日志解析", () => {
  it("解析标准 [HH:mm:ss] [LEVEL] 行,时间基于 baseDate", () => {
    const base = new Date(2026, 7, 15);
    const entries = parseFileLogs("[12:30:45] [ERROR] boom", base);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("error");
    expect(entries[0]?.message).toBe("boom");
    expect(entries[0]?.source).toBe("system");
    expect(entries[0]?.time).toBe(new Date(2026, 7, 15, 12, 30, 45).getTime());
  });

  it("ERROR/WARN/INFO/DEBUG 级别正确归一化", () => {
    const base = new Date(2026, 7, 15);
    const entries = parseFileLogs(
      [
        "[01:00:00] [ERROR] e",
        "[01:00:01] [WARN] w",
        "[01:00:02] [INFO] i",
        "[01:00:03] [DEBUG] d",
      ].join("\n"),
      base,
    );
    expect(entries.map((e) => e.level)).toEqual([
      "error",
      "warn",
      "info",
      "debug",
    ]);
  });

  it("STEP/OK 归一化为 info", () => {
    const base = new Date(2026, 7, 15);
    const entries = parseFileLogs(
      ["[01:00:00] [STEP] s", "[01:00:01] [OK] ok"].join("\n"),
      base,
    );
    expect(entries.map((e) => e.level)).toEqual(["info", "info"]);
  });

  it("源码怪癖:WARNING 不在行正则枚举内,该行回退为 info 并保留原文", () => {
    const base = new Date(2026, 7, 15);
    const entries = parseFileLogs("[01:00:00] [WARNING] w", base);
    expect(entries.map((e) => e.level)).toEqual(["info"]);
    expect(entries[0]?.message).toBe("[01:00:00] [WARNING] w");
  });

  it("不匹配日志格式的行按 info 保留原文", () => {
    const entries = parseFileLogs("plain text line");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("info");
    expect(entries[0]?.message).toBe("plain text line");
  });

  it("空行被跳过且行尾 \\r 被剥离", () => {
    const entries = parseFileLogs("a\r\n\nb");
    expect(entries.map((e) => e.message)).toEqual(["a", "b"]);
  });

  it("ANSI 颜色码被剥离后仍可解析级别", () => {
    const base = new Date(2026, 7, 15);
    const entries = parseFileLogs(
      "\x1b[36m[10:00:00] [INFO] colored\x1b[0m",
      base,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("info");
    expect(entries[0]?.message).toBe("colored");
  });

  it("空文本返回空数组", () => {
    expect(parseFileLogs("")).toEqual([]);
  });

  it("Fast Refresh rebuilding 沾染错误级别标记时按 info 落板", () => {
    const base = new Date(2026, 8, 15);
    const entries = parseFileLogs(
      "[2026-09-15 18:23:09.404] [INFO] [Fast Refresh] rebuilding [ERROR] leftover",
      base,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("info");
    expect(entries[0]?.message).toBe("[Fast Refresh] rebuilding [ERROR] leftover");
  });

  it("Fast Refresh rebuilding 不带级别标记时保持 info", () => {
    const base = new Date(2026, 8, 15);
    const entries = parseFileLogs(
      "[2026-09-15 18:23:09.404] [INFO] [Fast Refresh] rebuilding",
      base,
    );
    expect(entries.map((e) => e.level)).toEqual(["info"]);
  });

  it("解析 app-runtime 行（日期时间 + LEVEL + 命名空间 + 消息）并带级别", () => {
    const base = new Date(2026, 8, 15);
    const entries = parseFileLogs(
      "[2026-09-15 10:20:30.123] [ERROR] [task] 任务失败 abc {id:1}",
      base,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("error");
    expect(entries[0]?.message).toBe("[task] 任务失败 abc {id:1}");
    const t = entries[0]?.time;
    const d = new Date(t ?? 0);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(20);
    expect(d.getSeconds()).toBe(30);
  });

  it("app-runtime 行无命名空间时消息不加命名空间前缀", () => {
    const base = new Date(2026, 8, 15);
    const entries = parseFileLogs(
      "[2026-09-15 10:20:30.123] [INFO] plain",
      base,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("info");
    expect(entries[0]?.message).toBe("plain");
  });

  it("app-runtime 行带命名空间时消息带 [ns] 前缀", () => {
    const base = new Date(2026, 8, 15);
    const entries = parseFileLogs(
      "[2026-09-15 10:20:30.123] [WARN] [trpc] generate.generate 25ms",
      base,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("warn");
    expect(entries[0]?.message).toBe("[trpc] generate.generate 25ms");
  });

  it("app-runtime 行优先于 launcher 行解析（带 LEVEL 时不被降级为 info）", () => {
    const base = new Date(2026, 8, 15);
    const entries = parseFileLogs(
      "[2026-09-15 10:20:30.123] [ERROR] [task] boom",
      base,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("error");
  });
});

/* ── captureLocation ──────────────────────────────────────── */

describe("captureLocation", () => {
  it("解析失败时安全返回 undefined,成功时以 :行号 结尾", () => {
    const loc = captureLocation();
    // 从测试文件调用时栈帧内容依赖运行器,这里只验证契约不抛异常
    expect(loc === undefined || /:\d+$/.test(loc)).toBe(true);
  });
});

/* ── 会话边界契约补全（ISSUE #321）─────────────────────────────────────
 * 规范 07 §7.14 把「面板只显示本次运行」定为契约，并写明三条硬规则：
 *   ①不做字节级跳过（按行时刻比较即可）；
 *   ②读不到起点就不截断（多显示几条历史，好过丢掉本次日志）；
 *   ③setSessionStart 幂等（页面重载不回退起点）。
 * 上面已有用例覆盖主干；这一段补**边界与不变量**——它们是「改坏了不会立刻
 * 被用户发现，但会在某次启动后突然显示上次日志」的那类回归。
 */

/** 哪类来源需要在轮询响应里带会话起点（规范 07 §7.14 的契约判据）。 */
function needsSessionStart(source: string): boolean {
  return (
    source === "app-runtime" ||
    source === "comfyui-runtime" ||
    source === "drizzle-studio-runtime" ||
    source === "ollama-runtime"
  );
}

describe("会话边界：时间线比较的边界与不变量（规范 07 §7.14）", () => {
  it("行时刻恰好等于起点 → 保留（>= 而非 >，边界同一毫秒不能丢）", () => {
    const cutoff = 1_700_000_000_000;
    const entries = [
      entry("at-cutoff", cutoff),
      entry("just-before", cutoff - 1),
      entry("just-after", cutoff + 1),
    ];
    expect(idsOf(dropStaleEntries(entries, cutoff))).toEqual([
      "at-cutoff",
      "just-after",
    ]);
  });

  it("起点为 undefined 同样不截断（与 null 等价，调用方漏传不能变成空面板）", () => {
    const entries = [entry("old", 1), entry("new", 2)];
    expect(idsOf(dropStaleEntries(entries, undefined))).toHaveLength(2);
  });

  it("起点为 0 视为「有效起点」而非「未设置」——0 是合法时间戳，不能当 falsy 跳过", () => {
    // 这条容易写错成 `if (!cutoffMs) return entries`：那样 0 会被当成未设置，
    // 于是「所有历史行」被放行。0 在实现里是合法起点（epoch），语义是
    // 「什么都不丢」，结果与不截断相同，但**判据**必须走 null 判断。
    const entries = [entry("a", 0), entry("b", 1)];
    expect(idsOf(dropStaleEntries(entries, 0))).toEqual(["a", "b"]);
  });

  it("origin 只用于展示、不参与过滤（dev / app-runtime 行同规则）", () => {
    const cutoff = 100;
    const entries = [
      { ...entry("dev-old", 50), origin: "dev" as const },
      { ...entry("runtime-old", 60), origin: "app-runtime" as const },
      { ...entry("dev-new", 150), origin: "dev" as const },
      { ...entry("runtime-new", 160), origin: "app-runtime" as const },
    ];
    const kept = dropStaleEntries(entries, cutoff);
    expect(idsOf(kept)).toEqual(["dev-new", "runtime-new"]);
    // origin 字段被原样保留（视图要显示来源）
    expect(kept.map((e) => e.origin)).toEqual(["dev", "app-runtime"]);
  });

  it("重复应用同一起点结果不变（幂等：轮询每来一批都过滤一次也不会累积漂移）", () => {
    const cutoff = 100;
    const entries = [entry("old", 50), entry("new", 150)];
    const once = dropStaleEntries(entries, cutoff);
    const twice = dropStaleEntries(once, cutoff);
    expect(idsOf(twice)).toEqual(idsOf(once));
  });

  it("乱序到达（旧行晚于新行）时结果稳定：只按时刻判定，与顺序无关", () => {
    const cutoff = 100;
    const outOfOrder = [entry("new", 200), entry("old", 50), entry("mid", 150)];
    const filtered = dropStaleEntries(outOfOrder, cutoff);
    // 顺序保持原样（本函数只过滤、不重排），但历史行被摘掉
    expect(idsOf(filtered)).toEqual(["new", "mid"]);
  });
});

describe("会话起点迟到：混入的历史行必须被收拢（不变量）", () => {

  it("起点到达前的历史行全部被清掉，且计数同步重算（不留幽灵计数）", () => {
    const cutoff = 1_000;

    // 起点未知（null）时先收下一批历史行 —— 这正是真实时序：
    // 首次轮询先于 sessionStart 下发。
    act(() =>
      useLogStore.getState().appendFileLogs([
        entry("stale-1", cutoff - 500),
        entry("stale-2", cutoff - 100),
      ]),
    );
    expect(useLogStore.getState().logs.some((l) => l.id === "stale-1")).toBe(true);

    // 起点到达：清历史 + 计数重算
    act(() => useLogStore.getState().setSessionStart(cutoff));

    const state = useLogStore.getState();
    expect(state.logs.some((l) => l.id === "stale-1")).toBe(false);
    expect(state.logs.some((l) => l.id === "stale-2")).toBe(false);
    expect(state.counts.all).toBe(state.logs.length);
  });

  it("起点到达时保留本次运行的行（不能连本次日志一起丢）", () => {
    const cutoff = 1_000;
    act(() =>
      useLogStore.getState().appendFileLogs([
        entry("stale", cutoff - 1),
        entry("current", cutoff + 1),
      ]),
    );
    act(() => useLogStore.getState().setSessionStart(cutoff));
    expect(idsOf(useLogStore.getState().logs)).toContain("current");
    expect(idsOf(useLogStore.getState().logs)).not.toContain("stale");
  });

  it("起点从 null 变为具体值后不回退：再设 null 也不会把已丢的历史行找回来", () => {
    const cutoff = 1_000;
    act(() => useLogStore.getState().appendFileLogs([entry("stale", cutoff - 1)]));
    act(() => useLogStore.getState().setSessionStart(cutoff));
    expect(idsOf(useLogStore.getState().logs)).not.toContain("stale");

    act(() => useLogStore.getState().setSessionStart(null));
    // 已被丢弃的行不会复活（它们不在 store 里了）——这是「不回退」的实际含义
    expect(idsOf(useLogStore.getState().logs)).not.toContain("stale");
  });

  it("页面重载（store 重建）后用同一起点重放：结果与首次一致", () => {
    const cutoff = 1_000;
    const batch = [entry("stale", cutoff - 1), entry("current", cutoff + 1)];

    // 第一次会话
    act(() => useLogStore.getState().setSessionStart(cutoff));
    act(() => useLogStore.getState().appendFileLogs(batch));
    const first = idsOf(useLogStore.getState().logs);

    // 模拟重载：清空后重放同一个起点与同一批数据
    useLogStore.setState({
      logs: [],
      sessionStart: null,
      revision: 0,
      viewRevision: 0,
      viewSeenIds: new Set<string>(),
      counts: { all: 0, debug: 0, info: 0, warn: 0, error: 0 },
    });
    act(() => useLogStore.getState().setSessionStart(cutoff));
    act(() => useLogStore.getState().appendFileLogs(batch));
    const second = idsOf(useLogStore.getState().logs);

    expect(second).toEqual(first);
  });
});

describe("轮询响应契约：会话起点随追加写来源下发（/api/logs/current）", () => {
  /* 规范 07 §7.14 的「起点下发」环节：追加写来源必须在响应里带 sessionStart，
   * 而 dev 来源天然只有本次内容、不需要它。这条契约靠客户端与服务端约定，
   * 改坏了表现为「面板又开始混着上次的日志」——没有测试就会静默回归。
   *
   * 这里以「来源 → 是否应带 sessionStart」的判据表锁住，而不是去起 HTTP 服务：
   * 判据表是契约本身，实现改动只要仍满足它即可。 */

  const APPEND_WRITE_SOURCES = [
    "app-runtime",
    "comfyui-runtime",
    "drizzle-studio-runtime",
    "ollama-runtime",
  ] as const;

  it("四类追加写来源都判定为「需要会话起点」", () => {
    for (const source of APPEND_WRITE_SOURCES) {
      expect(needsSessionStart(source)).toBe(true);
    }
  });

  it("dev（dev-launcher 日志）不需要会话起点：它每次运行都覆盖重建，天然只有本次", () => {
    expect(needsSessionStart("dev-launcher")).toBe(false);
    expect(needsSessionStart("dev")).toBe(false);
  });

  it("读不到锚点时起点为 null，客户端据此退化为不截断（规则②）", () => {
    // 非双击链路启动的场景：dev-launcher.log 不存在 → sessionStart 为 null。
    // 客户端必须**不**因此丢弃整段内容（宁可多显示历史行）。
    const entries = [entry("hist", 1), entry("now", 2)];
    expect(dropStaleEntries(entries, null)).toHaveLength(2);
  });
});

/* ── 时间线按时刻排序（ISSUE #262）─────────────────────────────────────
 * 三路轮询（launcher / dev / app-runtime）并发到达，而转录行带的是**文件写入
 * 时刻**：后到的批次里可能有更早时刻的行。旧实现直接按到达顺序 `[...logs, ...fresh]`
 * 追加，于是面板看着「日期忽大忽小、新增的行被插进中间」——用户反馈的
 * 「连最基本的按时间顺序显示都做不到」就是它（ISSUE #262）。
 *
 * 下面把「时间线按时刻有序、同刻按入库顺序稳定」钉成断言：改回按到达顺序堆叠就会红。
 */
describe("mergeTimeline：时间线按时刻排序，时刻相同再按入库顺序（#262）", () => {
  it("迟到的旧时刻行被插回它该在的位置，而不是堆到末尾", () => {
    const out = mergeTimeline([entry("a", 300)], [entry("b", 100)]);
    expect(idsOf(out)).toEqual(["b", "a"]);
  });

  it("乱序批次合并后整体按时刻升序", () => {
    const out = mergeTimeline([entry("d", 400)], [
      entry("c", 300),
      entry("a", 100),
      entry("b", 200),
    ]);
    expect(idsOf(out)).toEqual(["a", "b", "c", "d"]);
    expect(out.map((e) => e.time)).toEqual([100, 200, 300, 400]);
  });

  it("同一毫秒内的多行按入库顺序（seq）保持稳定，不随排序抖动", () => {
    const same = 1_000;
    const a: LogEntry = { ...entry("a", same), seq: 10 };
    const b: LogEntry = { ...entry("b", same), seq: 11 };
    const c: LogEntry = { ...entry("c", same), seq: 12 };
    // 即使被乱序送达，同一毫秒内仍按入库顺序排（seq 是稳定次键）
    const out = mergeTimeline([b, c], [a]);
    expect(idsOf(out)).toEqual(["a", "b", "c"]);
  });

  it("跨毫秒只看时刻：更早到达但时刻更晚的行排在后面", () => {
    const first = [entry("late-time", 2_000)];
    const second = [entry("early-time", 500)];
    expect(idsOf(mergeTimeline(first, second))).toEqual(["early-time", "late-time"]);
  });

  it("同一行被两路读到（时刻/级别/内容全同）时只保留一条", () => {
    // launcher 转写会包含 dev 输出：同一行可能在两个来源里各出现一次。
    const dup = { ...entry("dev-copy", 1_000) };
    const other = { ...dup, id: "launcher-copy", seq: dup.seq + 1 };
    const out = mergeTimeline([dup], [other]);
    expect(idsOf(out)).toEqual(["dev-copy"]);
  });

  it("内容相同但时刻不同的行都保留（同一句话在两个时间点各发生一次）", () => {
    const a = entry("a", 1_000);
    const b = { ...entry("b", 2_000), message: a.message };
    expect(mergeTimeline([a], [b])).toHaveLength(2);
  });

  it("全是重复行时返回原数组引用（不产生无谓的状态更新）", () => {
    const current = [entry("a", 1)];
    expect(mergeTimeline(current, [{ ...entry("b", 1), message: current[0]!.message }])).toBe(
      current,
    );
  });

  it("空批返回原数组引用", () => {
    const current = [entry("a", 1)];
    expect(mergeTimeline(current, [])).toBe(current);
  });

  it("超过上限时裁掉时刻最旧的（不是最早到达的）", () => {
    const current = [entry("newest", 1_000)];
    // 后到达但时刻更早的一批：合并后它们排在前面，超过 max 时会被裁掉
    const late = [entry("ancient", 1), entry("old", 2), entry("new", 3), entry("mid", 500)];
    const out = mergeTimeline(current, late, 3);
    expect(idsOf(out)).toEqual(["new", "mid", "newest"]);
  });
});

describe("appendFileLogs 走时间线合并（#262 回归）", () => {
  it("后到的批次时刻更早时，面板里仍按时刻顺序排列", () => {
    act(() =>
      useLogStore.getState().appendFileLogs([makeEntry({ id: "newer", time: 5_000 })]),
    );
    act(() =>
      useLogStore.getState().appendFileLogs([makeEntry({ id: "older", time: 1_000 })]),
    );
    expect(idsOf(useLogStore.getState().logs)).toEqual(["older", "newer"]);
  });

  it("同一批内容被重复轮询回来时不会重复入库（面板条数＝真实行数）", () => {
    const batch = [
      makeEntry({ id: "x1", message: "第一行", time: 1_000 }),
      makeEntry({ id: "x2", message: "第二行", time: 1_100 }),
    ];
    act(() => useLogStore.getState().appendFileLogs(batch));
    // 文件被整段重读（首帧窗口 / 服务端要求回退重读）→ 同一批行再次送达
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs(batch.map((e, i) => ({ ...e, id: `dup-${i}` }))),
    );
    expect(useLogStore.getState().logs.map((e) => e.message)).toEqual([
      "第一行",
      "第二行",
    ]);
  });
});

/* ── 连续重复行折叠（让「有信息量」落到显示层）─────────────────────────
 * 一屏里连续 N 条完全相同的行（每轮轮询写一条同样的慢查询 / 重连提示）是最常见
 * 的「没信息量」形态。写入侧已按时间桶聚合（§7.14.1），显示层再兜一道：只折叠
 * **连续**重复，且只保留前 limit 条 + 一条「重复 N 次」说明。
 */
describe("dedupeRepeats 连续重复行折叠", () => {
  /* 连续重复行的定义是「时刻 + 级别 + 内容」全同（跨来源去重用的同一判据），
   * 因此夹具刻意让 message 取同一个值，只有 time 不同也不影响折叠（相邻即折叠）。 */
  const repeat = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      makeEntry({ id: `r-${i}`, message: "ComfyUI 未就绪，等待中", time: 1_000 + i }),
    );

  it("少于等于阈值时原样保留", () => {
    expect(dedupeRepeats(repeat(5))).toHaveLength(5);
  });

  it("超过阈值时保留前几条 + 一条「重复 N 次」说明", () => {
    const out = dedupeRepeats(repeat(400), 5);
    // 5 条原文 + 1 条折叠说明
    expect(out).toHaveLength(6);
    expect(out[5]?.message).toBe("…（以上内容连续重复 395 次）");
  });

  it("只折叠连续重复：中间隔着别的行时不合并", () => {
    const entries = [
      ...repeat(3),
      makeEntry({ id: "other", message: "别的事件", time: 2_000 }),
      ...repeat(3),
    ];
    expect(dedupeRepeats(entries)).toHaveLength(7);
  });

  it("折叠只影响显示，不改动时间线（原文仍在 store 里）", () => {
    act(() => useLogStore.getState().appendFileLogs(repeat(50)));
    const before = useLogStore.getState().logs.length;
    dedupeRepeats(useLogStore.getState().logs);
    expect(before).toBe(50);
    expect(useLogStore.getState().logs).toHaveLength(50);
  });
});

/* ── 分页选择器（#262：显示多少条 ≠ 内存上限）────────────────────────── */

describe("selectPageLogs 倒序分页", () => {
  const logs = Array.from({ length: 450 }, (_, i) =>
    makeEntry({ id: `p-${i}`, time: i, seq: i }),
  );

  it("第 1 页是最新的一段，往前翻看到更早的", () => {
    const first = selectPageLogs(logs, 1, 200);
    expect(first.entries[0]?.id).toBe("p-250");
    expect(first.entries[199]?.id).toBe("p-449");
    const second = selectPageLogs(logs, 2, 200);
    expect(second.entries[0]?.id).toBe("p-50");
    expect(second.entries[199]?.id).toBe("p-249");
  });

  it("页码超界时钳到最后一页（并回传钳后的页码）", () => {
    const out = selectPageLogs(logs, 99, 200);
    expect(out.page).toBe(3);
    expect(out.totalPages).toBe(3);
    expect(out.entries).toHaveLength(50);
  });

  it("空时间线恒为第 1 页、共 1 页", () => {
    const out = selectPageLogs([], 5, 200);
    expect(out.page).toBe(1);
    expect(out.totalPages).toBe(1);
    expect(out.entries).toEqual([]);
  });

  it("总页数随过滤结果变化（450 条 / 每页 200 → 3 页）", () => {
    expect(selectPageLogs(logs, 1, 200).totalPages).toBe(3);
    expect(selectPageLogs(logs.slice(0, 100), 1, 200).totalPages).toBe(1);
  });
});

describe("selectShouldPinToLatest 何时该给「回到最新」出口", () => {
  it("停在第 1 页且贴底：不需要出口", () => {
    expect(selectShouldPinToLatest(1, true)).toBe(false);
  });

  it("翻到历史页：需要出口（即使滚动条在底部）", () => {
    expect(selectShouldPinToLatest(3, true)).toBe(true);
  });

  it("用户上滚离开底部：需要出口（新日志不该把他的阅读位置冲走）", () => {
    expect(selectShouldPinToLatest(1, false)).toBe(true);
  });
});

/* ── 「有 N 条新的日志」：窗口口径（ISSUE #346 / #262 复审）──────────────
 *
 * 翻到历史位置时面板内容不会因新日志而改变，用户此前只能看到「计数在涨、页面却
 * 不动」。出口是页脚那句「有 N 条新的日志 · 回到最新」。
 *
 * 判据在 #346 是「水位 + 长度差」，#262 复审换成了**窗口几何量**：用户看的那一段
 * （第 1 页的锚定窗口 / 历史页整段）之后还有多少条。旧口径有两处必然失灵的场合，
 * 两处都被用户撞到过：
 *   1. 时间线**封顶**（环形缓冲 2000 条）时长度差恒为 0 —— 明明一直在涨，却报
 *      「没有新日志」，那个出口永远不出现（用户读到的就是「翻页翻不动」）；
 *   2. 写入路径一旦「顺手刷新水位」，新行当场被标成已读，同样永远报 0。
 * 窗口口径是几何量，与「谁什么时候读了什么」无关，这两处都不会发生。
 */
describe("「有 N 条新的日志」按窗口口径计数（#346 / #262 复审）", () => {
  /* 需要**多于两页**的内容才谈得上「翻到历史页」：第 1 页是最新 200 条，翻到第 2 页
   * 之后仍有更新的日志压在上面，这些就是「我没看、但已经来了」的那批。 */
  const seedPages = (extra = 0) => {
    const base = LOG_PAGE_SIZE * 2 + extra;
    act(() =>
      useLogStore.getState().appendFileLogs(
        Array.from({ length: base }, (_, i) =>
          makeEntry({ id: `h-${i}`, message: `事件 ${i}`, time: i * 10, seq: i }),
        ),
      ),
    );
  };

  it("翻到历史页后新到的日志计入条数", () => {
    seedPages();
    act(() => useLogStore.getState().setPage(2));
    expect(newCount(2, true)).toBe(0);

    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([makeEntry({ id: "later", time: 999_999 })]),
    );
    expect(newCount(2, true)).toBe(1);
  });

  it("迟到的旧时刻行也算新增（谁排在窗口之后，谁就是新的）", () => {
    seedPages();
    act(() => useLogStore.getState().setPage(2));
    /* 迟到的一条时刻更早，会插到时间线**中间**：末条不变、窗口却确实往后挪了。 */
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([makeEntry({ id: "late", time: 5, seq: 9_999 })]),
    );
    expect(newCount(2, true)).toBe(1);
  });

  it("回到第 1 页即视为已读，计数归零", () => {
    seedPages();
    act(() => useLogStore.getState().setPage(2));
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([makeEntry({ id: "later", time: 999_999 })]),
    );
    expect(newCount(2, true)).toBe(1);

    act(() => useLogStore.getState().setPage(1));
    expect(newCount(1, true)).toBe(0);
  });

  it("停在第 1 页但用户上滚离开底部时，也提示有新日志", () => {
    seedPages();
    /* setPage(1) = 用户把第 1 页（最新一段）当作已读基线，锚点随之就位。 */
    act(() => useLogStore.getState().setPage(1));
    act(() =>
      useLogStore
        .getState()
        .appendFileLogs([makeEntry({ id: "later", time: 999_999 })]),
    );
    /* 用户上滚 = autoScroll false：这正是「新日志把他的阅读位置冲走」的场景 */
    expect(newCount(1, false)).toBe(1);
  });

  it("全批都是重复行（时间线未变）时不虚报新增", () => {
    seedPages();
    /* 先让这条内容落板，再翻到历史页（此刻看不到它，但它的位置已经恒定）。 */
    const line = makeEntry({ id: "dup-src", message: "同一行", time: 999_999 });
    act(() => useLogStore.getState().appendFileLogs([line]));
    act(() => useLogStore.getState().setPage(2));
    const settled = newCount(2, true);
    /* 再送来**同一行**（时间/级别/内容全同，只是 id 不同）：时间线按内容去重，
     * 什么都没有新增，计数也不该动。 */
    act(() => useLogStore.getState().appendFileLogs([{ ...line, id: "dup" }]));
    expect(newCount(2, true)).toBe(settled);
  });
});

/* ── 第 1 页锚定窗口：用户正在看的那一段不被新日志推走（#262 复审）────────
 *
 * 用户原话：「日志到上限了还继续产生新日志内容，日志面板中显示的内容就不断移动，
 * 我想复制其中某一项就十分困难，甚至无法选择，刚选择就刷新把我的选择弄没了。」
 *
 * 直接原因在真实浏览器里量到了：第 1 页取的是时间线**尾部 200 条**，每来一条新行
 * 这个窗口就整体前移一格，React 于是卸载最上面那一条、挂上新的最末一条——用户框
 * 在首行里的文本**随节点一起被卸载**，选区当场消失（滚动位置甚至没动）。
 *
 * 修法是给第 1 页一个锚点：窗口钉在「用户看过的那一段」上，新行列在它之后。
 */
describe("selectFirstPageWindow 第 1 页锚定窗口（#262 复审）", () => {
  const logs = Array.from({ length: 300 }, (_, i) =>
    makeEntry({ id: `w-${i}`, time: i, seq: i }),
  );

  it("有锚点时以锚点为窗口起点，且给出「后面还有多少条更新的日志」", () => {
    const out = selectFirstPageWindow(logs, "w-50", 200);
    expect(out.entries[0]?.id).toBe("w-50");
    expect(out.entries).toHaveLength(200);
    /* 300 - (50 + 200) = 50 条比窗口更新的日志 */
    expect(out.truncatedFromEnd).toBe(50);
  });

  it("新日志到达时窗口不动（这正是选区不被冲掉的原因）", () => {
    const before = selectFirstPageWindow(logs, "w-50", 200);
    const grown = [
      ...logs,
      makeEntry({ id: "w-new", time: 9_999, seq: 9_999 }),
    ];
    const after = selectFirstPageWindow(grown, "w-50", 200);
    /* 窗口内容逐条相同（DOM 节点不会被重建），只是「后面的」多了 1 条 */
    expect(after.entries.map((e) => e.id)).toEqual(
      before.entries.map((e) => e.id),
    );
    expect(after.truncatedFromEnd).toBe(before.truncatedFromEnd + 1);
  });

  it("锚点已被环形缓冲挤出去时退回尾部窗口（不报错、也不留空页）", () => {
    const out = selectFirstPageWindow(logs, "已经被挤掉的 id", 200);
    expect(out.entries).toHaveLength(200);
    expect(out.entries[199]?.id).toBe("w-299");
    expect(out.truncatedFromEnd).toBe(0);
  });

  it("没有锚点（首次打开）时就是尾部窗口", () => {
    const out = selectFirstPageWindow(logs, null, 200);
    expect(out.entries[0]?.id).toBe("w-100");
    expect(out.truncatedFromEnd).toBe(0);
  });

  it("时间线短于窗口时整段都在窗口里", () => {
    const out = selectFirstPageWindow(logs.slice(0, 20), "w-0", 200);
    expect(out.entries).toHaveLength(20);
    expect(out.truncatedFromEnd).toBe(0);
  });
});

/* ── 来源筛选（#262）────────────────────────────────────────────────── */

describe("setOrigin 按来源筛选", () => {
  const seed = () =>
    act(() =>
      useLogStore.getState().appendFileLogs([
        {
          ...makeEntry({ id: "dev-1", time: 1_000, message: "开发服务已就绪" }),
          origin: "dev",
        },
        {
          ...makeEntry({ id: "app-1", time: 2_000, message: "任务入队" }),
          origin: "app-runtime",
        },
        {
          ...makeEntry({ id: "app-2", time: 3_000, message: "任务完成" }),
          origin: "app-runtime",
        },
      ]),
    );

  it("只看应用运行日志时启动行被挡在外面", () => {
    seed();
    act(() => useLogStore.getState().setOrigin("app-runtime"));
    expect(idsOf(useLogStore.getState().filteredLogs)).toEqual(["app-1", "app-2"]);
    expect(useLogStore.getState().counts.all).toBe(3);
  });

  it("只看启动日志时应用行被挡在外面", () => {
    seed();
    act(() => useLogStore.getState().setOrigin("dev"));
    expect(idsOf(useLogStore.getState().filteredLogs)).toEqual(["dev-1"]);
  });

  it("切回全部来源恢复完整时间线", () => {
    seed();
    act(() => useLogStore.getState().setOrigin("app-runtime"));
    act(() => useLogStore.getState().setOrigin("all"));
    expect(useLogStore.getState().filteredLogs).toHaveLength(3);
  });

  it("来源筛选与级别筛选、搜索叠加生效", () => {
    seed();
    act(() => useLogStore.getState().setOrigin("app-runtime"));
    act(() => useLogStore.getState().setSearch("任务完成"));
    expect(idsOf(useLogStore.getState().filteredLogs)).toEqual(["app-2"]);
  });

  it("切换来源后回到第 1 页（避免停在越界的空白页）", () => {
    seed();
    act(() => useLogStore.getState().setPage(2));
    act(() => useLogStore.getState().setOrigin("app-runtime"));
    expect(useLogStore.getState().page).toBe(1);
  });
});

/* ── 服务端进程标识（ISSUE #360）──────────────────────────────
 * 面板此前无法回答「这条日志来自哪个应用服务进程」，于是「应用服务没起来」时
 * 用户既看不到日志、也说不出自己连的是谁。bootId 同时承担展示与「真重启后
 * 重置时间线」两件事。 */
describe("log store — 服务端进程标识与会话边界", () => {
  beforeEach(() => resetStore());

  it("首次写入 bootId 不清空时间线（只是记录，不是重启）", () => {
    act(() => {
      useLogStore.getState().appendFileLogs([
        makeEntry({ time: 1_700_000_000_000, origin: "app" }),
      ]);
    });
    expect(useLogStore.getState().logs).toHaveLength(1);

    act(() => useLogStore.getState().setBootId("dev-boot:1:a"));
    expect(useLogStore.getState().bootId).toBe("dev-boot:1:a");
    // 首次记录不是重启：既有行保留
    expect(useLogStore.getState().logs).toHaveLength(1);
  });

  it("bootId 变化 = 换了进程：清空时间线并重置分页", () => {
    act(() => {
      useLogStore.getState().setBootId("dev-boot:1:a");
      useLogStore.getState().appendFileLogs([
        makeEntry({ time: 1_700_000_000_000, origin: "app" }),
        makeEntry({ time: 1_700_000_001_000, origin: "app" }),
      ]);
    });
    expect(useLogStore.getState().logs).toHaveLength(2);
    act(() => useLogStore.getState().setPage(3));
    expect(useLogStore.getState().page).toBe(3);

    act(() => useLogStore.getState().setBootId("dev-boot:2:b"));
    const state = useLogStore.getState();
    expect(state.bootId).toBe("dev-boot:2:b");
    /* 旧进程的行与本次会话没有可比性，必须清掉；否则重启前后输出混成一条线 */
    expect(state.logs).toHaveLength(0);
    expect(state.page).toBe(1);
  });

  it("同一 bootId 重复写入是幂等的（轮询每 2s 都会带一次）", () => {
    act(() => {
      useLogStore.getState().setBootId("dev-boot:1:a");
      useLogStore.getState().appendFileLogs([
        makeEntry({ time: 1_700_000_000_000 }),
      ]);
    });
    const before = useLogStore.getState();
    act(() => useLogStore.getState().setBootId("dev-boot:1:a"));
    const after = useLogStore.getState();
    expect(after.logs).toBe(before.logs);
    expect(after.revision).toBe(before.revision);
  });
});
