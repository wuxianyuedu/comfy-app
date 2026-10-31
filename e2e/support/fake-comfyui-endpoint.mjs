/**
 * 假 ComfyUI 的**端点事实** —— e2e 一侧的单一落点（ISSUE #1756）。
 *
 * ## 它取代的那句「碰巧能跑」
 *
 * 此前 `playwright.config.ts` 把假 ComfyUI 钉在 8188 —— 而 8188 正是产品自己
 * 拉起真 ComfyUI 的**固定默认端口**（`COMFYUI_DEFAULT_PORT`）。配合
 * `reuseExistingServer: !process.env.CI`（本地 `CI` 未设 ⇒ 复用），只要开发机上
 * 有一个真件在跑（另一个检出的 dev-launcher、桌面端、手工起的 ComfyUI），
 * Playwright 探测 `http://127.0.0.1:8188/system_stats` 拿到 200 就**静默复用真件**
 * —— 假服务一行代码都没执行。
 *
 * 后果是**依赖替身脚本化收口的用例全红，而报告读起来像功能红**：
 * `main-journey` 的「出图」那一跳断在下游替身没应答，用例自己的话术却在说
 * 「执行器收口失败」。人只能靠逐条隔离复跑 + 读用例话术去猜。
 *
 * ## 修法的取向：**不要求谁把真件停掉**
 *
 * 让替身与真件**不同端口**，冲突就从根上消失了 —— 真 ComfyUI 继续在 8188 上跑，
 * 替身在自己的端口上跑，两者互不遮挡。这条比「跑前 fail fast 让用户去停真件」
 * 好：后者把「跑一次 e2e」变成「先中断我自己正在用的服务」，而 e2e 本来就该
 * 能在开着真件的机器上跑。
 *
 * 于是本模块导出两件东西：
 *   ① **替身端口**（{@link FAKE_COMFYUI_PORT}）—— 刻意取在 ComfyUI 默认端口与它
 *      的就近偏移窗口（8188..8193，`client.ts` 的 `probeTargets`）**之外**，
 *      免得 `resolveComfyBase()` 的端口探测把替身认成「真件在偏移端口上」；
 *   ② **真件形状判据**（{@link isRealComfyuiPayload}）—— 万一替身端口上真的
 *      坐着一个真件（有人把自己的 ComfyUI 配置到同一端口），跑前那一探要能
 *      当场认出并说清出口，而不是让一堆用例报成功能红。
 *
 * 端口本身可被 `E2E_FAKE_COMFY_PORT` 覆盖（历史变量名，`fake-comfyui-server.mjs`
 * 与假 comfy-cli 都读它）—— 覆盖时本模块的其余导出**跟着变**，
 * 所以「替身监听哪个口」与「应用连哪个口」不会各说一套。
 */
/** 替身默认端口。刻意避开 ComfyUI 默认端口与它的就近偏移窗口（见文件头 ①）。 */
export const FAKE_COMFYUI_DEFAULT_PORT = 18_188;

/** 替身监听地址。回环 IPv4 显式写法 —— `localhost` 会被 Node fetch 先解析成 `::1`。 */
export const FAKE_COMFYUI_HOST = "127.0.0.1";

/** 环境变量名：端口覆盖（假服务与假 comfy-cli 共用一份，见文件头）。 */
export const FAKE_COMFY_PORT_ENV_KEY = "E2E_FAKE_COMFY_PORT";

/** 环境变量名：地址覆盖。 */
export const FAKE_COMFY_HOST_ENV_KEY = "E2E_FAKE_COMFY_HOST";

/** 应用侧的连接地址覆盖键（`comfyui/client.ts` 的 `COMFYUI_BASE`，最高优先级）。 */
export const COMFY_BASE_ENV_KEY = "COMFYUI_BASE";

/**
 * 本次运行替身实际监听的端口。
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
export function resolveFakeComfyuiPort(env = process.env) {
  const raw = Number(env[FAKE_COMFY_PORT_ENV_KEY]);
  return Number.isInteger(raw) && raw > 0 && raw <= 65_535 ? raw : FAKE_COMFYUI_DEFAULT_PORT;
}

/**
 * 本次运行替身实际监听的地址。
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveFakeComfyuiHost(env = process.env) {
  const raw = String(env[FAKE_COMFY_HOST_ENV_KEY] ?? "").trim();
  return raw || FAKE_COMFYUI_HOST;
}

/**
 * 替身的 base URL（`http://127.0.0.1:18188` 这种形状，结尾不带斜杠）。
 *
 * @param {{env?: Record<string, string | undefined>, host?: string, port?: number}} [overrides]
 * @returns {string}
 */
