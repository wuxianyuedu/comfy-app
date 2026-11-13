/**
 * 「按 `COMFY_EXECUTOR` 拉起执行器宿主」判据（#1767）：host 行写 `claimedBy='host'`，只有宿主会领它（inline 回收器不跨片误杀 #1204），
 * 所以入口忘起宿主即「任务永远停在队列、无失败出口」；`pnpm start` 是 Playwright CI webServer，现场两条 @critical 各超时 60s。
 * 钉共用件判决（缺件不退回 inline、env 归一化回写）与四个入口接线（读源码：缺陷就是「入口少了这一步」，`dev.mjs` 随 #1767 后续补收）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXECUTOR_HOST_LOG_KEEP,
  EXECUTOR_HOST_LOG_PREFIXES,
  EXECUTOR_HOST_SCRIPT,
  maybeSpawnExecutorHost,
  planExecutorHostSpawn,
} from "../scripts/launcher-core/executor-host-spawn.mjs";
import { resolveSpawnTarget } from "../scripts/launcher-core/shell.mjs";
import { launcherChainSource } from "./helpers/launcher-source";
import { stripComments } from "./helpers/strip-comments";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/** 用例自己造的「项目根」：只放宿主入口，日志因此落它自己的 tmpdir 下。 */
const tmpRoots: Array<string> = [];
function mkRoot({ withHost = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "executor-host-spawn-"));
  tmpRoots.push(root);
  if (withHost) {
    const script = path.join(root, EXECUTOR_HOST_SCRIPT);
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, "// 假入口：起进程的判据不需要它真跑\n");
  }
  return root;
}

