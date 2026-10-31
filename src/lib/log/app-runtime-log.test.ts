import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAppRuntimeLogger } from "~/lib/log/app-runtime-log";
import { LAUNCH_STAMP_ENV, parseLaunchStamp, runtimeLogFileName } from "~/lib/log/runtime-log-file";

/**
 * `writerFor()` 那一路只回答「本次运行是哪一份文件」。真 `openRuntimeLogWriter`
 * 会往仓库 `log/current/services/` 建文件（AGENTS：写日志类用例要给自己的临时
 * 目录），而这里要钉的是**选哪一份、开几次**——所以换成探针，落盘仍落在临时目录。
 */
const packProbe = vi.hoisted(() => ({
  openRuntimeLogWriter: vi.fn(),
  pruneRuntimeLogFiles: vi.fn(() => 0),
}));
vi.mock("~/lib/log/runtime-log-pack.server", () => packProbe);

/** 在一个临时目录里跑，避免污染真实 log/ 目录。 */
let tmpDir: string;
let logFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-runtime-log-"));
  logFile = path.join(tmpDir, "app-runtime.log");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("app-runtime-log 行格式", () => {
  it("写出的行符合 [日期时间] [LEVEL] [ns] msg 面板可解析格式", () => {
    const log = createAppRuntimeLogger("task", logFile);
    log.info("任务完成 abc", { outputs: 2 });
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toMatch(
      /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO\] \[task\] 任务完成 abc \{"outputs":2\}\n$/,
    );
  });

  it("warn / error / debug 级别正确写出", () => {
    const log = createAppRuntimeLogger("app", logFile);
    log.warn("w");
    log.error("e");
    log.debug("d");
    const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("[WARN]");
    expect(lines[1]).toContain("[ERROR]");
    expect(lines[2]).toContain("[DEBUG]");
  });

  it("子日志器命名空间拼接为 parent:child", () => {
    const parent = createAppRuntimeLogger("trpc", logFile);
    const child = parent.child("generate");
    child.info("hi");
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("[trpc:generate] hi");
  });

  it("未提供命名空间时不写 [ns] 段", () => {
    const log = createAppRuntimeLogger("", logFile);
    log.info("plain");
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("[INFO] plain");
    expect(content).not.toContain("[INFO] [");
  });

  it("字段序列化追加在消息后", () => {
    const log = createAppRuntimeLogger("app", logFile);
    log.info("gen", { durationMs: 25, type: "mutation" });
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain('"durationMs":25');
    expect(content).toContain('"type":"mutation"');
  });

  it("写入失败不抛异常", () => {
    const log = createAppRuntimeLogger("app", "/nonexistent-dir-x/foo.log");
    expect(() => log.info("boom")).not.toThrow();
  });

  it("字段里有循环引用 ⇒ 整行照写，字段段退化成 <unserializable-fields>", () => {
    /* 这一格的代价是「日志把业务弄挂」：fields 常常是调用方顺手塞进来的对象图
     * （任务上下文、payload），带环并不罕见，而 JSON.stringify 会直接 throw。 */
    const log = createAppRuntimeLogger("app", logFile);
    const cyclic: Record<string, unknown> = { taskId: "t1" };
    cyclic.self = cyclic;
    expect(() => log.info("gen", cyclic)).not.toThrow();
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("[app] gen <unserializable-fields>\n");
    expect(content).not.toContain('"taskId"');
  });

  it("父命名空间为空时，子日志器直接用子段（不留一个空的 `:` 前缀）", () => {
    const child = createAppRuntimeLogger("", logFile).child("solo");
    child.info("hi");
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("[INFO] [solo] hi");
    expect(content).not.toContain("[:]");
  });
});

describe("app-runtime-log 本次运行那一份（不传 file，走 writerFor）", () => {
  const STAMP = "20261011-093612";
  const prevLaunchStamp = process.env[LAUNCH_STAMP_ENV];
  let openedFile: string;

  beforeEach(() => {
    openedFile = path.join(tmpDir, "app-runtime-20261011-093612.log");
    packProbe.openRuntimeLogWriter.mockReset();
    packProbe.pruneRuntimeLogFiles.mockReset();
    packProbe.openRuntimeLogWriter.mockReturnValue({
      file: openedFile,
      write: vi.fn(),
    });
    packProbe.pruneRuntimeLogFiles.mockReturnValue(0);
  });

  afterEach(() => {
    if (prevLaunchStamp === undefined) {
      delete process.env[LAUNCH_STAMP_ENV];
    } else {
      process.env[LAUNCH_STAMP_ENV] = prevLaunchStamp;
    }
  });

  /** 每轮取一份**新模块实例**：`writer` 是模块级单例，不复位就再也测不到「首开」。 */
  async function freshLogger(): Promise<ReturnType<typeof createAppRuntimeLogger>> {
    vi.resetModules();
    const mod = await import("~/lib/log/app-runtime-log");
    return mod.createAppRuntimeLogger("app");
  }

  it("launcher 透传了名字戳 ⇒ 续写 launcher 那一份，且先轮转再开", async () => {
    const at = parseLaunchStamp(STAMP);
    if (!at) {
      throw new Error("夹具：名字戳形态必须可解");
    }
    process.env[LAUNCH_STAMP_ENV] = STAMP;

    const log = await freshLogger();
    log.info("第一行");

    expect(packProbe.pruneRuntimeLogFiles).toHaveBeenCalledTimes(1);
    /* `reuse` 的名字按 `runtimeLogFileName` 现算，不写字符串：两个进程要落在同一份上，
     * 靠的就是这一处与 launcher 那一份同源；写死字符串会在命名规则改动时假绿。 */
    expect(packProbe.openRuntimeLogWriter).toHaveBeenCalledWith("app-runtime", at, undefined, {
      reuse: runtimeLogFileName("app-runtime", at),
    });
    expect(fs.readFileSync(openedFile, "utf-8")).toContain("[INFO] [app] 第一行");
  });

  it("句柄定下来之后不再变：第二次写不重开、也不重跑轮转", async () => {
    process.env[LAUNCH_STAMP_ENV] = STAMP;
    const log = await freshLogger();

    log.info("一");
    log.warn("二");

    expect(packProbe.openRuntimeLogWriter).toHaveBeenCalledTimes(1);
    expect(packProbe.pruneRuntimeLogFiles).toHaveBeenCalledTimes(1);
    const lines = fs.readFileSync(openedFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("[WARN] [app] 二");
  });

  it("读不出名字戳（pnpm dev / 容器 / 测试）⇒ 交回默认时刻，不自己拼一个名字", async () => {
    delete process.env[LAUNCH_STAMP_ENV];
    const log = await freshLogger();

    log.info("非双击链路");

    /* 只给 source：`at` / `dir` / `options` 全部留给 openRuntimeLogWriter 的默认值 ——
     * 自己拼名字的后果是写进一份「谁都认不出、也不在轮转清单里」的文件。 */
    expect(packProbe.openRuntimeLogWriter).toHaveBeenCalledWith("app-runtime");
    expect(fs.readFileSync(openedFile, "utf-8")).toContain("[INFO] [app] 非双击链路");
  });
});
