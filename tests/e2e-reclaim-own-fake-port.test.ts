/**
 * 「上一跑漏下的替身还占着端口」这一格的判据 —— `e2e/support/reclaim-ports.mjs`。
 *
 * 立案现场（`cnb-ooc-1k52laqqh`）：平台上 `E2E 关键流程` 第二次真跑到最后一步时，
 * 日志第一次露出来，红在 Playwright 自己的一句话上：
 *
 *     [e2e-run] 起 Playwright 前：应用端口 空 / 替身端口 有人
 *     Error: http://127.0.0.1:18188/system_stats …（Playwright 报的「已有人应答」）
 *
 * （那句的原文还有后半截，给的是「确认没人跑 / 打开复用」两条出路 —— 本档两条都不采纳。）
 *
 * pre-flight 说的是「起 Playwright 之前就有人」，而 CI 档 `reuseExistingServer`
 * 是 false ⇒ Playwright 直接抛，连会说清「谁在那儿」的 `globalSetup` 都到不了。
 * 占位者是同一台自托管节点上**上一跑漏下的替身**（那一跑 15 分钟前、同一条命令、
 * 同一节点，中间还夹着两条 `cancel` 的构建）。
 *
 * 这一层的判据分三头，缺一条就可能杀错进程：
 *   ① **两条证据都要**：命令行点名本仓替身脚本 **且** 它答出来的 `/system_stats`
 *      是替身的形状。只判一条都会误伤（见下）；
 *   ② **收的是整棵树**（提交给 `killProcessTree` 的唯一出口，AGENTS 硬规则 3），
 *      而不是自己拼一条 `taskkill` / `process.kill`；
 *   ③ **端口空着时不付任何代价**（不起子进程、不 fetch）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  FAKE_SERVER_SCRIPT,
  isFakeServerCmdline,
  pickOwnFakePids,
} from "../e2e/support/preflight-ports.mjs";
import {
  isFakeServerAnswering,
  isAppAnswering,
  pickOwnAppPids,
  reclaimOwnAppPort,
  reclaimOwnFakePort,
} from "../e2e/support/reclaim-ports.mjs";
import { isAppDevServerCmdline } from "../scripts/launcher-core/port-reap.mjs";

/** 一个「命令行点名本仓替身脚本」的假占位者。 */
const OUR_CMDLINE = `node ${FAKE_SERVER_SCRIPT}`;
/** 一个「命令行不像我们」的假占位者。 */
const FOREIGN_CMDLINE = "node some-other-service.js";

describe("替身端口占位者的识别：命令行那一半", () => {
  it("反斜杠与大小写都认（Windows 上是 `node e2e\\support\\…`）", () => {
    expect(isFakeServerCmdline(OUR_CMDLINE)).toBe(true);
    expect(isFakeServerCmdline("node e2e\\support\\fake-comfyui-server.mjs")).toBe(true);
    expect(isFakeServerCmdline("NODE E2E/SUPPORT/FAKE-COMFYUI-SERVER.MJS")).toBe(true);
    expect(isFakeServerCmdline(FOREIGN_CMDLINE)).toBe(false);
    expect(isFakeServerCmdline("")).toBe(false);
    expect(isFakeServerCmdline(/* SAFETY: 类型断言已复核 */ null as unknown as string)).toBe(false);
  });

  it("点名脚本的**文件名片段**才对得上（不是随便一个 node 进程）", () => {
    /* 这一条的代价不对称：判宽了会把别人的 node 进程收掉，判窄了只是退回
     * 「不动它」（那条路的出口是 `describeSlotConflict` 的两条建议）。 */
    expect(isFakeServerCmdline("node scripts/dev.mjs")).toBe(false);
    expect(isFakeServerCmdline("node e2e/support/preflight-python.mjs")).toBe(false);
  });
});

