import { describe, it, expect, beforeEach } from "vitest";
import {
  useLogStore,
  serialize,
  isReactQueryLog,
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
  });
}

function idsOf(entries: LogEntry[]): (string | undefined)[] {
  return entries.map((e) => e.id);
}

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
    useLogStore.getState().appendFileLogs([
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
      makeEntry({ id: "e2", level: "error", message: "Kernel Boom", source: "tauri" }),
      makeEntry({ id: "e3", level: "warn", message: "启动检查完成", source: "system" }),
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
    expect(idsOf(useLogStore.getState().filteredLogs).sort()).toEqual(["e1", "e2"]);
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
    useLogStore.getState().appendFileLogs([makeEntry({ id: "a", level: "warn" })]);
    useLogStore.getState().setFilter("warn");
    const { filter, logs, counts, filteredLogs } = useLogStore.getState();
    expect(filter).toBe("warn");
    expect(idsOf(logs)).toEqual(["a"]);
    expect(counts.all).toBe(1);
    expect(idsOf(filteredLogs)).toEqual(["a"]);
  });

  it("setSearch 更新 search 并保留已有 filter", () => {
    useLogStore.getState().appendFileLogs([makeEntry({ id: "a", message: "hello" })]);
    const s = useLogStore.getState();
    s.setFilter("info");
    s.setSearch("hello");
    const { search, filter, filteredLogs } = useLogStore.getState();
    expect(search).toBe("hello");
    expect(filter).toBe("info");
    expect(idsOf(filteredLogs)).toEqual(["a"]);
  });

  it("先 setSearch 后 setFilter 时两个条件叠加生效", () => {
    useLogStore.getState().appendFileLogs([
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
      .appendFileLogs([makeEntry({ id: "a" }), makeEntry({ id: "b", level: "error" })]);
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
    expect(isReactQueryLog(["[[ << mutation #43 ]workflow.update {}"])).toBe(true);
    expect(isReactQueryLog(["[ >> query #2 ]workflow.list"])).toBe(true);
    expect(isReactQueryLog(["[<< mutation #1 x"])).toBe(true);
  });

  it("不误吞含类似文案的普通业务日志", () => {
    expect(isReactQueryLog(["user typed >> mutation #3 note"])).toBe(false);
    expect(isReactQueryLog(["business log about query result"])).toBe(false);
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
      ["[01:00:00] [ERROR] e", "[01:00:01] [WARN] w", "[01:00:02] [INFO] i", "[01:00:03] [DEBUG] d"].join(
        "\n",
      ),
      base,
    );
    expect(entries.map((e) => e.level)).toEqual(["error", "warn", "info", "debug"]);
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
});

/* ── captureLocation ──────────────────────────────────────── */

describe("captureLocation", () => {
  it("解析失败时安全返回 undefined,成功时以 :行号 结尾", () => {
    const loc = captureLocation();
    // 从测试文件调用时栈帧内容依赖运行器,这里只验证契约不抛异常
    expect(loc === undefined || /:\d+$/.test(loc)).toBe(true);
  });
});