afterEach(() => {
  while (tmpRoots.length) {
    const dir = tmpRoots.pop();
    if (dir !== undefined && dir !== "") {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  vi.restoreAllMocks();
});

function readScript(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/** 脚本本体 = 剥掉注释后的文本；`topLevelCallAt` 的锚点也要从这一份上取。 */
function scriptBody(source: string): string {
  return stripComments(source, { trailing: true });
}

/**
 * 找出 `name(` 在顶层真的会被执行的那一处调用的下标（找不到返回 -1）。不用 `indexOf`：字面匹配骗得过
 * `if (false)` / 死分支 / 整段注释三种「没接线」形态。此处先剥注释（`./helpers/strip-comments`），只认行首 `name(`；改
 * 成 `if (false)` 后返回 -1（调用方 expect 当场红）。参数是 `scriptBody()` 的结果：下标属于剥后文本，锚点须同源（#2969）。
 */
function topLevelCallAt(body: string, name: string): number {
  const re = new RegExp(`^[ \t]*${name}\\(`, "m");
  const hit = re.exec(body);
  return hit ? hit.index + hit[0].indexOf(name) : -1;
}

describe("planExecutorHostSpawn：哪些值会起宿主", () => {
  it("显式 host（含大小写与空白）→ 起", () => {
    for (const raw of ["host", "HOST", " host ", "  Host  "]) {
      expect(planExecutorHostSpawn({ env: { COMFY_EXECUTOR: raw } }), raw).toEqual({
        mode: "host",
        unknown: null,
        shouldSpawn: true,
      });
    }
  });

  it("inline / 空值 → 不起（空值是「我要关掉它」，不读回 .env）", () => {
    for (const raw of ["inline", "INLINE", ""]) {
      expect(planExecutorHostSpawn({ env: { COMFY_EXECUTOR: raw } }), JSON.stringify(raw)).toEqual({
        mode: "inline",
        unknown: null,
        shouldSpawn: false,
      });
    }
  });

  it("认不出的值 → 不猜意图：不起宿主，但把原值回给调用方去提示", () => {
    expect(planExecutorHostSpawn({ env: { COMFY_EXECUTOR: "deamon" } })).toEqual({
      mode: "inline",
      unknown: "deamon",
      shouldSpawn: false,
    });
  });
});

describe("maybeSpawnExecutorHost：不起 / 起不来都不抛", () => {
  it("inline 时不起进程，返回 null（根目录里连宿主入口都没有）", () => {
    const root = mkRoot({ withHost: false });
    const lines: Array<string> = [];
    const result = maybeSpawnExecutorHost({
      root,
      runTimestamp: "t",
      env: { COMFY_EXECUTOR: "" },
      logLine: (m) => lines.push(m),
    });
    expect(result).toBeNull();
    // inline 是正常路径，不该有任何警告。
    expect(lines.join("\n")).not.toContain("✗");
  });

  it("root 不是规范化的绝对路径：显式报一批、不起进程（ISSUE #3327）", () => {
    const lines: Array<string> = [];
    const result = maybeSpawnExecutorHost({
      root: "relative-root",
      runTimestamp: "t",
      env: { COMFY_EXECUTOR: "host" },
      logLine: (m) => lines.push(m),
    });
    expect(result).toBeNull();
    const text = lines.join("\n");
    expect(text).toContain("✗ 拒绝拉起执行器宿主");
    expect(text).toContain("必须是绝对路径");
  });

  it("设了 host 但入口不在：不退回 inline，并说清后果", () => {
    const root = mkRoot({ withHost: false });
    const lines: Array<string> = [];
    const result = maybeSpawnExecutorHost({
      root,
      runTimestamp: "t",
      env: { COMFY_EXECUTOR: "host" },
      logLine: (m) => lines.push(m),
    });
    expect(result).toBeNull();
    const text = lines.join("\n");
    expect(text).toContain(EXECUTOR_HOST_SCRIPT);
    /* 「不退回 inline」是承重的：退回会让已经写成 host 归属的行连「谁该来领」
     * 这个线索都消失。 */
    expect(text).toContain("不退回 inline");
  });

  it("认不出的值留一行可见提示（硬规则 4）", () => {
    const root = mkRoot();
    const lines: Array<string> = [];
    maybeSpawnExecutorHost({
      root,
      runTimestamp: "t",
      env: { COMFY_EXECUTOR: "deamon" },
      logLine: (m) => lines.push(m),
    });
    expect(lines.join("\n")).toContain("deamon");
  });

  it("host 模式下起进程：args 指宿主入口、env 显式回写归一化值、日志按次命名", async () => {
    const root = mkRoot();
    /** 起进程的那一步换成假实现：本判据要的是**传了什么**，不该真拉一个宿主。
     *  入参标上类型，复核走类型化 calls（B5 清账，不走 `as` 断言）。 */
    const spawnInGroup = vi.fn(
      (_options: {
        args: Array<string>;
        command: string;
        cwd: string;
        env: Record<string, string>;
        platform: string;
      }): { pid: number } => ({ pid: 4242 }),
    );
    vi.resetModules();
    /* 只替换「拉起」这一步；入口判据（resolveSpawnTarget）用真实现，
     * 否则本用例验证的就不是接线后的形态（ISSUE #3327）。 */
    vi.doMock("../scripts/launcher-core/shell.mjs", () => ({ spawnInGroup, resolveSpawnTarget }));
    try {
      const mod = await import("../scripts/launcher-core/executor-host-spawn.mjs");
      const result = mod.maybeSpawnExecutorHost({
        root,
        runTimestamp: "2026-01-01-00-00-00",
        env: { COMFY_EXECUTOR: " HOST " },
        logLine: () => undefined,
      });

      expect(spawnInGroup).toHaveBeenCalledTimes(1);
      const call = spawnInGroup.mock.calls[0]?.[0];
      if (call === undefined) {
        throw new Error("spawnInGroup 没拿到调用入参");
      }
      expect(call.command).toBe(process.execPath);
      /* 参数数组只放**写死的相对入口**，根在 cwd 里（ISSUE #3327：注入面收窄）。
       * 断言意图不变：拼起来仍必须正好是 root 下的宿主入口。 */
      expect(call.args).toEqual([EXECUTOR_HOST_SCRIPT]);
      expect(path.join(call.cwd, call.args[0] ?? "")).toBe(path.join(root, EXECUTOR_HOST_SCRIPT));
      expect(call.cwd).toBe(root);
      /* 归一化后的值必须**显式**传下去：`.env` 来源时它不在 `process.env` 里，
       * 不传就是「调用方认为 host、宿主起着骨架」的静默错配（ADR §14 D5）。 */
      expect(call.env.COMFY_EXECUTOR).toBe("host");
      expect(call.env.COMFYAPP_HOST_BOOT_ID).toBe("2026-01-01-00-00-00");
      expect(result?.child).toEqual({ pid: 4242 });
      expect(result?.stdoutFile).toBe(
        path.join(
          root,
          "log",
          "current",
          "services",
          "executor-host-stdout-2026-01-01-00-00-00.log",
        ),
      );
      expect(result?.stderrFile).toContain("executor-host-stderr-2026-01-01-00-00-00.log");
      expect(EXECUTOR_HOST_LOG_PREFIXES).toEqual([
        "executor-host-stdout-",
        "executor-host-stderr-",
      ]);
      expect(EXECUTOR_HOST_LOG_KEEP).toBe(5);
    } finally {
      vi.doUnmock("../scripts/launcher-core/shell.mjs");
    }
  });
});

describe("四个启动入口都接线（回归到「没人起宿主」的那道闸）", () => {
  it("scripts/dev.mjs 调用了共用件，且排在起 Next 之前（`pnpm dev` / `tauri dev` 的入口）", () => {
    const source = readScript("scripts/dev.mjs");
    const body = scriptBody(source);
    const callAt = topLevelCallAt(body, "maybeSpawnExecutorHost");
    /* 锚在**起 Next 的那一次 spawnSync** 上（与 start.mjs 同口径）：`nextArgs`
     * 的参数里也有 "next"/"dev" 字面量，用它当锚会把手上的位置判反。锚点与 `callAt`
     * 必须取自**同一份**剥后文本，否则比的是两个下标空间。 */
    const nextAt = body.indexOf("spawnSync(invocation.command, invocation.args");
    expect(callAt).toBeGreaterThan(-1);
    expect(nextAt).toBeGreaterThan(-1);
    expect(callAt).toBeLessThan(nextAt);
    /* 本脚本被两个入口复用：`pnpm dev` 与 `tauri.conf.json` 的 beforeDevCommand。
     * 后者是「壳在跑、开发者在敲代码」的常驻形态，任务行卡队列的现场最长。 */
    expect(source).toContain("executor-host-spawn.mjs");
  });

  it("scripts/start.mjs 调用了共用件，且排在起 Next 之前", () => {
    const source = readScript("scripts/start.mjs");
    const body = scriptBody(source);
    const callAt = topLevelCallAt(body, "maybeSpawnExecutorHost");
    /* 锚在**起 Next 的那一次 spawnSync** 上：`pnpmInvocation([...])` 的参数里
     * 也有 "next"/"start" 两个字面量，用它当锚会把手上的位置判反。锚点与 `callAt`
     * 同样取自那份剥后文本（现在由 `body` 显式给出）。 */
    const nextAt = body.indexOf("spawnSync(invocation.command, invocation.args");
    expect(callAt).toBeGreaterThan(-1);
    expect(nextAt).toBeGreaterThan(-1);
    expect(callAt).toBeLessThan(nextAt);
  });

  it("scripts/dev-launcher.mjs 的 spawnExecutorHost 只是薄包装，判据在共用件", () => {
    /* 断的是**编排链路**（主文件 + `launcher-core/**`）而不是单份主文件：
     * R5 拆分后「入口那一层转发、实现住 `downstream.mjs`」才是形态，
     * 只读主文件时 `maybeSpawnExecutorHost` 在这两处分散着、断言看不出全貌。 */
    const source = launcherChainSource();
    expect(source).toContain("maybeSpawnExecutorHost");
    /* **入口那一层**不许再拼一次 spawnInGroup：两份实现并存就是本判据要防的
     * 形态（改成「两边一起改」靠的是纪律，不是机制）。实现那一份里出现
     * `spawnInGroup` 是正当的（它就是共用件），所以只断入口这一段。 */
    const entry = readScript("scripts/dev-launcher.mjs");
    const fnAt = entry.indexOf("export function spawnExecutorHost(");
    expect(fnAt, "入口里找不到 spawnExecutorHost（拆分后别断了接线）").toBeGreaterThan(-1);
    const body = entry.slice(fnAt, fnAt + 600);
    expect(body).not.toContain("spawnInGroup");
    expect(body).toContain("downstreamSpawnExecutorHost(");
  });

  it("scripts/standalone-runtime.mjs 保留自己那一档（形态不同，登记为已知差异）", () => {
    /* 桌包链的 env 复用外壳装配结果、日志落在载荷根，与两条检出路径形态不同；
     * 它的存在只需被看见，不在本判据里强行合并。 */
    expect(readScript("scripts/standalone-runtime.mjs")).toContain(
      "spawnExecutorHost(childEnv, stamp, APP_DATA_DIR)",
    );
  });
});
