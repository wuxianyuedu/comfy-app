/**
 * 假 ComfyUI 的**端点事实**（e2e 一侧单一落点，ISSUE #1756）：端口刻意避开 ComfyUI 默认 8188 与它的就近偏移窗口，
 * 否则 `reuseExistingServer: !CI` 会让 Playwright 探测到本机真件就静默复用，假服务一行没跑、报告却像功能红。另导
 * `isRealComfyuiPayload`（替身端口上若坐着真件，跑前那一探要当场认出）；`E2E_FAKE_COMFY_PORT` 可覆盖端口，其余导出跟着变。
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
 * 本次运行替身实际监听的端口（`E2E_FAKE_COMFY_PORT` 可覆盖）。
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
export function resolveFakeComfyuiPort(env = process.env) {
  const raw = Number(env[FAKE_COMFY_PORT_ENV_KEY]);
  return Number.isInteger(raw) && raw > 0 && raw <= 65_535 ? raw : FAKE_COMFYUI_DEFAULT_PORT;
}

/**
 * 本次运行替身实际监听的地址（`E2E_FAKE_COMFY_HOST` 可覆盖）。
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveFakeComfyuiHost(env = process.env) {
  const raw = String(env[FAKE_COMFY_HOST_ENV_KEY] ?? "").trim();
  return raw || FAKE_COMFYUI_HOST;
}

/**
 * 替身的 base URL（`http://127.0.0.1:18188` 这种形状，结尾不带斜杠）。
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
 * @param {{env?: Record<string, string | undefined>, host?: string, port?: number}} [overrides]
 * @returns {string}
 */
export function fakeComfyuiStatsUrl(overrides = {}) {
  return `${fakeComfyuiBaseUrl(overrides)}/system_stats`;
}

/**
 * 把替身的端点**一次喂全**进环境变量 —— 各自拼一半会「应用连真件、替身空跑」（ISSUE #1756 要根治的形态）：
 * `COMFYUI_BASE` 优先级最高且 `baseForLocalPort()` 见它即 null（不反查进程表）；另两键供假 comfy-cli 提交 prompt / 登记 history。
 * @param {{env?: Record<string, string | undefined>, host?: string, port?: number, base?: string}} [overrides]
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
 * 这个 `/system_stats` 响应是**真件**吗？判据只用「真件一定有、替身一定没有」那一格：真件的 `system` 带 `comfyui_version`
 * （`server.py` 固定填），替身只有 `os`/`ram_*` 假值与 `devices: []` —— 两边都要守住这形状；话术故意宽松成「不是替身」。
 * @param {unknown} payload @returns {boolean}
 */
export function isRealComfyuiPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const system = "system" in payload ? payload.system : undefined;
  if (!system || typeof system !== "object") {
    return false;
  }
  const version = "comfyui_version" in system ? system.comfyui_version : undefined;
  return typeof version === "string" && version.trim() !== "";
}

/**
 * 这个 `/system_stats` 响应是**我们的替身**吗？`os` 取 `"nt"` 单看认不出（真件 Windows 上也是 `"nt"`），指纹是
 * `ram_total === 1` 这个刻意假值 + `devices` 空数组：不证明「一定是替身」，但足以证明「不是真件」。
 * @param {unknown} payload @returns {boolean}
 */
export function isFakeComfyuiPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  if (isRealComfyuiPayload(payload)) {
    return false;
  }
  const system = "system" in payload ? payload.system : undefined;
  if (!system || typeof system !== "object") {
    return false;
  }
  const ram = "ram_total" in system ? system.ram_total : undefined;
  const devices = "devices" in payload ? payload.devices : undefined;
  return ram === 1 && Array.isArray(devices) && devices.length === 0;
}

/**
 * 跑前那一探的**纯判决**（怎么探留给调用方）：`free` 无人；`fake` 已是替身（`reuseExistingServer` 复用，history 在内存、
 * 会带上次产物）；`real` 端口上是真件，阻断（用例会静默红）；`unknown` 有人应答但两边都不像，同样阻断（别让结论降级成满屏功能红）。
 * @param {{status: number, payload?: unknown, error?: string}} observed
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
 * 阻断话术要**带可执行出口**（不是「端口被占」）：真件给「换端口 / 改配置」两条路，不要求任何人停真件（见文件头）。
 * @param {{verdict?: string, status: number, payload?: unknown}} observed
 * @param {{host?: string, port?: number}} [endpoint] @returns {string}
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
 * ComfyUI 的「默认端口 + 就近偏移」探测窗口（`client.ts` 的 `probeTargets` 那一族）。这两个数**只有登记价值**：
 * 真值由 `tests/e2e-fake-comfyui-endpoint.test.ts` 拿 `COMFYUI_DEFAULT_PORT` / `PROBE_RANGE` 复算，对不上就红；
 * 放这里只为让 `.mjs` 侧（假服务 / 断言）有不引 TS 也能用的形状，不是第二份事实源。
 */
export const COMFY_PROBE_WINDOW = { defaultPort: 8188, probeRange: 5 };

/**
 * 探测窗口覆盖到的端口清单（`defaultPort` 起 `probeRange + 1` 个，与 `probeTargets` 的
 * `Array.from({ length: PROBE_RANGE + 1 }, …)` 同形）。
 * @param {{defaultPort: number, probeRange: number}} [window] @returns {number[]}
 */
export function comfyProbeWindowPorts(window = COMFY_PROBE_WINDOW) {
  return Array.from({ length: window.probeRange + 1 }, (_, i) => window.defaultPort + i);
}

/**
 * 「应用 server 被复用」时的阻断话术（ISSUE #1756 的另一面）：`reuseExistingServer` 命中时 Playwright **直接返回**、
 * `webServer.env` 不被应用 ⇒ dev server 被复用时应用按自己的设置连真件、替身空跑；出口是停掉被复用的 dev server。
 * @param {{port?: number}} [endpoint] @returns {string}
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
 * `COMFYUI_DEFAULT_PORT` 与替身端口的**距离断言**（文件头 ① 的机器形态）：替身端口若落进就近偏移窗口，
 * `resolveComfyBase()` 会把它当成「真件在偏移端口上」，两个身份混在一个进程上；窗口与 `probeTargets` 同口径（8188..8193）。
 * @param {number} [fakePort] @returns {{ok: boolean, distance: number, reason: string}}
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
