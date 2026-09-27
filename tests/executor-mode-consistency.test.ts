/**
 * `COMFY_EXECUTOR` 判据的跨宿主一致性门禁（P3 §5 ADR §14 D5 · Phase 4-A4）。
 *
 * 为什么需要它：同一个开关此前有三处各自实现（Next 侧 TS、launcher、executor-host
 * 脚本）。前两份规则一致，host 那份**漏了 `trim()` 与 `.env` 回读**，于是：
 *   · `COMFY_EXECUTOR=" host "` → Next 把行写成 `claimedBy='host'`、host 起着骨架
 *     ⇒ 任务永远停在队列里等回收器判失败，界面上看不出为什么；
 *   · 只在 `.env` 里写开关 + 手工起 host → 同样静默跑成骨架。
 * 这类漂移没有任何既有用例能发现（各测各的），所以本文件把「三处同值」变成可失败
 * 断言，形态沿用 `tests/app-port-cross-language.test.ts`：**一份共享向量 + 两侧真跑**。
 *
 * 为什么两侧不能合成一份：跨层共享要么给 launcher（纯 Node、且它拉起的正是 tsx
 * 本身）引入 TS 运行时，要么让 `src/lib` 去 import `scripts/`（撞 §18.4 分层与
 * scanner 判据）。因此**同一层内**（launcher 与 host 两个纯 Node 宿主）收成一份
 * `scripts/launcher-core/executor-mode.mjs`，跨层那份（TS）留在原处，由本文件比对。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock("~/lib/core/logger", () => ({
  logger: { warn: warnMock, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  EXECUTOR_ENV_KEY,
  normalizeExecutorMode,
  resolveExecutorMode,
} from "../scripts/launcher-core/executor-mode.mjs";
import { RUNTIME_SCRIPTS } from "../scripts/standalone-private-inputs.mjs";
import { resolveExecutorClaim } from "~/lib/comfyui/executor-mode";

const ROOT = process.cwd();
const VECTORS_FILE = "tests/fixtures/executor-mode-vectors.json";
/** 判据的纯 Node 实现与它的两个使用方。 */
const LAUNCHER = path.join(ROOT, "scripts", "dev-launcher.mjs");
const HOST = path.join(ROOT, "scripts", "executor-host.mjs");
const TS_SIDE = path.join(ROOT, "src", "lib", "comfyui", "executor-mode.ts");

const vectors = (
  JSON.parse(fs.readFileSync(path.join(ROOT, VECTORS_FILE), "utf8")) as {
    vectors: Array<{ raw: string; mode: string; unknown: string | null }>;
  }
).vectors;

const original = process.env[EXECUTOR_ENV_KEY];
const tmpDirs: string[] = [];

/** 去注释后再比对：下面几条判据针对的是**代码**，而注释里正当会出现
 *  「漏了 `trim()`」这类叙述（解释为什么要收口），拿原文去匹配会自打自。
 *  块注释整段去掉；行注释只去「整行都是注释」的，避免误伤 `http://` 之类字符串。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function tempEnvFile(lines: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-mode-"));
  tmpDirs.push(dir);
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

beforeAll(() => {
  expect(vectors.length, "共享向量不能为空").toBeGreaterThan(0);
});

afterEach(() => {
  delete process.env[EXECUTOR_ENV_KEY];
  warnMock.mockClear();
});

afterAll(() => {
  if (original !== undefined) process.env[EXECUTOR_ENV_KEY] = original;
  for (const dir of tmpDirs) fs.rmSync(dir, { force: true, recursive: true });
});

describe("两侧对同一组向量给出同一判决", () => {
  it.each(vectors.map((v) => [v.raw, v.mode]))(
    "COMFY_EXECUTOR=%j → 两侧同为 %s",
    (raw, mode) => {
      const node = normalizeExecutorMode(raw);
      process.env[EXECUTOR_ENV_KEY] = raw;
      expect(resolveExecutorClaim()).toBe(node.mode);
      expect(node.mode).toBe(mode);
    },
  );

  it("未设该 key 时两侧都按 inline（且都不算「未知值」）", () => {
    const node = normalizeExecutorMode(undefined);
    expect(node).toEqual({ mode: "inline", unknown: null });
    expect(resolveExecutorClaim()).toBe("inline");
  });

  it("未知值：判决按 inline，但原值要回给调用方去提示（两侧都不静默）", async () => {
    const node = normalizeExecutorMode(" HOST2 ");
    expect(node.mode).toBe("inline");
    expect(node.unknown).toBe("host2");

    /* TS 侧的提示是 **warn-once**（模块级标志，防刷屏）：上面的向量组里已经
     * 有未知值触发过它，所以这里必须重取一份新模块实例，否则断的是「上一次
     * 用过一次」而不是「这一条也提示」。 */
    vi.resetModules();
    const fresh = await import("~/lib/comfyui/executor-mode");
    warnMock.mockClear();
    process.env[EXECUTOR_ENV_KEY] = " HOST2 ";
    expect(fresh.resolveExecutorClaim()).toBe("inline");
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(String(warnMock.mock.calls[0]?.[0])).toContain("不识别");
  });
});