describe("替身端口占位者的识别：两条证据缺一不可", () => {
  it("命令行像 **且** 此刻答出来是替身形状 ⇒ 认成我们自己的", () => {
    const own = pickOwnFakePids([11, 22], {
      cmdlineOf: (pid) => (pid === 11 ? OUR_CMDLINE : FOREIGN_CMDLINE),
      answersFake: () => true,
    });
    expect(own).toEqual([11]);
  });

  it("**命令行**像、可 payload 不像 ⇒ 不收（半死的替身答不出形状，但那是另一件事）", () => {
    expect(
      pickOwnFakePids([11], {
        cmdlineOf: () => OUR_CMDLINE,
        answersFake: () => false,
      }),
    ).toEqual([]);
  });

  it("payload 像我们、可**命令行**不像 ⇒ 也不收（§1.4：拿不准就不动别人的进程）", () => {
    expect(
      pickOwnFakePids([22], {
        cmdlineOf: () => FOREIGN_CMDLINE,
        answersFake: () => true,
      }),
    ).toEqual([]);
  });
});

describe("收的方式与边界", () => {
  it("端口空着 ⇒ 一条进程都不起、也不回收", async () => {
    const listeningPids = vi.fn(async () => []);
    const reap = vi.fn(async () => ({ ok: true }));
    const result = await reclaimOwnFakePort(18188, { listeningPids, reap });
    expect(result).toEqual({ reclaimed: [], foreign: [], free: true });
    expect(reap).not.toHaveBeenCalled();
  });

  it("两条证据都齐 ⇒ 交出那个 PID 回收（**整棵树**走仓里唯一出口）", async () => {
    const reap = vi.fn(async () => ({ ok: true }));
    const result = await reclaimOwnFakePort(18188, {
      listeningPids: async () => [4242],
      readCmdlines: async (pids) => new Map(pids.map((p) => [p, OUR_CMDLINE])),
      answersFake: async () => true,
      reap,
    });
    expect(result.reclaimed).toEqual([4242]);
    expect(result.foreign).toEqual([]);
    /* 契约三条：按 PID 收整棵树、POSIX 上按进程组（`detached`）、强杀。
     * 这条同时钉住「不自己拼 taskkill / process.kill」——本档只调那个唯一出口。 */
    expect(reap).toHaveBeenCalledTimes(1);
    const reaped = /* SAFETY: 类型断言已复核 */ /* SAFETY: 类型断言已复核 */ (
      reap.mock.calls as Array<Array<unknown>>
    )[0]?.[0] as {
      detached: boolean;
      force: boolean;
      pid: number;
    };
    expect(reaped.pid).toBe(4242);
    expect(reaped.force).toBe(true);
  });

  it("认不出的占位者 ⇒ **一个都不收**，但如实报出来是哪几个", async () => {
    const reap = vi.fn(async () => ({ ok: true }));
    const result = await reclaimOwnFakePort(18188, {
      listeningPids: async () => [7],
      readCmdlines: async (pids) => new Map(pids.map((p) => [p, FOREIGN_CMDLINE])),
      answersFake: async () => true,
      reap,
    });
    expect(result).toEqual({ reclaimed: [], foreign: [7], free: false });
    expect(reap).not.toHaveBeenCalled();
  });

  it("命令行走形之后才付那次 `/system_stats` 探测（不相关的占位者不必被 fetch）", async () => {
    const answersFake = vi.fn(async () => true);
    await reclaimOwnFakePort(18188, {
      listeningPids: async () => [1, 2],
      readCmdlines: async () =>
        new Map([
          [1, OUR_CMDLINE],
          [2, FOREIGN_CMDLINE],
        ]),
      answersFake,
      reap: async () => ({ ok: true }),
    });
    expect(answersFake).toHaveBeenCalledTimes(1);
    expect(answersFake).toHaveBeenCalledWith(1);
  });
});

describe("形状判据（`isFakeServerAnswering`）", () => {
  it("答不出 / 不是 JSON / 不是 200 一律算「否」——拿不到就退回不碰", async () => {
    /* 这一条与 `global-setup` 的 `probeFakeComfySlot` 是同一条口径的两面：
     * 「拿不到结论」不等于「那是我们的」，而这一步的代价是**杀进程**，所以
     * 一切拿不准都落到「否」。 */
    const unreachable = await isFakeServerAnswering(1, {
      url: "http://127.0.0.1:1/system_stats",
      timeoutMs: 300,
    });
    expect(unreachable).toBe(false);
  });
});

