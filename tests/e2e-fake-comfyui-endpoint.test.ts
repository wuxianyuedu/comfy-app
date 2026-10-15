/**
 * 假 ComfyUI 的**端点事实**与「谁在替身端口上」的判决 —— ISSUE #1756。
 *
 * 立案现场：`playwright.config.ts` 把替身钉在 8188（= 产品自己拉起真 ComfyUI 的
 * 固定默认端口），配上本地 `reuseExistingServer: true`，本机一开着真件，
 * Playwright 探测到 200 就**静默复用真件** —— 替身一行没跑，而依赖它脚本化收口的
 * 用例全红，报告读起来像功能红。
 *
 * 这条判据分三头，缺一条这套修法就退化成一句好看的话：
 *   ① **端口真的分开了**：替身端口不在 ComfyUI 的探测窗口里，也不等于默认端口
 *      ——「不必停真件」这句话的机器形态；
 *   ② **形状认得出来**：真件（带 `comfyui_version`）与替身（`ram_total: 1` +
 *      空 `devices`）两个指纹互不误判，且四种观测各归各的判决；
 *   ③ **接线在位**：`playwright.config.ts` / 假服务 / 假 comfy-cli 三处都读同一份
 *      端点事实（哪一处自写一份就会漂），且 globalSetup 真的挂上了。
 */
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  COMFY_BASE_ENV_KEY,
  FAKE_COMFYUI_DEFAULT_PORT,
  FAKE_COMFYUI_HOST,
  FAKE_COMFY_PORT_ENV_KEY,
  assertFakePortOffComfyWindow,
  classifyFakeSlot,
  comfyProbeWindowPorts,
  describeAppReuseConflict,
  describeSlotConflict,
  fakeComfyuiBaseUrl,
  fakeComfyuiEnv,
  fakeComfyuiStatsUrl,
  isFakeComfyuiPayload,
  isRealComfyuiPayload,
  resolveFakeComfyuiPort,
} from "../e2e/support/fake-comfyui-endpoint.mjs";
import { resolvePlaywrightFile } from "../scripts/e2e-run.mjs";
import {
  probeFakeComfySlot,
  readAppServerPreflight,
  readFakeSlotPreflight,
} from "../e2e/global-setup";
import {
  E2E_PREFLIGHT_ENV_KEY,
  decodePreflight,
  encodePreflight,
  probePortOccupied,
  runPreflight,
} from "../e2e/support/preflight-ports.mjs";
import { COMFYUI_DEFAULT_PORT } from "../src/lib/endpoints";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 造一份**只含要测的那几个键**的环境变量片段（`ProcessEnv` 的必填字段不掺进来）。 */
function envWith(entries: Record<string, string>): Record<string, string> {
  return entries;
}

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** 真件的 `/system_stats` 形状（实测自 2026-10-11 的现场记录，见 ISSUE #1756）。 */
const REAL_PAYLOAD = {
  system: {
    os: "win32",
    ram_total: 34204610560,
    ram_free: 7156305920,
    comfyui_version: "0.37.0",
  },
  devices: [],
};

/** 替身的 `/system_stats` 形状（`fake-comfyui-server.mjs`）。 */
const FAKE_PAYLOAD = {
  system: { os: "nt", ram_total: 1, ram_free: 1 },
  devices: [],
};

