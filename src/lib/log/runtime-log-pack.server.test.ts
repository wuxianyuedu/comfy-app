/**
 * 「一次启动一份文件」的**落盘侧**判据（ISSUE #1326）。
 *
 * 这一层是被四个写方共用的那一处实现（`comfyui/lifecycle`、
 * `drizzle-studio/lifecycle`、两条 ollama 路由、`app-runtime-log`），因此它守的
 * 是三条「漂开就静默出错」的契约：
 *   1. **同秒不覆盖**：启动→秒退→再启动时，第一次的失败现场必须还在；
 *   2. **只列本来源**：一个目录里同时有四个来源的文件，按名字过滤；
 *   3. **保留策略真的删**：一次启动一份之后同一天可能攒几十份，不删会把用户的
 *      磁盘慢慢吃光。
 *
 * 用例全部在自己的临时目录里跑（硬规则 17：测试不许碰仓库的 log/）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  RUNTIME_LOG_KEEP_FILES,
  allocateRuntimeLogFile,
  countRuntimeLogFiles,
  latestRuntimeLogFile,
  listRuntimeLogFiles,
  openRuntimeLogWriter,
  pruneRuntimeLogFiles,
} from "./runtime-log-pack.server";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-log-pack-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const AT = new Date(2026, 9, 5, 9, 36, 12);

describe("分配文件名", () => {
  it("同一秒内多次启动往后排（-2 / -3），**不覆盖**前一次的现场", () => {
    const first = allocateRuntimeLogFile("comfyui-runtime", dir, AT);
    fs.writeFileSync(first, "第一次（秒退）\n");
    const second = allocateRuntimeLogFile("comfyui-runtime", dir, AT);
    fs.writeFileSync(second, "第二次\n");
    const third = allocateRuntimeLogFile("comfyui-runtime", dir, AT);

    expect(path.basename(first)).toBe("comfyui-runtime-20261005-093612.log");
    expect(path.basename(second)).toBe("comfyui-runtime-20261005-093612-2.log");
    expect(path.basename(third)).toBe("comfyui-runtime-20261005-093612-3.log");
    /* 第一次的内容一字未改（这正是这条判据要的） */
    expect(fs.readFileSync(first, "utf8")).toBe("第一次（秒退）\n");
  });

  it("已经是另一刻的文件不参与分叉（下一次启动拿干净的名字）", () => {
    allocateRuntimeLogFile(
      "ollama-runtime",
      dir,
      new Date(2026, 9, 5, 9, 0, 0),
    );
    const next = allocateRuntimeLogFile("ollama-runtime", dir, AT);
    expect(path.basename(next)).toBe("ollama-runtime-20261005-093612.log");
  });
});

describe("开写入器", () => {
  it("建目录、落一行、路径说得出来", () => {
    const nested = path.join(dir, "current", "services");
    const writer = openRuntimeLogWriter("app-runtime", AT, nested);
    writer.write("[2026-10-05 09:36:12] [INFO] [app] 起来了");
    expect(fs.readFileSync(writer.file, "utf8")).toBe(
      "[2026-10-05 09:36:12] [INFO] [app] 起来了\n",
    );
    expect(path.basename(writer.file)).toBe("app-runtime-20261005-093612.log");
  });

  it("两次开出来的写入器指向**不同**的文件（一份文件只属于一次启动）", () => {
    const a = openRuntimeLogWriter("ollama-runtime", AT, dir);
    a.write("A");
    const b = openRuntimeLogWriter("ollama-runtime", AT, dir);
    b.write("B");
    expect(a.file).not.toBe(b.file);
    expect(fs.readFileSync(a.file, "utf8")).toBe("A\n");
    expect(fs.readFileSync(b.file, "utf8")).toBe("B\n");
  });

  it("目录建不出来时静默（日志子系统绝不阻塞业务）", () => {
    /* 用一个「父路径是文件」的落点制造必然的 mkdir 失败。 */
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "x");
    const writer = openRuntimeLogWriter(
      "app-runtime",
      AT,
      path.join(blocker, "services"),
    );
    expect(() => writer.write("不抛")).not.toThrow();
  });
});