describe("接线在位：这一步真的挂在起 Playwright 之前（§13.5.12）", () => {
  const run = readFileSync(
    path.join(path.resolve(import.meta.dirname, ".."), "scripts/e2e-run.mjs"),
    "utf8",
  );

  it("`e2e-run.mjs` 在 spawn Playwright **之前**调了它", () => {
    /* 「实现写对了」与「它被接上了」是两个问题（注入面盖不住后者，见规范 §13.5.3.5
     * 那条边界）。这一步的位置只有一个正确取值：Playwright 探测到 URL 已有人应答、
     * 而 CI 档 `reuseExistingServer` 是 false 时**直接抛** —— 收它只能在那之前。 */
    const reclaimAt = run.indexOf("await reclaimOwnFakePort(");
    const spawnAt = run.indexOf("await runChild(invocation)");
    expect(reclaimAt).toBeGreaterThan(-1);
    expect(spawnAt).toBeGreaterThan(-1);
    expect(reclaimAt).toBeLessThan(spawnAt);
  });

  it("只在 CI 档做（本地 `reuseExistingServer` 为真，Playwright 会复用）", () => {
    /* 本地那档刻意留着「复用」这条路（`globalSetup` 会如实说「已在运行（复用）；
     * 它的 history 带着上一轮的产物」）—— 这一步不该把它悄悄改成「杀掉重启」。 */
    const guardAt = run.indexOf("if (env.CI && preflight.fakeOccupied)");
    expect(guardAt).toBeGreaterThan(-1);
  });

  it("收完**重算** pre-flight：带进 globalSetup 的必须是收之后的事实", () => {
    /* 不重算的话，`globalSetup` 会拿着「起之前有人」这条**已经过期**的结论，
     * 把「本轮自己起的替身」说成「复用」。
     *
     * 判据要的是「重算发生在回收之内、编码之前」这个**相对位置**，不是「这两句
     * 都在文件里」—— 后者在删掉重算那一行时照样成立（编码那一句本来还在）。
     * 所以从回收那一句起截一段，在那一段里找重算。 */
    const reclaimAt = run.indexOf("await reclaimOwnFakePort(");
    const encodeAt = run.indexOf("env[E2E_PREFLIGHT_ENV_KEY] = encodePreflight(preflight)");
    expect(reclaimAt).toBeGreaterThan(-1);
    expect(encodeAt).toBeGreaterThan(reclaimAt);
    const between = run.slice(reclaimAt, encodeAt);
    expect(between).toContain("preflight = await runPreflight(");
  });

  it("脚本名那一处与 `playwright.config.ts` 的 webServer command 是同一个", () => {
    /* 两处各写一份就会漂：这边按「命令行点名了哪个脚本」认自己的残留，那边按
     * 同一个名字起服务。漂了的表现是「认不出自己的残留」——而那正是本 ISSUE 的病。 */
    const config = readFileSync(
      path.join(path.resolve(import.meta.dirname, ".."), "playwright.config.ts"),
      "utf8",
    );
    expect(config).toContain(FAKE_SERVER_SCRIPT);
  });
});

/* ── 应用端口那一格（ISSUE #1977 第十三处）────────────────────────────────
 *
 * 替身那一格修好之后，红往左挪到了**应用端口**上：同一条 WebServer 链的第一个
 * 子进程也是 `shell: true` 下面的孙子进程，上一跑被 stage 墙钟 kill 时同样收不到
 * teardown。判据与替身那格同构，但**换两条证据**：
 *
 *   ① 命令行是本检出应用服务的自证（`isAppDevServerCmdline`：含检出根 + 本仓启动脚本）
 *   ② 它此刻答出来的 `/api/health` 是本应用的形状
 *
 * ① 挡「别的程序恰好从检出目录起来」，② 挡「这是另一个检出的应用服务」——
 * `isAppDevServerCmdline` 只认「本仓的应用服务」，**认不出是哪一份检出**。
 */
