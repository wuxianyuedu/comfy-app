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
import { probeAppServerReuse, probeFakeComfySlot } from "../e2e/global-setup";
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

  it("空端口：连不上 ⇒ status 0（是 free，不是 unknown）", async () => {
    const observed = await probeFakeComfySlot({
      url: "http://127.0.0.1:1/system_stats",
      timeoutMs: 500,
    });
    expect(observed.status).toBe(0);
    expect(classifyFakeSlot(observed).verdict).toBe("free");
  });

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

  it("应用端口有人应答 ⇒ `probeAppServerReuse` 认出「会被复用」", async () => {
    /* 复用时 Playwright **不应用** `webServer.env`（上游 `_startProcess()` 的
     * early return），注入的替身地址到不了那个进程 —— 与「替身端口被真件占着」
     * 是同一个故障的另一面，所以它也要有执行者。 */
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html></html>");
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const observed = await probeAppServerReuse({ port });
    expect(observed.reused).toBe(true);
    expect(observed.status).toBe(200);
  });

  it("应用端口空着 ⇒ 不判复用（探针不把「连不上」当故障）", async () => {
    const observed = await probeAppServerReuse({ port: 1, timeoutMs: 500 });
    expect(observed.reused).toBe(false);
    expect(observed.status).toBe(0);
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
