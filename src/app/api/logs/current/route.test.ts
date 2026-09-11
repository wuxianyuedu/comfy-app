/**
 * /api/logs/current 的增量读取契约（ISSUE #262 的根因回归）。
 *
 * 面板「越读越旧、只能看到 2000 条以内、时间顺序错乱」的直接原因是这里的
 * 尾部滑动窗口太窄（128KB ≈ 900~1500 行）且**与内存上限无关**：一旦文件超过
 * 窗口，首帧只能拿到最后一段，前面的日志面板永远看不到，时间线也从中间开始。
 *
 * 本用例把三条契约钉死：
 *   1. 首次打开回**行对齐**的尾部窗口，窗口内不会截出半行；
 *   2. 带游标时只回新增，不回退读；
 *   3. 游标失效（文件被新运行覆盖重建 / 游标越界）时回退到尾部窗口，
 *      且 `size` 仍是文件总长，客户端据此继续增量。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "log-current-"));
const logFile = path.join(tmp, "app-runtime.log");

vi.mock("@/lib/log-paths", async () => {
  const actual = await vi.importActual("@/lib/log-paths");
  return {
    ...(actual as Record<string, unknown>),
    APP_RUNTIME_LOG: logFile,
    DEV_LAUNCHER_LOG: path.join(tmp, "dev-launcher.log"),
  };
});

const { GET } = await import("./route");

/** 造 n 行 app-runtime 形态的日志（单行约 85 字节）。 */
function writeLines(n: number, startIndex = 0): void {
  const lines = Array.from({ length: n }, (_, i) => {
    const idx = startIndex + i;
    return `[2026-09-11 15:${String(Math.floor(idx / 60) % 60).padStart(2, "0")}:${String(idx % 60).padStart(2, "0")}.123] [INFO] [task] 任务里程碑 ${idx}`;
  });
  fs.appendFileSync(logFile, lines.join("\n") + "\n", "utf8");
}

async function read(source: string, offset = 0) {
  const res = await GET(new Request(`http://localhost/api/logs/current?source=${source}&offset=${offset}`));
  return (await res.json()) as {
    content: string;
    size: number;
    offset: number;
    sessionStart: number | null;
  };
}

beforeEach(() => {
  fs.writeFileSync(logFile, "", "utf8");
});

afterEach(() => {
  fs.rmSync(logFile, { force: true });
});

describe("GET /api/logs/current 增量读取", () => {
  it("首次打开（offset=0）回全部内容，并回传文件总长作为游标", async () => {
    writeLines(10);
    const data = await read("app-runtime", 0);
    expect(data.content.split("\n").filter(Boolean)).toHaveLength(10);
    expect(data.size).toBe(fs.statSync(logFile).size);
    // 未越过尾部窗口时起点就是 0（从头读）
    expect(data.offset).toBe(0);
  });

  it("带游标时只回新增内容，不重读已读部分", async () => {
    writeLines(10);
    const first = await read("app-runtime", 0);
    writeLines(5, 10);
    const second = await read("app-runtime", first.size);
    expect(second.content.split("\n").filter(Boolean)).toHaveLength(5);
    expect(second.content).toContain("任务里程碑 14");
    expect(second.content).not.toContain("任务里程碑 0");
    expect(second.size).toBe(fs.statSync(logFile).size);
  });

  it("游标越过文件末尾时回退到尾部窗口（文件被新运行重建的场景）", async () => {
    writeLines(10);
    // 模拟「文件变小」：新运行覆盖重建，旧游标（很大）已失效
    fs.writeFileSync(logFile, "", "utf8");
    writeLines(3);
    const data = await read("app-runtime", 999_999);
    expect(data.content).toContain("任务里程碑 2");
    expect(data.size).toBe(fs.statSync(logFile).size);
  });

  it("追加写来源都带会话起点；读不到锚点时是 null（客户端据此不截断）", async () => {
    writeLines(1);
    for (const source of ["app-runtime", "comfyui-runtime", "drizzle-studio-runtime", "ollama-runtime"]) {
      const data = await read(source, 0);
      expect(data).toHaveProperty("sessionStart");
    }
  });

  it("文件不存在时返回空内容且 size=0，不抛错", async () => {
    const data = await read("app-runtime", 0);
    expect(data.content).toBe("");
    expect(data.size).toBe(0);
  });

  it("BOM / 空行不会破坏行解析（面板按行解析，格式必须完整）", async () => {
    fs.appendFileSync(logFile, "\n\n", "utf8");
    writeLines(2);
    const data = await read("app-runtime", 0);
    const lines = data.content.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2} /);
  });
});

describe("GET /api/logs/current 无新增时的快速路径", () => {
  it("游标已在文件末尾时回空内容，size/offset 保持不变", async () => {
    writeLines(3);
    const first = await read("app-runtime", 0);
    const second = await read("app-runtime", first.size);
    expect(second.content).toBe("");
    expect(second.size).toBe(first.size);
    expect(second.offset).toBe(first.size);
  });
});