describe("应用端口占位者的识别：两条证据缺一不可", () => {
  const ROOT = "/repo";
  /** 「本检出应用服务」的假命令行（含检出根 + 本仓启动脚本）。 */
  const OUR_APP = `node /repo/scripts/start.mjs`;
  /** 「别的检出的应用服务」——同样命中 `isAppDevServerCmdline` 的脚本名，
   *  但命令行里的**检出根不是我们的**，所以 ① 就把它挡下了。 */
  const OTHER_CHECKOUT_APP = `node /other-checkout/scripts/start.mjs`;
  /** 与本应用无关的占位者。 */
  const FOREIGN = "node some-other-service.js";

  it("命令行带检出根 + 本仓启动脚本 ⇒ 认（`dev.mjs` 与 `start.mjs` 都认）", () => {
    expect(isAppDevServerCmdline(OUR_APP, ROOT)).toBe(true);
    expect(isAppDevServerCmdline("node /repo/scripts/dev.mjs", ROOT)).toBe(true);
    /* 反斜杠形态在 Windows 上是常见的。 */
    expect(isAppDevServerCmdline("node F:\\repo\\scripts\\start.mjs", "F:/repo")).toBe(true);
  });

  it("**别的检出**的应用服务 ⇒ 不收（命令行里的检出根不是我们的，§1.4）", () => {
    expect(isAppDevServerCmdline(OTHER_CHECKOUT_APP, ROOT)).toBe(false);
  });

  it("命令行像 **且** 此刻答得出 `/api/health` ⇒ 认成我们自己的", () => {
    const own = pickOwnAppPids([11, 22], {
      cmdlineOf: (pid) => (pid === 11 ? OUR_APP : FOREIGN),
      root: ROOT,
      belongsToRoot: () => false,
      answersApp: () => true,
    });
    expect(own).toEqual([11]);
  });

  it("命令行像、可答不出形状 ⇒ 不收（半死的服务由 Playwright 的话术说清）", () => {
    expect(
      pickOwnAppPids([11], {
        cmdlineOf: () => OUR_APP,
        root: ROOT,
        belongsToRoot: () => false,
        answersApp: () => false,
      }),
    ).toEqual([]);
  });

  it("形状像我们、可命令行不像 ⇒ 也不收（拿不准就不动别人的进程）", () => {
    expect(
      pickOwnAppPids([22], {
        cmdlineOf: () => FOREIGN,
        root: ROOT,
        belongsToRoot: () => false,
        answersApp: () => true,
      }),
    ).toEqual([]);
  });

  it("**标题被改写的 `next-server`** ⇒ 命令行认不出，但工作目录在检出根下也认", () => {
    /* 实测逼出来的那一格：Next 会把进程标题改成 `next-server (v16.3.8)`，命令行与
     * `/proc/<pid>/cmdline` 两头都只剩这一串 —— 「含检出根 + 本仓脚本」那条判据对它
     * 自然为假。`pidBelongsToRoot`（工作目录）是它身上唯一还留着的线索。 */
    expect(
      pickOwnAppPids([9], {
        cmdlineOf: () => "next-server (v16.3.8)",
        root: ROOT,
        belongsToRoot: () => true,
        answersApp: () => true,
      }),
    ).toEqual([9]);
    /* 反面：工作目录也不在本检出 ⇒ 仍旧不收。 */
    expect(
      pickOwnAppPids([9], {
        cmdlineOf: () => "next-server (v16.3.8)",
        root: ROOT,
        belongsToRoot: () => false,
        answersApp: () => true,
      }),
    ).toEqual([]);
  });

  it("端口空着 ⇒ 一条进程都不起、也不回收", async () => {
    const reap = vi.fn(async () => ({ ok: true }));
    const result = await reclaimOwnAppPort(3311, ROOT, {
      listeningPids: async () => [],
      reap,
    });
    expect(result).toEqual({ reclaimed: [], foreign: [], free: true });
    expect(reap).not.toHaveBeenCalled();
  });

  it("两条证据都齐 ⇒ 交出那个 PID 回收（整棵树走仓里唯一出口）", async () => {
    const reap = vi.fn(async () => ({ ok: true }));
    const result = await reclaimOwnAppPort(3311, ROOT, {
      listeningPids: async () => [4242],
      readCmdlines: async (pids) => new Map(pids.map((p) => [p, OUR_APP])),
      answersApp: async () => true,
      reap,
    });
    expect(result.reclaimed).toEqual([4242]);
    const reaped = /* SAFETY: 类型断言已复核 */ /* SAFETY: 类型断言已复核 */ (
      reap.mock.calls as Array<Array<unknown>>
    )[0]?.[0] as {
      force: boolean;
      pid: number;
    };
    expect(reaped.pid).toBe(4242);
    expect(reaped.force).toBe(true);
  });

  it("认不出的占位者 ⇒ 一个都不收，但如实报出来是哪几个", async () => {
    const reap = vi.fn(async () => ({ ok: true }));
    const result = await reclaimOwnAppPort(3311, ROOT, {
      listeningPids: async () => [7],
      readCmdlines: async (pids) => new Map(pids.map((p) => [p, FOREIGN])),
      answersApp: async () => true,
      reap,
    });
    expect(result).toEqual({ reclaimed: [], foreign: [7], free: false });
    expect(reap).not.toHaveBeenCalled();
  });

  it("命令行走形之后才付那次 `/api/health` 探测，且它是**端口级**的一次", async () => {
    const answersApp = vi.fn(async () => true);
    await reclaimOwnAppPort(3311, ROOT, {
      listeningPids: async () => [1, 2],
      readCmdlines: async () =>
        new Map([
          [1, OUR_APP],
          [2, FOREIGN],
        ]),
      answersApp,
      reap: async () => ({ ok: true }),
    });
    /* 探一次、入参是**端口** —— 判据问的是「那个口上坐着的是不是一个在应答的
     * 本应用」，而端口上可能同时有好几层进程。 */
    expect(answersApp).toHaveBeenCalledTimes(1);
    expect(answersApp).toHaveBeenCalledWith(3311);
  });

  it("① 一个都没命中 ⇒ **一次 HTTP 都不发**（不相关的占位者不必被 fetch）", async () => {
    const answersApp = vi.fn(async () => true);
    await reclaimOwnAppPort(3311, ROOT, {
      listeningPids: async () => [7],
      readCmdlines: async (pids) => new Map(pids.map((p) => [p, FOREIGN])),
      belongsToRoot: async () => false,
      answersApp,
      reap: async () => ({ ok: true }),
    });
    expect(answersApp).not.toHaveBeenCalled();
  });

  it("答不出 / 不是 JSON / 状态码不对 一律算「否」——拿不到就退回不碰", async () => {
    const unreachable = await isAppAnswering(1, {
      url: "http://127.0.0.1:1",
      timeoutMs: 300,
    });
    expect(unreachable).toBe(false);
  });
});

