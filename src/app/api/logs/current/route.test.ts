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

/* 全部日志路径都落到本用例自己的临时目录：`log/` 在 .gitignore 里，
 * CI / 干净检出上根本不存在。若不 mock `NEXTJS_LOG_DIR`，`source=app` 会去读
 * 真实的 `log/nextjs/`——开发者本机跑过 dev 就"绿"、CI 上就"红"，
 * 表现为一条与环境耦合、结论不可信的 flaky（ISSUE #436）。
 * 与转录自身的用例（`capture-streams.server.test.ts`）保持同一口径。 */
const nextjsLogDir = path.join(tmp, "nextjs");
const panelLogFile = path.join(nextjsLogDir, "nextjs-panel-test.log");

/* 壳侧两路的路径同样落到临时目录：`launchPaths` 是它们的事实来源（与 Rust
 * 壳侧契约同源），不 mock 时 `source=shell` / `shell-launch` 会去读检出里
 * 真实的 `log/shell/`、`log/launcher/`——本机绿、CI 红，与上面同一类 flaky。 */
const shellLogFile = path.join(tmp, "shell.log");
const shellLaunchLogFile = path.join(tmp, "shell-launch.log");

vi.mock("~/lib/shell/launch-diagnostics", async () => {
  const actual = await vi.importActual("~/lib/shell/launch-diagnostics");
  return {
    ...(actual as Record<string, unknown>),
    launchPaths: () => ({
      ...(
        actual as { launchPaths: (root: string) => Record<string, unknown> }
      ).launchPaths(tmp),
      shellLog: shellLogFile,
      shellLaunchLog: shellLaunchLogFile,
    }),
  };
});