export function fakeComfyuiBaseUrl(overrides = {}) {
  const env = overrides.env ?? process.env;
  const host = overrides.host ?? resolveFakeComfyuiHost(env);
  const port = overrides.port ?? resolveFakeComfyuiPort(env);
  return `http://${host}:${port}`;
}

/**
 * `/system_stats` 的探针地址（Playwright `webServer.url` 与跑前那一探共用）。
 *
 * @param {{env?: Record<string, string | undefined>, host?: string, port?: number}} [overrides]
 * @returns {string}
 */
export function fakeComfyuiStatsUrl(overrides = {}) {
  return `${fakeComfyuiBaseUrl(overrides)}/system_stats`;
}

/**
 * 把替身的端点写进一份环境变量 —— 应用侧与假 comfy-cli 侧要的键不同，这里
 * **一次喂全**，免得调用方各自拼一半（拼漏一处的表现是「应用连真件、替身空跑」，
 * 也就是本 ISSUE 要根治的那个形态）。
 *
 * 三个键各回答一件事：
 *   · `COMFYUI_BASE` —— 应用连哪个地址。它在 `resolveComfyBase()` 里是**最高
 *     优先级**，且 `baseForLocalPort()` 见到它就返回 null（不做进程表反查）
 *     ⇒ 替身不会被本机真件「冒领」；
 *   · `E2E_FAKE_COMFY_HOST` / `E2E_FAKE_COMFY_PORT` —— 假 comfy-cli 往哪儿提交
 *     prompt、往哪儿登记 history（它只读这两个）。
 *
 * @param {{env?: Record<string, string | undefined>, host?: string, port?: number, base?: string}} [overrides]
 * @returns {Record<string, string>}
 */
export function fakeComfyuiEnv(overrides = {}) {
  const env = overrides.env ?? process.env;
  const host = overrides.host ?? resolveFakeComfyuiHost(env);
  const port = overrides.port ?? resolveFakeComfyuiPort(env);
  return {
    [COMFY_BASE_ENV_KEY]: overrides.base ?? fakeComfyuiBaseUrl({ host, port }),
    [FAKE_COMFY_HOST_ENV_KEY]: host,
    [FAKE_COMFY_PORT_ENV_KEY]: String(port),
  };
}

/**
 * 这个 `/system_stats` 响应是**真件**吗？
 *
 * 判据只用**真件一定有、替身一定没有**的那一格：真 ComfyUI 的 `system` 里带
 * `comfyui_version`（`server.py` 的 `/system_stats` 固定填它）。替身的响应
 * （`fake-comfyui-server.mjs`）刻意只有 `os` / `ram_*` 三个假值、`devices: []`
 * —— 一旦替身也带上版本号，这条判据会退化成「永远说真件」或「永远说替身」，
 * 所以两边都要守住这个形状（`tests/e2e-fake-comfyui-endpoint.test.ts` 锁着）。
 *
 * 判据**故意宽松于**「一定是真件」：这里只区分「这个口上坐的不是我们的替身」，
 * 至于它到底是 ComfyUI 还是别的什么服务，话术里都按「不是替身」说 —— 认错成
 * 「某个别人的服务」比认错成「真件」更少有误导。
 *
 * @param {unknown} payload
 * @returns {boolean}
 */
export function isRealComfyuiPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const system = /** @type {Record<string, unknown>} */ (payload).system;
  if (!system || typeof system !== "object") {
    return false;
  }
  const version = /** @type {Record<string, unknown>} */ (system).comfyui_version;
  return typeof version === "string" && version.trim() !== "";
}

/**
 * 这个 `/system_stats` 响应是**我们的替身**吗？
 *
 * `os` 取 `"nt"`（真件在 Windows 上是 `"nt"`、Linux 上是 `"posix"`，所以**单看
 * os 认不出替身**），真正的指纹是「`ram_total === 1`」这个刻意填的假值 +
 * `devices` 是空数组。它不证明「一定是替身」，但足以证明「不是真件」——
 * 而跑前那一探只需要这一格结论。
 *
 * @param {unknown} payload
 * @returns {boolean}
 */