describe("接线在位：应用端口那一格也挂在起 Playwright 之前（§13.5.12）", () => {
  const run = readFileSync(
    path.join(path.resolve(import.meta.dirname, ".."), "scripts/e2e-run.mjs"),
    "utf8",
  );

  it("`e2e-run.mjs` 在 spawn Playwright **之前**调了 `reclaimOwnAppPort`", () => {
    const reclaimAt = run.indexOf("await reclaimOwnAppPort(");
    const spawnAt = run.indexOf("await runChild(invocation)");
    expect(reclaimAt).toBeGreaterThan(-1);
    expect(spawnAt).toBeGreaterThan(-1);
    expect(reclaimAt).toBeLessThan(spawnAt);
  });

  it("只在 CI 档做", () => {
    expect(run.indexOf("if (env.CI && preflight.appOccupied)")).toBeGreaterThan(-1);
  });

  it("收完**重算** pre-flight（判据是相对位置，不是「两句都在」）", () => {
    const reclaimAt = run.indexOf("await reclaimOwnAppPort(");
    const encodeAt = run.indexOf("env[E2E_PREFLIGHT_ENV_KEY] = encodePreflight(preflight)");
    expect(reclaimAt).toBeGreaterThan(-1);
    expect(encodeAt).toBeGreaterThan(reclaimAt);
    expect(run.slice(reclaimAt, encodeAt)).toContain("preflight = await runPreflight(");
  });
});
