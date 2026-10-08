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
    SERVICES_LOG_DIR: tmp,
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

/**
 * 等到某段文本真的落盘再读。
 *
 * 转录走的是 `bufferedAppend`（攒进内存、满 64KB 或最多 1s 一次落盘 —— 高频
 * 日志下每行一次 `appendFileSync` 会把事件循环占满），所以**同步读只能看到安装
 * 时写的横幅**，看不到刚写进 stdout 的那行。轮询到出现为止：正常路径几乎立刻
 * 命中（比固定 sleep 快），超时就原样返回，于是「压根没落盘」仍会被断言读成红，
 * 不会被误当成「再等等就有」。
 */
async function readCaptureWhenFilled(
  filePath: string,
  needle: string,
  timeoutMs = 3_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = readCapture(filePath);
    if (text.includes(needle)) return text;
    if (Date.now() > deadline) return text;
    await new Promise((resolve) => setTimeout(resolve, 25));
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

    const text = await readCaptureWhenFilled(
      file,
      "FATAL: An unexpected Turbopack error occurred",
    );
    expect(text).toContain("首屏编译错误：Module not found");
    expect(text).toContain("FATAL: An unexpected Turbopack error occurred");
  });

  it("转录不再往 app-runtime 写会话横幅（一次启动一份文件之后没有它的位置）", async () => {
    /* 横幅当初存在是为了「一份文件里多次启动的行要能分清边界」（ISSUE #592）。
     * 四份 runtime 日志改成一次启动一份文件之后，边界就是文件名本身，因此这里
     * 不该再产出横幅 —— 产出也没人读（读侧不再按横幅切分），而「没人读的写法」
     * 正是要被清掉的那一类（ISSUE #1326）。
     *
     * 判据落在 `SERVICES_LOG_DIR`（= 本用例的 tmp）下**任何** app-runtime 文件
     * 上：写横幅会写成固定名 `app-runtime.log`，而新的命名规则产出的是
     * `app-runtime-<时刻>.log` —— 两者都不该由本模块产出（它只转录 nextjs
     * 面板那一份）。 */
    await freshInstall();
    expect(
      fs.readdirSync(tmp).filter((n) => n.startsWith("app-runtime")),
    ).toEqual([]);
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
    // 同时落了盘（走缓冲，要等到落盘再读）
    expect(
      await readCaptureWhenFilled(mod.panelCaptureLogPath(), "业务输出"),
    ).toContain("业务输出");
  });
});

/* ISSUE #1365：转录文件的「取最新一份」与「轮转」都曾按**文件名**判断，而文件名
 * 里的 `pid` 是变长十进制——字典序比较的是字符，`…-9876-…` 排在 `…-12345-…`
 * 之后。两个后果各自独立地让「应用服务」这一路变成恒空的来源：
 *
 *   1. 路由取「排序后最后一份」→ 读到某次更早运行的文件，它的行时刻早于本次
 *      会话起点，被 `dropStaleEntries` 整批裁掉；
 *   2. 轮转按 `bootId` 前缀找同族 → `bootId` 每次都不同，前缀只匹配到自己这一份，
 *      于是**一份也删不掉**，陈年文件无限累积（也让第 1 条更容易踩中）。
 */
describe("转录文件的取最新与轮转（ISSUE #1365）", () => {
  /** 往 nextjs 目录写一份指定 pid / mtime 的转录文件。 */
  function writePanel(pid: number, stamp: number, body: string): string {
    fs.mkdirSync(tmp, { recursive: true });
    const file = path.join(tmp, `nextjs-panel-${pid}-${stamp}.log`);
    fs.writeFileSync(file, body, "utf8");
    const at = stamp / 1000;
    fs.utimesSync(file, at, at);
    return file;
  }

  it("latestPanelLogFile 按 mtime 取，不按文件名字典序", async () => {
    const mod = await freshInstall();
    /* pid 更大的那份文件名字典序**更小**（"12345" < "9876"），而它才是最新的：
     * 这正是按名字取最后一份会读错的方向。 */
    const older = writePanel(9876, Date.now() - 60_000, "上一次运行\n");
    const newer = writePanel(12345, Date.now(), "本次运行\n");
    expect(mod.latestPanelLogFile(tmp)).toBe(newer);
    expect(mod.latestPanelLogFile(tmp)).not.toBe(older);
  });

  it("目录不存在时返回 null（不是抛错）", async () => {
    const mod = await freshInstall();
    expect(mod.latestPanelLogFile(path.join(tmp, "no-such-dir"))).toBeNull();
  });

  it("轮转按 mtime 保留最近 5 份，跨 bootId 也算同族", async () => {
    /* 先摆 6 份历史，再安装（安装是模块级幂等的，必须在 install **之前**把夹具
     * 准备好，否则第二次调用直接 return、根本不会走轮转）。6 份的 bootId 各不同
     * ——这正是旧实现的漏洞：按 bootId 前缀找同族只会匹配到自己那一份，一份也
     * 删不掉，陈年文件无限累积。 */
    const now = Date.now();
    for (let i = 0; i < 6; i += 1) {
      writePanel(1000 + i, now - (6 - i) * 10_000, `第 ${i} 次运行\n`);
    }
    await freshInstall();
    const left = fs
      .readdirSync(tmp)
      .filter((n) => n.startsWith("nextjs-panel-"))
      .sort();
    expect(left).toHaveLength(5);
    /* 最老的那份（第 0 次）被删掉，最新的历史（第 5 次）还在。 */
    expect(left.some((n) => n.includes("-1000-"))).toBe(false);
    expect(left.some((n) => n.includes("-1005-"))).toBe(true);
  });
});