describe("列文件", () => {
  it("只列本来源（同一目录里四个来源并存）", async () => {
    fs.writeFileSync(path.join(dir, "comfyui-runtime-20261005-090000.log"), "");
    fs.writeFileSync(path.join(dir, "comfyui-runtime-20261005-093612.log"), "");
    fs.writeFileSync(path.join(dir, "ollama-runtime-20261005-093612.log"), "");
    fs.writeFileSync(path.join(dir, "app-runtime-20261005-093612.log"), "");
    fs.writeFileSync(path.join(dir, "comfyui-keepalive-x.out.log"), "");
    fs.writeFileSync(path.join(dir, "comfyui-trace.log"), "");

    expect(
      (await listRuntimeLogFiles("comfyui-runtime", dir)).map((f) => f.name),
    ).toEqual([
      "comfyui-runtime-20261005-090000.log",
      "comfyui-runtime-20261005-093612.log",
    ]);
  });

  it("旧固定名排在最前（「更早」是对它的定义）", async () => {
    fs.writeFileSync(path.join(dir, "ollama-runtime.log"), "迁移前\n");
    fs.writeFileSync(path.join(dir, "ollama-runtime-20261005-093612.log"), "");
    const names = (await listRuntimeLogFiles("ollama-runtime", dir)).map(
      (f) => f.name,
    );
    expect(names).toEqual([
      "ollama-runtime.log",
      "ollama-runtime-20261005-093612.log",
    ]);
  });

  it("目录不存在时回空（这个服务从没启动过，不是错误）", async () => {
    expect(
      await listRuntimeLogFiles("app-runtime", path.join(dir, "nope")),
    ).toEqual([]);
  });

  it("latest 取最新那一份（写方要跟随的就是它）", async () => {
    fs.writeFileSync(path.join(dir, "app-runtime-20261005-090000.log"), "");
    fs.writeFileSync(path.join(dir, "app-runtime-20261005-093612.log"), "");
    expect((await latestRuntimeLogFile("app-runtime", dir))?.name).toBe(
      "app-runtime-20261005-093612.log",
    );
    expect(await latestRuntimeLogFile("ollama-runtime", dir)).toBeNull();
  });
});

describe("跨进程补齐：续写同一份（launcher 写提醒 → dev server 接着写）", () => {
  it("reuse 给定基名时续写它，**不**按同秒分叉退到 -2", () => {
    /* launcher 在 dev server 就绪之前就把本次启动那一份建好了（并写了预检
     * 提醒）；dev server 的写方接手时，默认路径会看到文件已存在、按「同秒不
     * 覆盖」退到 `-2` —— 一行提醒与整段应用日志分成两份，而面板看起来两边都
     * 正常（用户永远读不到完整的本次启动）。 */
    const name = "app-runtime-20261005-093612.log";
    fs.writeFileSync(path.join(dir, name), "预检提醒\n");

    const w = openRuntimeLogWriter("app-runtime", AT, dir, { reuse: name });
    expect(path.basename(w.file)).toBe(name);
    w.write("应用日志");

    /* 一份文件、两行都在（顺序就是写入顺序）。 */
    expect(fs.readFileSync(w.file, "utf8")).toBe("预检提醒\n应用日志\n");
    expect(countRuntimeLogFiles("app-runtime", dir)).toBe(1);
  });

  it("不给 reuse 时照旧另开一份（既有四份来源的默认行为一字未改）", () => {
    const name = "ollama-runtime-20261005-093612.log";
    fs.writeFileSync(path.join(dir, name), "第一次启动\n");
    const w = openRuntimeLogWriter("ollama-runtime", AT, dir);
    expect(path.basename(w.file)).toBe("ollama-runtime-20261005-093612-2.log");
  });

  it("reuse 的那一份还不在盘上时也照写（目录都没有也能建出来）", () => {
    const name = "app-runtime-20261005-093612.log";
    const fresh = path.join(dir, "nested");
    const w = openRuntimeLogWriter("app-runtime", AT, fresh, { reuse: name });
    w.write("第一行");
    expect(fs.readFileSync(w.file, "utf8")).toBe("第一行\n");
  });
});

describe("保留策略", () => {
  it("每个来源留最近 N 份，超出的删最旧（一次启动一份之后这是必需的）", async () => {
    for (let i = 0; i < RUNTIME_LOG_KEEP_FILES + 5; i += 1) {
      const s = String(i).padStart(2, "0");
      const mm = String(i % 60).padStart(2, "0");
      fs.writeFileSync(
        path.join(dir, `comfyui-runtime-20261005-${s}${mm}00.log`),
        `第 ${i} 份`,
      );
    }
    const removed = pruneRuntimeLogFiles(dir);
    expect(removed).toBe(5);
    expect(countRuntimeLogFiles("comfyui-runtime", dir)).toBe(
      RUNTIME_LOG_KEEP_FILES,
    );
    /* 留下的是**最新**那几份 */
    const left = (await listRuntimeLogFiles("comfyui-runtime", dir)).map(
      (f) => f.name,
    );
    expect(left).not.toContain("comfyui-runtime-20261005-000000.log");
  });

  it("不动别的来源的文件（各来源各留各的）", () => {
    fs.writeFileSync(path.join(dir, "ollama-runtime-20261005-093612.log"), "");
    pruneRuntimeLogFiles(dir);
    expect(
      fs.existsSync(path.join(dir, "ollama-runtime-20261005-093612.log")),
    ).toBe(true);
  });

  it("目录不存在时不抛（启动路径上的清理绝不该把启动弄挂）", () => {
    expect(() => pruneRuntimeLogFiles(path.join(dir, "nope"))).not.toThrow();
  });
});
