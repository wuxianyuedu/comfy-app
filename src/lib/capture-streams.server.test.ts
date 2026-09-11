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

const tmp = fs.mkdtempSync(
  `${process.env.TMPDIR ?? "/tmp"}/capture-streams-`,
);

vi.mock("@/lib/log-paths", async () => {
  const actual = await vi.importActual("@/lib/log-paths");
  return {
    ...(actual as Record<string, unknown>),
    NEXTJS_LOG_DIR: tmp,
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