describe("替身与真件分居两个端口（ISSUE #1756 的修复取向）", () => {
  it("替身端口不等于 ComfyUI 默认端口，也不在它的探测窗口里", () => {
    /* 窗口宽度与 `client.ts` 的 `probeTargets`（`PROBE_RANGE = 5`）同口径：
     * 替身若落进去，`resolveComfyBase()` 的端口探测会把它认成「真件在偏移端口
     * 上」，两个身份就混在一个进程里了。 */
    expect(FAKE_COMFYUI_DEFAULT_PORT).not.toBe(COMFYUI_DEFAULT_PORT);
    const verdict = assertFakePortOffComfyWindow();
    expect(verdict.ok, verdict.reason).toBe(true);
    expect(verdict.distance).toBeGreaterThan(0);
  });

  it("登记的窗口与真源一致：默认端口 + PROBE_RANGE 都从源码复算", () => {
    /* 这条是「别写死两处」的机器形态：窗口数值登记在 `.mjs`（假服务器是纯 Node
     * 入口，不引 TS），真源在 `endpoints.ts` / `client.ts`。两边对不上就红。 */
    const clientSrc = readText("src/lib/comfyui/client.ts");
    const rangeMatch = /const PROBE_RANGE = (\d+);/.exec(clientSrc);
    expect(rangeMatch, "client.ts 里找不到 PROBE_RANGE").not.toBeNull();
    const probeRange = Number(rangeMatch?.[1]);

    const ports = comfyProbeWindowPorts();
    expect(ports).toEqual(
      Array.from(
        { length: probeRange + 1 },
        (_, i) => COMFYUI_DEFAULT_PORT + i,
      ),
    );
    // 替身落在这个窗口之外（两处口径合起来才说明「没混身份」）。
    expect(ports).not.toContain(FAKE_COMFYUI_DEFAULT_PORT);
  });

  it("环境变量能换端口，且换完之后**所有**导出跟着变", () => {
    /* 「换端口」是 `describeSlotConflict` 给出的出口①。它必须真的生效，且是
     * **一处生效、处处生效** —— 应用连的地址与替身监听的地址不能各说一套。 */
    const env = envWith({ [FAKE_COMFY_PORT_ENV_KEY]: "18999" });
    expect(resolveFakeComfyuiPort(env)).toBe(18999);
    expect(fakeComfyuiBaseUrl({ env })).toBe(
      `http://${FAKE_COMFYUI_HOST}:18999`,
    );
    expect(fakeComfyuiStatsUrl({ env })).toBe(
      `http://${FAKE_COMFYUI_HOST}:18999/system_stats`,
    );
    expect(fakeComfyuiEnv({ env })).toEqual({
      [COMFY_BASE_ENV_KEY]: `http://${FAKE_COMFYUI_HOST}:18999`,
      E2E_FAKE_COMFY_HOST: FAKE_COMFYUI_HOST,
      [FAKE_COMFY_PORT_ENV_KEY]: "18999",
    });
  });

  it("非法的端口覆盖回落到默认值（不是 NaN / 0 / 越界值）", () => {
    for (const bad of ["", "abc", "0", "-1", "70000", "1e999"]) {
      expect(
        resolveFakeComfyuiPort(envWith({ [FAKE_COMFY_PORT_ENV_KEY]: bad })),
        bad,
      ).toBe(FAKE_COMFYUI_DEFAULT_PORT);
    }
  });

  it("`fakeComfyuiEnv()` 三个键一次喂全：应用连哪儿 + 假 cli 提交/登记去哪儿", () => {
    /* 拼漏一处的表现就是本 ISSUE 的现场：「应用连真件、替身空跑」。所以这里
     * 判的是**三个键都在**，不是「至少有一个」。 */
    const env = fakeComfyuiEnv();
    expect(Object.keys(env).sort()).toEqual(
      [COMFY_BASE_ENV_KEY, "E2E_FAKE_COMFY_HOST", "E2E_FAKE_COMFY_PORT"].sort(),
    );
    // 应用侧那个键是 `comfyui/client.ts` 的最高优先级覆盖（也是
    // `baseForLocalPort()` 见到就放弃进程表反查的那个）—— 名字不能写错。
    expect(readText("src/lib/comfyui/client.ts")).toContain(
      "process.env.COMFYUI_BASE",
    );
  });
});