describe("`.env` 回读这一层只在纯 Node 侧存在，且真的回读", () => {
  it("进程 env 没给该 key → 回读 .env（这是「手工起 host 只改 .env」能成立的前提）", () => {
    const file = tempEnvFile([`${EXECUTOR_ENV_KEY}="host"`]);
    expect(
      resolveExecutorMode({ procEnv: {}, envFilePath: file }),
    ).toMatchObject({ mode: "host" });
  });

  it("进程 env 显式给了空值 → 视为「我要关掉」，不被 .env 顶掉（与 @next/env 同形）", () => {
    const file = tempEnvFile([`${EXECUTOR_ENV_KEY}=host`]);
    expect(
      resolveExecutorMode({
        procEnv: { [EXECUTOR_ENV_KEY]: "" },
        envFilePath: file,
      }),
    ).toMatchObject({ mode: "inline" });
  });

  it("读不到 .env 不致命：按未设处理", () => {
    expect(
      resolveExecutorMode({
        procEnv: {},
        envFilePath: path.join(ROOT, "tmp", "definitely-missing.env"),
      }),
    ).toMatchObject({ mode: "inline", unknown: null });
  });
});

describe("两个纯 Node 宿主不许再各写一份归一化", () => {
  for (const [label, file] of [
    ["dev-launcher.mjs", LAUNCHER],
    ["executor-host.mjs", HOST],
  ] as const) {
    const src = fs.readFileSync(file, "utf8");

    it(`${label} 读同一份 launcher-core/executor-mode.mjs`, () => {
      expect(src).toContain("launcher-core/executor-mode.mjs");
      expect(src).toMatch(/resolveExecutorMode\(/);
    });

    it(`${label} 里没有第二份 trim/小写归一化（漂移就是这么来的）`, () => {
      const code = stripComments(src);
      expect(code).not.toMatch(
        new RegExp(`${EXECUTOR_ENV_KEY}[^\\n]*(toLowerCase|trim\\(\\))`),
      );
      expect(code).not.toMatch(
        new RegExp(`process\\.env\\.${EXECUTOR_ENV_KEY}\\s*\\?\\?`),
      );
    });

    it(`${label} 对未知值留一行可见提示`, () => {
      expect(src).toContain("不识别");
    });
  }

  it("TS 侧那份不许反向依赖 scripts/（跨层共享的代价，写在文件头）", () => {
    const ts = stripComments(fs.readFileSync(TS_SIDE, "utf8"));
    expect(ts).toContain(`process.env.${EXECUTOR_ENV_KEY}`);
    // 只看代码：它的文件头注释里正该出现那份纯 Node 实现的路径（解释为什么两份）
    expect(fs.readFileSync(TS_SIDE, "utf8")).toContain("launcher-core");
    expect(ts).not.toContain("launcher-core");
  });

  it("共享向量文件两侧都引用得到（防止有人把断言改成写死值）", () => {
    expect(fs.existsSync(path.join(ROOT, VECTORS_FILE))).toBe(true);
  });
});

describe("产物白名单登记（缺一份就是桌包里 host 静默跑骨架）", () => {
  it("RUNTIME_SCRIPTS 含 launcher-core/executor-mode.mjs", () => {
    expect(RUNTIME_SCRIPTS).toContain("launcher-core/executor-mode.mjs");
  });
});
