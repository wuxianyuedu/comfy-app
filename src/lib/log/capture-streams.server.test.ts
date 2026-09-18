/**
 * 应用服务输出转录（ISSUE #360）的契约测试。
 *
 * 背景：首屏编译错误、Turbopack FATAL、未捕获的服务端异常此前只落在
 * `log/nextjs/nextjs-stderr-*.log`，而「应用日志」面板不读它——应用服务起不来时
 * 面板一片空白，比没有面板更难排查。本模块把 stdout / stderr 额外转录一份到
 * `log/nextjs/nextjs-panel-<boot>.log`，面板经 `source=app` 轮询它。
 *
 * 钉住三条契约：
 *   1. 转录文件落在 log/nextjs/ 下且带 nextjs-panel- 前缀（与 dev-launcher 的
 *      清理规则同口径）；
 *   2. 写入 stdout / stderr 的内容会出现在该文件里；
 *   3. **原输出行为不变**——转录是额外落一份，不是接管输出。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* 临时目录必须与实现同源构造：实现用 path.join(NEXTJS_LOG_DIR, …)（Windows 拼
 * 反斜杠），若这里用 `/tmp` 这类 POSIX 字符串当 mock 目录，startsWith 前缀比对
 * 必因分隔符不一致而假失败。os.tmpdir() + realpath 归一化后两边同为真实绝对路径。 */
const tmp = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "capture-streams-")),
);

vi.mock("~/lib/log/log-paths", async () => {
  const actual = await vi.importActual("~/lib/log/log-paths");
  return {
    ...(actual as Record<string, unknown>),
    NEXTJS_LOG_DIR: tmp,
    /* 同时把 app-runtime.log 也指到临时目录：installStreamCapture 会往它写一条
     * 会话边界横幅（ISSUE #592），不 mock 就会往仓库真实的 log/services/ 写字
     * （硬规则：测试必须给自己的临时目录）。 */
    APP_RUNTIME_LOG: path.join(tmp, "app-runtime.log"),
  };
});

/** 每个用例都在独立的模块实例上测：install 是模块级幂等的。 */
async function freshInstall() {
  vi.resetModules();
  const mod = await import("./capture-streams.server");
  mod.installStreamCapture();
  return mod;
}

function readCapture(path: string): string {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

let originalStdoutWrite: typeof process.stdout.write;
let originalStderrWrite: typeof process.stderr.write;

beforeEach(() => {
  originalStdoutWrite = process.stdout.write.bind(process.stdout);
  originalStderrWrite = process.stderr.write.bind(process.stderr);
});

afterEach(() => {
  // 还原流，避免污染后续用例（vitest 里 process.stdout 是全局单例）
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
  for (const name of fs.readdirSync(tmp)) {
    fs.rmSync(`${tmp}/${name}`, { force: true });
  }
});

describe("installStreamCapture", () => {
  it("转录文件落在 log/nextjs/ 且带 nextjs-panel- 前缀", async () => {
    const mod = await freshInstall();
    const file = mod.panelCaptureLogPath();
    expect(file.startsWith(tmp)).toBe(true);
    expect(file).toContain("nextjs-panel-");
    expect(file.endsWith(".log")).toBe(true);
  });

  it("stdout / stderr 的内容都会出现在转录文件里", async () => {
    const mod = await freshInstall();
    const file = mod.panelCaptureLogPath();

    process.stdout.write("首屏编译错误：Module not found\n");
    process.stderr.write("FATAL: An unexpected Turbopack error occurred\n");

    const text = readCapture(file);
    expect(text).toContain("首屏编译错误：Module not found");
    expect(text).toContain("FATAL: An unexpected Turbopack error occurred");
  });

  it("每次安装都会往 app-runtime.log 写一条会话边界横幅（两侧留空行）", async () => {
    await freshInstall();
    const text = readCapture(path.join(tmp, "app-runtime.log"));
    /* 横幅本体：box 字符分隔线 + 会话说明；两侧各留一个空行（ISSUE #592：
     * 「一个文件记录多次日志，每次启动之间需要行空白」）。 */
    expect(text).toContain("─".repeat(72));
    expect(text).toContain("应用运行日志（本次运行）");
    const lines = text.split("\n");
    const titleAt = lines.findIndex((l) => l.includes("应用运行日志"));
    expect(titleAt).toBeGreaterThan(0);
    expect(lines[titleAt - 1]).toContain("─");
    expect(lines[titleAt - 2]).toBe(""); // 横幅上方的空行
    // 横幅以空行收口，下一次 append 的内容不会粘在分隔线上
    expect(text.endsWith("─\x1b[0m\n\n")).toBe(true);
  });

  it("原输出行为不变（转录是额外落一份，不接管）", async () => {
    const writes: string[] = [];
    process.stdout.write = (chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    };

    const mod = await freshInstall();
    process.stdout.write("业务输出");

    // 原实现仍被调用
    expect(writes.join("")).toContain("业务输出");
    // 同时落了盘
    expect(readCapture(mod.panelCaptureLogPath())).toContain("业务输出");
  });
});