export function isFakeComfyuiPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const obj = /** @type {Record<string, unknown>} */ (payload);
  if (isRealComfyuiPayload(obj)) {
    return false;
  }
  const system = obj.system;
  if (!system || typeof system !== "object") {
    return false;
  }
  const ram = /** @type {Record<string, unknown>} */ (system).ram_total;
  return ram === 1 && Array.isArray(obj.devices) && obj.devices.length === 0;
}

/**
 * 跑前那一探的**纯判决**（把「怎么探」留给调用方，好让判决本身能被逐条断言）。
 *
 * 四种结论各有明确出口：
 *   · `free`      —— 端口上没人。替身会正常起来，继续跑。
 *   · `fake`      —— 已经是我们的替身（`reuseExistingServer` 复用的情形）。继续跑，
 *                    但要让调用方知道它没被重启（替身的 `history` 是进程内存，
 *                    跨次复用会带着上一次的产物）。
 *   · `real`      —— 端口上是**真件**。阻断：它不是我们要的替身，用例会静默红。
 *   · `unknown`   —— 有人应答但两边的形状都不像。同样阻断（宁可让人看一眼，
 *                    也不要让「不是替身」的结论降级成满屏功能红）。
 *
 * @param {{status: number, payload?: unknown, error?: string}} observed
 * @returns {{verdict: "free" | "fake" | "real" | "unknown", ok: boolean}}
 */
export function classifyFakeSlot(observed) {
  if (observed.status === 0) {
    return { verdict: "free", ok: true };
  }
  if (observed.status !== 200) {
    return { verdict: "unknown", ok: false };
  }
  if (isFakeComfyuiPayload(observed.payload)) {
    return { verdict: "fake", ok: true };
  }
  if (isRealComfyuiPayload(observed.payload)) {
    return { verdict: "real", ok: false };
  }
  return { verdict: "unknown", ok: false };
}

/**
 * 阻断时该说的话 —— **带可执行的出口**，不是一句「端口被占」。
 *
 * 话术按「替身端口上坐的是谁」分岔：真件要给「换端口」与「改配置」两条路，
 * 而不是旧口径里那句「先去停掉你的 ComfyUI」—— 本 ISSUE 的修复取向就是不要求
 * 任何人停真件（见文件头「修法的取向」）。
 *
 * @param {{verdict?: string, status: number, payload?: unknown}} observed
 * @param {{host?: string, port?: number}} [endpoint]
 * @returns {string}
 */
export function describeSlotConflict(observed, endpoint = {}) {
  const host = endpoint.host ?? FAKE_COMFYUI_HOST;
  const port = endpoint.port ?? FAKE_COMFYUI_DEFAULT_PORT;
  const where = `http://${host}:${port}`;
  /* 允许调用方只给观测（`global-setup` 那条路径就是）：判决可以现算 ——
   * 让它必须自己先算一遍，等于把同一件事在两处各写一次。 */
  const verdict = observed.verdict ?? classifyFakeSlot(observed).verdict;
  const who =
    verdict === "real"
      ? `真 ComfyUI（响应里带 comfyui_version）`
      : `一个不是替身的服务（HTTP ${observed.status}，响应形状两边都不像）`;
  return [
    `[e2e] ✗ 替身端口 ${where} 上坐的是${who}。`,
    `      替身没起来，依赖它脚本化收口的用例会报成「功能红」（ISSUE #1756）。`,
    "",
    "      两条出口，任选一条：",
    `      ① 换个端口跑：E2E_FAKE_COMFY_PORT=<空端口> pnpm test:e2e`,
    `      ② 把占着 ${port} 的那个服务改到别的端口（它不该与替身抢这个口）。`,
    "",
    `      注意：**不需要**停掉 8188 上的真 ComfyUI —— 替身默认在 ${FAKE_COMFYUI_DEFAULT_PORT}，`,
    "      与它互不遮挡。真落到这个口上，说明有人把 ComfyUI 配到了替身的端口。",
  ].join("\n");
}

/**
 * ComfyUI 的「默认端口 + 就近偏移」探测窗口 —— `client.ts` 的 `probeTargets` 那一族。
 *
 * 这两个数**只有登记价值**：真正的判据是 `tests/e2e-fake-comfyui-endpoint.test.ts`
 * 拿真源（`endpoints.ts` 的 `COMFYUI_DEFAULT_PORT`、`client.ts` 的 `PROBE_RANGE`）
 * 复算一遍，两边对不上就红。放在这里是为了让 `.mjs` 侧（假服务 / 断言）有个
 * 不引 TS 也能用的形状 —— 不是第二份事实源。
 */