describe("两个形状互不误判（真件指纹 vs 替身指纹）", () => {
  it("真件带 comfyui_version ⇒ 认成真件；替身不带 ⇒ 不认成真件", () => {
    expect(isRealComfyuiPayload(REAL_PAYLOAD)).toBe(true);
    expect(isRealComfyuiPayload(FAKE_PAYLOAD)).toBe(false);
    expect(isFakeComfyuiPayload(FAKE_PAYLOAD)).toBe(true);
    expect(isFakeComfyuiPayload(REAL_PAYLOAD)).toBe(false);
  });

  it("空壳 / 非对象一律两边都不像（不做「默认是真件」的猜测）", () => {
    for (const junk of [
      null,
      undefined,
      42,
      "x",
      {},
      { system: null },
      { system: {} },
    ]) {
      expect(isRealComfyuiPayload(junk), JSON.stringify(junk)).toBe(false);
      expect(isFakeComfyuiPayload(junk), JSON.stringify(junk)).toBe(false);
    }
    // `comfyui_version` 是空串等同于没有（真件不会回空版本号）。
    expect(isRealComfyuiPayload({ system: { comfyui_version: "  " } })).toBe(
      false,
    );
  });

  it("替身回的形状不会把自己送进「真件」那一支", () => {
    /* 替身若某天开始回 `comfyui_version`，`isRealComfyuiPayload` 会把它认成真件
     * ⇒ 每次跑 e2e 都 fail fast（探针把替身判成 real）。所以这条把替身**真回什么**
     * 与判据对一遍，而不是只看常量夹具。
     *
     * 判据的输入是真件那条响应（`comfyui_version` 是 ComfyUI `/system_stats`
     * 固定填的字段，本应用不读它 —— 它在这里只做**身份指纹**）。 */
    const serverSrc = readText("e2e/support/fake-comfyui-server.mjs");
    expect(serverSrc).toContain(
      'system: { os: "nt", ram_total: 1, ram_free: 1 }',
    );
    expect(serverSrc).not.toContain("comfyui_version");
  });

  it("夹具就是真件响应的那条：`comfyui_version` 是身份指纹，不是应用读的字段", () => {
    /* 真件形状取自 ISSUE #1756 记的现场（`curl /system_stats` 的原始输出）。
     * 应用侧**不读**这个字段（grep 得到 0 处），所以判据只认它当指纹 ——
     * 若哪天有模块开始读它，这条会提醒把「指纹」与「业务字段」两件事分开。 */
    expect(isRealComfyuiPayload(REAL_PAYLOAD)).toBe(true);
    expect(REAL_PAYLOAD.system.comfyui_version).toBe("0.37.0");
  });
});

describe("跑前那一探的判决（四态各归各的出口）", () => {
  it("没人应答（连不上）⇒ free：替身会正常起来", () => {
    expect(classifyFakeSlot({ status: 0 })).toEqual({
      verdict: "free",
      ok: true,
    });
  });

  it("应答是替身形状 ⇒ fake：继续跑（复用要说一声）", () => {
    expect(classifyFakeSlot({ status: 200, payload: FAKE_PAYLOAD })).toEqual({
      verdict: "fake",
      ok: true,
    });
  });

  it("应答是真件形状 ⇒ real：阻断（这正是本 ISSUE 的立案形态）", () => {
    const slot = classifyFakeSlot({ status: 200, payload: REAL_PAYLOAD });
    expect(slot.verdict).toBe("real");
    expect(slot.ok).toBe(false);
  });

  it("应答两边都不像 / 非 200 ⇒ unknown：同样阻断", () => {
    expect(
      classifyFakeSlot({ status: 200, payload: { hello: "world" } }).verdict,
    ).toBe("unknown");
    expect(classifyFakeSlot({ status: 500 }).verdict).toBe("unknown");
    expect(classifyFakeSlot({ status: 403 }).verdict).toBe("unknown");
  });

  it("阻断话术给的是**可执行的出口**，且不要求停掉真 ComfyUI", () => {
    /* 本 ISSUE 的修复取向就是「不要求任何人停真件」。旧口径（停掉再跑）会把
     * 「跑一次 e2e」变成「先中断我正在用的服务」—— 话术里再写一次就是回潮。 */
    const text = describeSlotConflict({ verdict: "real", status: 200 });
    expect(text).toContain(FAKE_COMFY_PORT_ENV_KEY);
    expect(text).toContain("pnpm test:e2e");
    expect(text).not.toMatch(/停掉.{0,6}(8188|真 ?ComfyUI).{0,10}再跑/);
    // 真件那一支要点名是真件（两种阻断给不同的话，人才知道该改哪儿）。
    expect(text).toContain("comfyui_version");
    const unknown = describeSlotConflict({ verdict: "unknown", status: 403 });
    expect(unknown).toContain("403");
    expect(unknown).not.toContain("comfyui_version");
  });

  it("「应用 server 被复用」的话术也说清「不必停真件」并给出口", () => {
    /* 同一族话术的第二个面：要停的是**被复用的那个 dev server**（不是本机常驻的
     * 真 ComfyUI），且要说清复用时 env 为什么到不了。 */
    const text = describeAppReuseConflict({ port: 3311 });
    expect(text).toContain("3311");
    expect(text).toContain("复用");
    expect(text).toContain("webServer.env");
    expect(text).toContain("CI=1 pnpm test:e2e");
    expect(text).not.toMatch(/停掉.{0,8}真 ?ComfyUI/);
  });
});