vi.mock("~/lib/log/log-paths", async () => {
  const actual = await vi.importActual("~/lib/log/log-paths");
  return {
    ...(actual as Record<string, unknown>),
    APP_RUNTIME_LOG: logFile,
    DEV_LAUNCHER_LOG: path.join(tmp, "dev-launcher.log"),
    NEXTJS_LOG_DIR: nextjsLogDir,
    LAUNCHER_SHELL_LOG: path.join(tmp, "dev-launcher-stderr.log"),
    /* 来源表**整体替换**：它在真实模块初始化时就由上面的常量拼好了，只覆盖
     * 常量不会生效（端点读的是表里的值）。漏掉这一条时，`source=app-runtime`
     * 会去读检出里的真实 `log/services/app-runtime.log`，本用例得到空内容——
     * 而「文件不存在时返回空内容」恰好也期望空，于是半数用例静默转红（ISSUE #725）。
     * 与 `sessions/route.test.ts` 保持同一口径。 */
    RUNTIME_LOG_FILES: { "app-runtime": logFile },
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
  const res = await GET(
    new Request(
      `http://localhost/api/logs/current?source=${source}&offset=${offset}`,
    ),
  );
  return (await res.json()) as {
    content: string;
    size: number;
    offset: number;
    sessionStart: number | null;
  };
}

beforeEach(() => {
  fs.writeFileSync(logFile, "", "utf8");
  /* 面板转录目录按用例重建：`source=app` 依赖它存在且含一份 nextjs-panel-* 文件。 */
  fs.rmSync(nextjsLogDir, { recursive: true, force: true });
  fs.mkdirSync(nextjsLogDir, { recursive: true });
  fs.writeFileSync(panelLogFile, "", "utf8");
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
    for (const source of [
      "app-runtime",
      "comfyui-runtime",
      "drizzle-studio-runtime",
      "ollama-runtime",
    ]) {
      const data = await read(source, 0);
      expect(data).toHaveProperty("sessionStart");
    }
  });

  /* ISSUE #262 复审：「启动和启动器日志丢失」的服务端一半。
   *
   * 会话起点取自 dev-launcher.log 的 mtime，而启动器的头几行（python / exe /
   * cwd / 探测 Node）写在它被创建**之前**。若覆盖重建的来源也下发这个起点，
   * 客户端就会把本次启动最早、最该被看到的行当成「上一次运行的残留」丢掉。
   * 因此契约是：**只有跨运行累积的来源带 sessionStart**，其余恒为 null。 */
  it("覆盖重建的来源（launcher / dev-launcher）不下发会话起点", async () => {
    fs.writeFileSync(path.join(tmp, "dev-launcher.log"), "x", "utf8");
    for (const source of ["launcher", "dev-launcher", "dev"]) {
      const data = await read(source, 0);
      expect(data.sessionStart).toBeNull();
    }
  });

  /* 壳侧两路（shell / shell-launch）：双击启动最早的现场只在这两份里。文件虽
   * 追加写累积，但锚点（dev-launcher.log 的 mtime）晚于壳的启动报告——下发
   * 会话起点会把「为什么起不来」的头几行误判成历史裁掉，因此同「覆盖重建」
   * 口径：sessionStart 恒为 null，旧运行的行靠行内时间戳区分。 */
  it("壳侧两路（shell / shell-launch）不下发会话起点，且能读到内容", async () => {
    fs.writeFileSync(
      shellLogFile,
      "[2026-09-30 12:22:25.261] [INFO] 壳诊断行\n",
      "utf8",
    );
    fs.writeFileSync(
      shellLaunchLogFile,
      "[2026-09-30 12:22:25.262] [INFO] === 已把编排器拉起来（双击 app.exe） ===\n",
      "utf8",
    );
    const shell = await read("shell", 0);
    expect(shell.sessionStart).toBeNull();
    expect(shell.content).toContain("壳诊断行");
    const shellLaunch = await read("shell-launch", 0);
    expect(shellLaunch.sessionStart).toBeNull();
    expect(shellLaunch.content).toContain("已把编排器拉起来");
  });

  it("壳侧两路文件不存在时同样回空切片，不抛错", async () => {
    fs.rmSync(shellLogFile, { force: true });
    fs.rmSync(shellLaunchLogFile, { force: true });
    const shell = await read("shell", 0);
    expect(shell.content).toBe("");
    expect(shell.size).toBe(0);
    expect(shell.sessionStart).toBeNull();
  });

  it("跨运行累积的来源仍然下发会话起点（历史行仍要被裁）", async () => {
    fs.writeFileSync(path.join(tmp, "dev-launcher.log"), "x", "utf8");
    writeLines(1);
    const data = await read("app-runtime", 0);
    expect(typeof data.sessionStart).toBe("number");
  });

  it("应用服务转录（source=app）仍下发会话起点", async () => {
    /* 文件名虽按进程命名，但服务端取的是目录里最新的一份：本次进程尚未落盘时
     * 会读到上一个进程的文件。裁掉它的历史行（早于本次启动）是有意行为。
     * 转录目录已由 beforeEach 备好（见文件头 mock 块），这里只需锚点存在。 */
    fs.writeFileSync(path.join(tmp, "dev-launcher.log"), "x", "utf8");
    fs.appendFileSync(panelLogFile, "[2026-09-11 15:00:00.000] [INFO] x\n");
    const data = await read("app", 0);
    expect(typeof data.sessionStart).toBe("number");
    /* 顺带钉住「确实读到了转录文件」：目录缺失时会退化成空切片，
     * 那样 sessionStart 恒为 null——正是这条用例此前在 CI 上失败的形态。 */
    expect(data.content).toContain("[INFO] x");
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

/* ── 服务端进程标识（ISSUE #360）──────────────────────────────
 * 面板此前无从判断「响应来自哪个应用服务进程」：应用服务重启前后，用户既看不到
 * 重启这件事，也说不出自己连的是哪个进程。这里把两条契约钉住：
 *   1. 每个响应都带 `bootId`（同一进程内恒定）；
 *   2. 客户端带上一轮的 bootId 时，若与当前不一致即标 `mismatch`，且**从头上读**
 *      （不能拿旧进程的游标去切新文件）。
 */
describe("GET /api/logs/current — 服务端进程标识", () => {
  async function readWithBoot(source: string, offset: number, bootId?: string) {
    const query = new URLSearchParams({ source, offset: String(offset) });
    if (bootId !== undefined) query.set("bootId", bootId);
    const res = await GET(
      new Request(`http://localhost/api/logs/current?${query.toString()}`),
    );
    return (await res.json()) as {
      content: string;
      size: number;
      offset: number;
      bootId?: string;
      mismatch?: boolean;
    };
  }

  it("每个响应都带 bootId，且同一进程内恒定", async () => {
    writeLines(3);
    const a = await readWithBoot("app-runtime", 0);
    const b = await readWithBoot("app-runtime", a.size);
    expect(a.bootId).toBeTruthy();
    expect(a.bootId).toBe(b.bootId);
    // 未带客户端标识时不存在「不一致」
    expect(a.mismatch).toBe(false);
  });

  it("客户端标识与当前进程一致 → 正常增量（不重读）", async () => {
    writeLines(3);
    const first = await readWithBoot("app-runtime", 0);
    writeLines(2, 100);
    const second = await readWithBoot("app-runtime", first.size, first.bootId);
    expect(second.mismatch).toBe(false);
    expect(second.content).toContain("任务里程碑 100");
    // 增量：不该把前 3 行再读一次
    expect(second.content).not.toContain("任务里程碑 0");
  });

  it("客户端标识与当前进程不一致 → mismatch 且从头上读", async () => {
    writeLines(3);
    const data = await readWithBoot("app-runtime", 999, "dev-boot:旧进程:1");
    expect(data.mismatch).toBe(true);
    // 从头上读：旧进程的游标不能用来切本次同名的文件
    expect(data.offset).toBe(0);
    expect(data.content.split("\n").filter(Boolean)).toHaveLength(3);
  });
});