export const COMFY_PROBE_WINDOW = { defaultPort: 8188, probeRange: 5 };

/**
 * 探测窗口覆盖到的端口清单（`defaultPort` 起 `probeRange + 1` 个，与
 * `probeTargets` 的 `Array.from({ length: PROBE_RANGE + 1 }, …)` 同形）。
 *
 * @param {{defaultPort: number, probeRange: number}} [window]
 * @returns {number[]}
 */
export function comfyProbeWindowPorts(window = COMFY_PROBE_WINDOW) {
  return Array.from({ length: window.probeRange + 1 }, (_, i) => window.defaultPort + i);
}

/**
 * 「应用 server 被复用」时的阻断话术（ISSUE #1756 的另一个面）。
 *
 * Playwright 命中 `reuseExistingServer` 时**直接返回**，`webServer.env` 不被应用
 * —— 注入的 `COMFYUI_BASE` 只在「它自己起 server」那条路上生效。于是一个本机
 * 常驻的 dev server（另一个窗口的 `pnpm dev`）被复用时，应用会按**自己的**设置
 * 去连 ComfyUI（默认就是 8188 上的真件），替身又一次空跑 —— 与「替身端口被真件
 * 占着」是同一个故障形态，只是错在应用那侧。
 *
 * 出口同样**不要求停真 ComfyUI**：要停的是**被复用的那个 dev server**（它不是
 * 本机常驻服务，停掉重启一次就好），或者自己给应用设 `COMFYUI_BASE`。
 *
 * @param {{port?: number}} [endpoint]
 * @returns {string}
 */
export function describeAppReuseConflict(endpoint = {}) {
  const port = endpoint.port ?? "应用端口";
  const base = fakeComfyuiBaseUrl();
  return [
    `[e2e] ✗ 应用端口 ${port} 上已经有一个 server 在跑，Playwright 会**复用**它`,
    "      —— 而复用时 webServer.env **不会**被应用，替身地址因此到不了那个进程。",
    "      后果：应用按自己的设置去连 ComfyUI（默认 8188 上的真件），替身空跑，",
    "      依赖替身脚本化收口的用例报成「功能红」（ISSUE #1756）。",
    "",
    "      两条出口，任选一条（都**不需要**停 8188 上的真 ComfyUI）：",
    "      ① 停掉那个被复用的 dev server 再跑 e2e（Playwright 会自己起一个、带上替身地址）；",
    `      ② 或改用生产构建：CI=1 pnpm test:e2e（CI 下不复用，环境变量照常注入）。`,
    "",
    `      替身地址是 ${base}（由 e2e/support/fake-comfyui-endpoint.mjs 给出）。`,
  ].join("\n");
}

/**
 * `COMFYUI_DEFAULT_PORT` 与替身端口的**距离断言**（文件头 ① 的机器形态）。
 *
 * 替身端口若落进 ComfyUI 的就近偏移窗口，`resolveComfyBase()` 的端口探测会把
 * 它当成「真件在偏移端口上」，替身就从「下游替身」变成「应用以为的真件」，
 * 两个身份混在一个进程上。窗口宽度与 `client.ts` 的 `probeTargets` 同口径
 * （默认端口起 6 个，即 8188..8193）。
 *
 * @param {number} [fakePort]
 * @returns {{ok: boolean, distance: number, reason: string}}
 */
export function assertFakePortOffComfyWindow(
  fakePort = FAKE_COMFYUI_DEFAULT_PORT,
  window = COMFY_PROBE_WINDOW,
) {
  const windowPorts = comfyProbeWindowPorts(window);
  const inside = windowPorts.includes(fakePort);
  return {
    ok: !inside,
    distance: fakePort - window.defaultPort,
    reason: inside
      ? `替身端口 ${fakePort} 落在 ComfyUI 探测窗口 ${windowPorts[0]}..${windowPorts.at(-1)} 里：` +
        "resolveComfyBase() 的端口探测会把它认成「真件在偏移端口上」，两个身份混在一个进程上。"
      : `替身端口 ${fakePort} 在 ComfyUI 探测窗口 ${windowPorts[0]}..${windowPorts.at(-1)} 之外。`,
  };
}