describe("探针真的探（拿真 HTTP 服务喂它，不复刻一份实现）", () => {
  let server: Server | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
      server = null;
    });
  });

  /** 起一个只回一个固定 `/system_stats` 体的临时服务。 */
  async function serve(payload: unknown): Promise<string> {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    return `http://127.0.0.1:${port}/system_stats`;
  }

  it("替身形状 ⇒ fake；真件形状 ⇒ real（端到端一次）", async () => {
    const fakeUrl = await serve(FAKE_PAYLOAD);
    const fakeObserved = await probeFakeComfySlot({ url: fakeUrl });
    expect(classifyFakeSlot(fakeObserved).verdict).toBe("fake");
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
      server = null;
    });

    const realUrl = await serve(REAL_PAYLOAD);
    const realObserved = await probeFakeComfySlot({ url: realUrl });
    expect(classifyFakeSlot(realObserved).verdict).toBe("real");
  });

  /**
   * 「没人」与「没等到」必须分开（ISSUE #1961）。
   *
   * CI 实测：这一步在自托管节点上判出 `free`（`status 0`），而端口上明明坐着服务 ——
   * 它是**超时**，不是「连接被拒」。两者此前都翻成 `status: 0` ⇒ `free` ⇒
   * `assertFakeSlotFree()` 放行，于是「真件坐在替身端口上」这条判据在负载高的时候
   * **静默关掉**。代价不对称，所以这一格按 `err.cause.code` 分岔。
   */
  it("连接被拒 ⇒ free（端口真的空着）", async () => {
    /* 拿一个**刚刚关掉**的真端口：连接会被拒，而不是「非法端口」那类别的错
     * （`http://127.0.0.1:1/` 是 `bad port`，两条路径的 `cause.code` 不一样）。 */
    const port = await closedPort();
    const observed = await probeFakeComfySlot({
      url: `http://127.0.0.1:${port}/system_stats`,
      timeoutMs: 800,
    });
    expect(observed.status).toBe(0);
    expect(classifyFakeSlot(observed).verdict).toBe("free");
  });

  it("有人应答但慢过预算 ⇒ unknown（不是 free —— 那是「没等到」不是「没人」）", async () => {
    /* 一台**真在监听**、但故意不答的服务：探针会耗尽预算。
     * 判成 `free` 就等于把「端口上有人」这条结论在负载高时静默放行。 */
    const slow = createServer(() => {
      /* 什么都不回，把预算耗光 */
    });
    await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
    const addr = slow.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    try {
      const observed = await probeFakeComfySlot({
        url: `http://127.0.0.1:${port}/system_stats`,
        timeoutMs: 300,
      });
      expect(classifyFakeSlot(observed).verdict).toBe("unknown");
      expect(observed.error).toContain("没在预算内");
    } finally {
      slow.closeAllConnections();
      await new Promise<void>((resolve) => slow.close(() => resolve()));
    }
  });

  it("探针预算没被「抬到看不出问题」（预算不是这一格的修法）", () => {
    /* 修的是**分岔**，不是把 1500ms 抬高 —— 抬它只会让「真挂死」晚一点被看见，
     * 而 `free` 那半边的静默放行一字未变。 */
    const src = readText("e2e/global-setup.ts");
    expect(src).toContain("timeoutMs ?? 1500");
    /* 分岔判据必须在：认不出 `cause.code` 时按「没等到」处理，不许按「空着」。 */
    expect(src).toContain("connectionRefused");
    expect(src).toContain("TimeoutError");
  });

  /** 一个**刚刚关闭**的真 TCP 端口：连接会被拒（`ECONNREFUSED`）。 */
  async function closedPort(): Promise<number> {
    const s = createTcpServer();
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
    const addr = s.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    await new Promise<void>((resolve) => s.close(() => resolve()));
    return port;
  }

  it("pre-flight：端口空着 ⇒ 不占用（起之前没人）", async () => {
    /* 只判「有没有人在」。`probePortOccupied` 走 TCP 而不是 HTTP：占了端口却不答
     * HTTP 的进程（半死的、某些代理）照样是占用 —— 只判连不连得上更准也更便宜。 */
    expect(await probePortOccupied(1, { timeoutMs: 500 })).toBe(false);
  });

  it("pre-flight：端口有人 ⇒ 占用（这一格必须在起 Playwright 之前探）", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html></html>");
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    expect(await probePortOccupied(port)).toBe(true);
  });

  it("pre-flight 一次探两个端口，两栏各说各的", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200).end("ok");
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const result = await runPreflight({
      appPort: port,
      fakePort: 1,
      timeoutMs: 500,
    });
    expect(result).toEqual({ appOccupied: true, fakeOccupied: false });
  });

  it("pre-flight 结论经一行 JSON 往返，两栏不串位", () => {
    const encoded = encodePreflight({ appOccupied: true, fakeOccupied: false });
    expect(encoded).not.toContain("\n");
    expect(decodePreflight(encoded)).toEqual({
      appOccupied: true,
      fakeOccupied: false,
    });
    // 反着来一次：只有两栏真的各归各位才可能同时对上。
    expect(
      decodePreflight(
        encodePreflight({ appOccupied: false, fakeOccupied: true }),
      ),
    ).toEqual({ appOccupied: false, fakeOccupied: true });
  });

  it("读不出 pre-flight 结论 ⇒ null（是「不知道」，不是「没有」）", () => {
    /* 这一格承重：手工 `pnpm exec playwright test` 时这份结论根本不存在。
     * 若读不出就回落成 `{appOccupied:false}`，「不知道」会被读成「起之前没人」，
     * 于是一条本该报出来的冲突（外部 dev server 被复用）静默通过。 */
    for (const bad of [undefined, "", "not json", "{}", "[]", "null"]) {
      expect(decodePreflight(bad), String(bad)).toBe(null);
    }
    // 只有一栏、类型不对的也一律不认（半份结论比没有更危险）。
    expect(decodePreflight('{"appOccupied":true}')).toBe(null);
    expect(decodePreflight('{"appOccupied":"yes","fakeOccupied":false}')).toBe(
      null,
    );
    // 两栏都在且是布尔 ⇒ 认。
    expect(decodePreflight('{"appOccupied":true,"fakeOccupied":false}')).toEqual(
      { appOccupied: true, fakeOccupied: false },
    );
  });

  it("`globalSetup` 侧的读法：拿不到结论一律 null（不阻断、也不误报复用）", () => {
    expect(readAppServerPreflight({})).toBe(null);
    expect(readFakeSlotPreflight({})).toBe(null);
    const env = {
      [E2E_PREFLIGHT_ENV_KEY]: encodePreflight({
        appOccupied: true,
        fakeOccupied: false,
      }),
    };
    expect(readAppServerPreflight(env)).toEqual({ occupiedBefore: true });
    expect(readFakeSlotPreflight(env)).toEqual({ occupiedBefore: false });
  });

  it("非 JSON 应答不抛：形状两边都不像 ⇒ unknown", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("not json");
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const observed = await probeFakeComfySlot({
      url: `http://127.0.0.1:${port}/system_stats`,
    });
    expect(observed.status).toBe(200);
    expect(classifyFakeSlot(observed).verdict).toBe("unknown");
  });
});

