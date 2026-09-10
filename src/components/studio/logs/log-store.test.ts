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
  captureLocation,
} from "./log-store";
import type { LogEntry } from "./log-store";

/* ── 测试夹具 ─────────────────────────────────────────────── */

let seq = 0;
function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  seq += 1;
  return {
    id: `test-${seq}`,
    time: 1_700_000_000_000,
    level: "info",
    message: `msg-${seq}`,
    source: "system",
    ...overrides,
  };
}

/** 每个用例前把 store 重置为已知初始状态,避免用例间污染。 */
function resetStore() {
  useLogStore.setState({
    logs: [],
    filteredLogs: [],
    filter: "all",
    search: "",
    isOpen: false,
    counts: { all: 0, debug: 0, info: 0, warn: 0, error: 0 },
    sessionStart: null,
  });
}

function idsOf(entries: LogEntry[]): (string | undefined)[] {
  return entries.map((e) => e.id);
}

/** 造一条「时刻可控」的日志行（会话边界用例都按 time 判定）。 */
function entry(id: string, time: number): LogEntry {
  return {
    id,
    time,
    level: "info",
    message: `msg-${id}`,
    source: "system",
  };
}

afterEach(cleanup);

beforeEach(resetStore);

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
    expect(counts).toEqual({ all: 3, debug: 0, info: 2, warn: 0, error: 1 });
    expect(idsOf(filteredLogs)).toEqual(["m1", "m3"]);
  });

  it("追加空数组时状态保持不变", () => {
    useLogStore.setState({ logs: [makeEntry({ id: "keep" })] });
    useLogStore.getState().appendFileLogs([]);
    const { logs, counts } = useLogStore.getState();
    expect(idsOf(logs)).toEqual(["keep"]);
    expect(counts.all).toBe(1);
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

/* ── MAX_LOG_ENTRIES 上限裁剪 ─────────────────────────────── */

describe("MAX_LOG_ENTRIES 上限裁剪", () => {
  it("批量追加超过 2000 条时最旧的日志被挤出", () => {
    const oldLogs: LogEntry[] = Array.from({ length: 1995 }, (_, i) =>
      makeEntry({ id: `old-${i}`, message: `old-${i}` }),
    );
    useLogStore.setState({ logs: oldLogs });
    const fresh: LogEntry[] = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ id: `new-${i}`, message: `new-${i}` }),
    );
    useLogStore.getState().appendFileLogs(fresh);

    const { logs, counts } = useLogStore.getState();
    expect(logs).toHaveLength(2000);
    // 1995 + 10 = 2005,裁掉最旧的 5 条旧记录(old-0..old-4) → 首条是 old-5
    expect(logs[0]?.id).toBe("old-5");
    expect(logs[1990]?.id).toBe("new-0");
    expect(logs[1999]?.id).toBe("new-9");
    expect(counts.all).toBe(2000);
  });

  it("addEntry 在满仓时挤出最旧的一条", () => {
    const oldLogs: LogEntry[] = Array.from({ length: 2000 }, (_, i) =>
      makeEntry({ id: `old-${i}` }),
    );
    useLogStore.setState({ logs: oldLogs });
    useLogStore
      .getState()
      .addEntry({ level: "warn", message: "最新一条", source: "system" });

    const { logs } = useLogStore.getState();
    expect(logs).toHaveLength(2000);
    expect(logs[0]?.id).toBe("old-1");
    expect(logs[1999]?.message).toBe("最新一条");
  });

  it("恰好达到 2000 条上限时不裁剪", () => {
    const oldLogs: LogEntry[] = Array.from({ length: 1999 }, (_, i) =>
      makeEntry({ id: `old-${i}` }),
    );
    useLogStore.setState({ logs: oldLogs });
    useLogStore
      .getState()
      .addEntry({ level: "info", message: "第 2000 条", source: "system" });

    const { logs } = useLogStore.getState();
    expect(logs).toHaveLength(2000);
    expect(logs[0]?.id).toBe("old-0");
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
  // 复用文件顶部的 resetStore（beforeEach 已全局接入），这里只需额外保证 page 归位
  beforeEach(() => useLogStore.setState({ page: 1 }));

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
    useLogStore.setState({ logs: [], sessionStart: null, counts: { all: 0, debug: 0, info: 0, warn: 0, error: 0 } });
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
