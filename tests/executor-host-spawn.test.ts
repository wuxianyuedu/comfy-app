/**
 * 「按 `COMFY_EXECUTOR` 拉起执行器宿主」这一格的判据（ISSUE #1767）。
 *
 * ## 它守的是什么
 *
 * host 模式下行被写成 `claimedBy='host'`，而**只有宿主**会去领它（inline 那侧的
 * 回收器刻意不跨片误杀，ISSUE #1204）。于是「某个启动入口忘了起宿主」的现场是
 * 「任务永远停在队列、没有任何失败出口」—— 而它此前只在 `dev-launcher.mjs` 的
 * 编排 6.5 步里有执行者：`dev.mjs` 那一格被写进了 §5 排障表（靠人读文档），
 * `scripts/start.mjs` 那一格**连文档都没有**。
 *
 * 代价在本 ISSUE 里量出来了：Playwright 的 CI 档（`CI=1`）webServer 跑的就是
 * `pnpm start`，于是本机 `.env` 写着 host 的开发者会看到两条 `@critical` 主链路
 * 用例各超时 60s 全红，报错话术却是「下游替身没应答」—— 真因在另一个进程里。
 *
 * 因此本文件钉两件事：
 *   ① 共用件的判决（哪些值会起、认不出的值怎么办、入口缺件时不退回 inline、
 *      起进程时 env 有没有显式回写归一化值）；
 *   ② **四个启动入口都接线了**，且 `dev.mjs` / `start.mjs` 那两次调用排在起
 *      Next 之前。第 ② 条读源码而不是起进程：那次缺陷的全部内容就是「入口少了
 *      这一步」，只有源码级断言语义对得上（起进程的判据必须真配一个 host 才能
 *      观察到差别，而那取决于当前 `.env`）。
 *
 * `dev.mjs` 这一格是随 ISSUE #1767 的后续一并收的：`pnpm dev` / `tauri dev`
 * （`beforeDevCommand = node scripts/dev.mjs`）都不经编排器的 6.5 步，于是它成了
 * 「三个裸入口里最后一个缺口」——被文档记着的那个「已知未修」。
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
import { launcherChainSource } from "./helpers/launcher-source";

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
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  vi.restoreAllMocks();
});

function readScript(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}

/**
 * 找出 `name(` **在顶层真的会被执行**的那一处调用，返回它的下标（找不到返回 -1）。
 *
 * 为什么不直接 `indexOf("maybeSpawnExecutorHost({")`：那样只能证明**字符串在文件里**，
 * 证不出这一步会跑 —— 把它改成 `if (false) …`、搬进某个永不进入的分支、或整段注释掉，
 * 三种「这一步事实上没接线」的形态都能骗过纯字面匹配。本判据要守的恰恰是「接线与否」，
 * 所以按 TSDoc 意义上的**脚本本体**（`#!` 之后、顶层，注释先剥掉）来判：
 *
 *   · 注释里的字样不算（`/* … *\/` 与行注释都剥）；
 *   · 前面紧跟 `if (false) ` / `void ` 之类改写被视作「不在顶层执行」——这里只认
 *     「行首（可有空白）就是 name(`」，够用且不引入解析器；
 *   · 反向验证：改成 `if (false) …` 后本函数返回 -1，调用方那条 expect 当场红。
 */
function topLevelCallAt(source: string, name: string): number {
  // 先剥块注释与行注释，避免注释里的示例写法被当成真实调用。
  const stripped = source
    .replaceAll(/\/\*[\s\S]*?\*\//g, (m) => m.replaceAll(/[^\n]/g, " "))
    .replaceAll(/\/\/[^\n]*/g, "");
  const re = new RegExp(`^[ \t]*${name}\\(`, "m");
  const hit = re.exec(stripped);
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
    /** 起进程的那一步换成假实现：本判据要的是**传了什么**，不该真拉一个宿主。 */
    const spawnInGroup = vi.fn((_options: unknown): { pid: number } => ({
      pid: 4242,
    }));
    vi.resetModules();
    vi.doMock("../scripts/launcher-core/shell.mjs", () => ({ spawnInGroup }));
    try {
      const mod = await import("../scripts/launcher-core/executor-host-spawn.mjs");
      const result = mod.maybeSpawnExecutorHost({
        root,
        runTimestamp: "2026-01-01-00-00-00",
        env: { COMFY_EXECUTOR: " HOST " },
        logLine: () => undefined,
      });

      expect(spawnInGroup).toHaveBeenCalledTimes(1);
      const call = /* SAFETY: 类型断言已复核 */ spawnInGroup.mock.calls[0]?.[0] as {
        args: Array<string>;
        command: string;
        cwd: string;
        env: Record<string, string>;
        platform: string;
      };
      expect(call.command).toBe(process.execPath);
      expect(call.args).toEqual([path.join(root, EXECUTOR_HOST_SCRIPT)]);
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
    const callAt = topLevelCallAt(source, "maybeSpawnExecutorHost");
    /* 锚在**起 Next 的那一次 spawnSync** 上（与 start.mjs 同口径）：`nextArgs`
     * 的参数里也有 "next"/"dev" 字面量，用它当锚会把手上的位置判反。 */
    const nextAt = source.indexOf("spawnSync(invocation.command, invocation.args");
    expect(callAt).toBeGreaterThan(-1);
    expect(nextAt).toBeGreaterThan(-1);
    expect(callAt).toBeLessThan(nextAt);
    /* 本脚本被两个入口复用：`pnpm dev` 与 `tauri.conf.json` 的 beforeDevCommand。
     * 后者是「壳在跑、开发者在敲代码」的常驻形态，任务行卡队列的现场最长。 */
    expect(source).toContain("executor-host-spawn.mjs");
  });

  it("scripts/start.mjs 调用了共用件，且排在起 Next 之前", () => {
    const source = readScript("scripts/start.mjs");
    const callAt = topLevelCallAt(source, "maybeSpawnExecutorHost");
    /* 锚在**起 Next 的那一次 spawnSync** 上：`pnpmInvocation([...])` 的参数里
     * 也有 "next"/"start" 两个字面量，用它当锚会把手上的位置判反。 */
    const nextAt = source.indexOf("spawnSync(invocation.command, invocation.args");
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
      "spawnExecutorHost(childEnv, stamp)",
    );
  });
});