describe("探测时机：判「起之前有没有别人」就不能挂在 globalSetup 上（ISSUE #1766）", () => {
  it("真实顺序是「起 webServer 并等它可访问」→「跑 globalSetup」", () => {
    /* 这条是**根因**的机器形态，不是复述文档：上游 `runGlobalSetup()` 把任务按
     * `createGlobalSetupTasks()` 的顺序跑，webServer 是其中的 **plugin setup**
     * 且排在 `globalSetup` 之前。
     *
     * 判据拿的是真实源码（不是一份抄过来的顺序表）——上游改了这个顺序时，
     * 「探测为什么不能挂在 globalSetup 上」这个前提就要重新量，这条会红。 */
    const runner = readFileSync(resolvePlaywrightFile("lib/runner/index.js"), "utf8");
    /* 取整个函数体：靠**配平花括号**而不是找第一个 `}` —— 后者会切在数组元素
     * 的花括号上（`createRemoveOutputDirsTask()` 后面并没有 `}`），于是
     * 「plugin 在 globalSetup 之前」这句话压根没被检查。 */
    const tasksStart = runner.indexOf("function createGlobalSetupTasks(");
    expect(tasksStart, "找不到 createGlobalSetupTasks").toBeGreaterThan(0);
    const bodyStart = runner.indexOf("{", tasksStart);
    let depth = 0;
    let bodyEnd = bodyStart;
    for (let i = bodyStart; i < runner.length; i += 1) {
      if (runner[i] === "{") depth += 1;
      else if (runner[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          bodyEnd = i;
          break;
        }
      }
    }
    const tasks = runner.slice(bodyStart, bodyEnd);
    expect(tasks.length, "createGlobalSetupTasks 取空了").toBeGreaterThan(20);
    const pluginAt = tasks.indexOf("createPluginSetupTasks");
    const globalSetupAt = tasks.indexOf("createGlobalSetupTask");
    expect(pluginAt, "任务清单里没有 plugin setup").toBeGreaterThan(0);
    expect(globalSetupAt, "任务清单里没有 global setup").toBeGreaterThan(0);
    /* plugin setup（webServer 挂在这里）必须排在 global setup **之前** ——
     * 顺序反了的话「globalSetup 里探到自己的 server」就不成立，本修法的理由
     * 也随之失效，那时该重开这一格而不是留着一条没有前提的注释。 */
    expect(pluginAt).toBeLessThan(globalSetupAt);

    /* 第二个承重面：plugin setup 内部**串行**跑（`for (const task of this._tasks)`
     * + `await`），所以到最后一个 plugin 跑完时，**每一个** webServer 都可用。
     * 若哪天改成并行「起完就算」，第二个 server 可能还没 bind —— 那时
     * 「替身端口必在跑」这句话就不再是对所有 webServer 成立的。 */
    const taskLoop = runner.slice(
      runner.indexOf("const taskLoop = async () => {"),
    );
    /* 取到「循环体首次 await setup」为止 —— 写死字符数会随上游注释漂，
     * 那会让这条断言变成「上游改了个注释就红」的假报警。 */
    const firstSetupAwait = taskLoop.indexOf("await task.setup?.(");
    expect(firstSetupAwait, "taskLoop 里没有 await task.setup").toBeGreaterThan(
      0,
    );
    const loopHead = taskLoop.slice(0, firstSetupAwait);
    expect(loopHead).toContain("for (const task of this._tasks)");
    /* `await` 在循环体内 ⇒ 上一个 setup 跑完才轮到下一个（串行）。
     * 若改成 `Promise.all(tasks.map(...))`，最后一个 webServer 可能在
     * globalSetup 时还没 bind —— 那时「替身端口必在跑」就不再成立。 */
    expect(loopHead).not.toContain("Promise.all");
  });

  it("webServer 作为 plugin 挂上，且 config 里两条都在 `reuseExistingServer` 本地档", () => {
    /* 「本地跑必然探到自己起的」= 这条链：webServer → plugin setup →
     * 排在 globalSetup 之前。所以 config 里**有 webServer**、且本地档
     * `reuseExistingServer` 为真，正是本 ISSUE 的现场条件。 */
    const runner = readFileSync(
      resolvePlaywrightFile("lib/runner/index.js"),
      "utf8",
    );
    expect(runner).toContain("webServerPluginsForConfig(config2)");
    const config = readText("playwright.config.ts");
    // 两条 webServer 各有一处 `reuseExistingServer: !process.env.CI`。
    const flags = config.match(/reuseExistingServer: !process\.env\.CI/g) ?? [];
    expect(flags.length).toBe(2);
  });

  it("判据不再活在 `globalSetup` 里：它只读 pre-flight，不自己探应用端口", () => {
    /* 这一条拦的是**回潮**：把「应用端口有人 ⇒ 阻断」重新写回 `globalSetup`
     * 就等于把 ISSUE #1766 的机关再装回去（那时它必然自击）。
     * 判据是「那一跳读的是 pre-flight」+「文件里没有对应用端口的即时探测」。 */
    const setup = readText("e2e/global-setup.ts");
    expect(setup).toContain("readAppServerPreflight");
    expect(setup).toContain("occupiedBefore");
    // 应用端口那一跳不得再出现「即时探测 + reused 恒真」的形状。
    expect(setup).not.toContain("probeAppServerReuse");
    // 替身端口的复用话术也要挂在 pre-flight 上（否则对自己起的那个也这么说）。
    expect(setup).toContain("readFakeSlotPreflight");
  });

  it("pre-flight 真的在 `spawn` Playwright **之前**跑（时机是全部意义）", async () => {
    /* 判据判「接线在不在」：`scripts/e2e-run.mjs` 里 `runPreflight(...)` 必须出现在
     * `spawnSync(...)` 之前 —— 反过来的话它探到的就是本轮自己起的服务，
     * 与挂在 `globalSetup` 上没有区别。 */
    const run = readText("scripts/e2e-run.mjs");
    const preflightAt = run.indexOf("await runPreflight(");
    const spawnAt = run.indexOf("spawnSync(process.execPath");
    expect(preflightAt, "e2e-run 没有跑 pre-flight").toBeGreaterThan(0);
    expect(spawnAt, "e2e-run 没有 spawn Playwright").toBeGreaterThan(0);
    expect(preflightAt).toBeLessThan(spawnAt);
    // 结论要随 env 带下去（不带的话 globalSetup 那侧的读法恒 null，
    // 「复用」话术永远不出现 = 一次静默降级）。
    expect(run).toContain("env[E2E_PREFLIGHT_ENV_KEY] = encodePreflight(preflight)");
  });
});

describe("接线在位（§13.5.12：判据要有人跑）", () => {
  it("playwright.config 用同一份端点事实，并把 globalSetup 挂上", () => {
    const config = readText("playwright.config.ts");
    // 假服务那条 webServer 的 url / env 都来自模块，不写死端口。
    expect(config).toContain("fakeComfyuiStatsUrl()");
    expect(config).toContain("fakeComfyuiEnv()");
    // 应用侧也要注入（否则应用还连 8188 上的真件、替身空跑）。
    expect(config).toContain("...fakeComfyuiEnv()");
    expect(config).toContain('globalSetup: "./e2e/global-setup.ts"');
    // 配置里不得再出现写死的 8188 地址。
    expect(config).not.toMatch(/127\.0\.0\.1:8188/);
  });

  it("假服务与假 comfy-cli 的兜底端口都跟着模块走（不各写一份 8188）", () => {
    const serverSrc = readText("e2e/support/fake-comfyui-server.mjs");
    expect(serverSrc).toContain("resolveFakeComfyuiPort()");
    expect(serverSrc).toContain("resolveFakeComfyuiHost()");

    /* Python 侧引不了 `.mjs`，所以它的兜底值是**唯一**允许的第二处字面量
     * —— 这里把它与模块导出对一遍，漂了就红。 */
    const cliSrc = readText("e2e/support/fake-comfyui/comfy_cli/cli.py");
    const defaults = [...cliSrc.matchAll(/E2E_FAKE_COMFY_PORT", "(\d+)"/g)].map(
      (m) => Number(m[1]),
    );
    expect(defaults.length).toBeGreaterThan(0);
    for (const d of defaults) expect(d).toBe(FAKE_COMFYUI_DEFAULT_PORT);
  });

  it("e2e 用例里不再写死真件的 8188 地址", () => {
    /* 写死 8188 的断言会在替身换端口后**静默变成「断言真件」**：要么永远红，
     * 要么（本机真件在跑时）永远绿 —— 两种都让用例失去意义。 */
    const spec = readText("e2e/critical-flows.spec.ts");
    expect(spec).not.toMatch(/127\.0\.0\.1:8188/);
    expect(spec).toContain("fakeComfyuiBaseUrl()");
  });
});
