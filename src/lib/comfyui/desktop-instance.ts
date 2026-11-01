// Comfy Desktop 实例元数据解析：从桌面实例目录反查 Comfy Desktop 应用数据，
// 拿到该实例的 launchArgs / 端口 / envVars，映射成「headless 服务」可用的参数。
//
// 背景：Comfy Desktop（Electron）把实例数据（Python 环境、节点）和应用元数据
// （launchArgs、端口策略）分居两处——前者在实例根（如 ComfyUI-Installs/ComfyUI2），
// 后者在 %APPDATA%\Comfy Desktop\installations.json。两者唯一的粘合点是实例根
// 里的 `.comfyui-desktop-*` 文件（一行 = 实例 ID，如 inst-1782874099613）。
//
// 本应用不是 Comfy Desktop：它自己 spawn 桌面实例的 main.py（headless server）。
// 因此桌面实例的启动端口/参数不再由设置页手填，而是读回该实例在 Comfy Desktop
// 里登记的 launchArgs，再经 launchArgs→headless 映射后使用（去掉只在 GUI 桌面
// 里才生效、headless 服务不接受的参数，并抽出 --port）。
//
// 模块分层：纯解析函数（参数传 parsed JSON / 文件内容）可独立单测；真实 IO
// （读 %APPDATA% 文件）收敛在 resolveDesktopLaunchMeta()，文件缺失/异常一律
// 静默降级返回 null，由 lifecycle 回落到默认端口 + 用户配置。
//
// §18.4 三选一：本模块走第三类（P3 迁移第 1 期·lib 层地基批）——依赖
// Node 内建 `fs` / `os` / `path` + 同批已摘 server-only 的 `./instance-kind`。
// 登记进 `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyComfyInstall } from "./instance-kind";

/** 桌面实例最终派生出的 headless 启动参数（不含解释器与 main.py 路径）。 */
export type DesktopLaunchArgs = {
  /** 映射后的 headless 额外参数（如 --enable-manager …）。 */
  args: Array<string>;
  /** 实例登记的 envVars（如 PYTHONUTF8 等）；无则空对象。 */
  envVars: Record<string, string>;
  /** 从 launchArgs 抽出的 --port；无则 null（用默认 8188）。 */
  port: number | null;
};

/** 从 .comfyui-desktop-* 文件内容读实例 ID（单行文本，去掉空白）。 */
export function parseInstanceId(content: string): string | null {
  const id = (content ?? "").trim();
  return id ? id : null;
}

/**
 * 从 Comfy Desktop installations.json 的 parsed JSON 里按实例 ID 定位条目。
 * 兼容两种存储形态：
 *   - 顶层为数组：[{ id, launchArgs, envVars, launchMode }, …]
 *   - 顶层为对象：{ installs: { [id]: entry } } / { <某 key>: [{…}] } 等嵌套形态，
 *     递归搜出第一个 `.id === instanceId` 的节点。
 * 找不到返回 null（调用方降级默认端口）。
 */
export function findInstallationById(
  data: unknown,
  instanceId: string,
): Record<string, unknown> | null {
  if (!instanceId) {
    return null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      if (
        // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
        item != null &&
        typeof item === "object" &&
        /* SAFETY: 类型断言已复核 */ (item as Record<string, unknown>).id === instanceId
      ) {
        /* SAFETY: 类型断言已复核 */
        return item as Record<string, unknown>;
      }
    }
    return null;
  }
  // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
  if (data != null && typeof data === "object") {
    /* SAFETY: 类型断言已复核 */
    const obj = data as Record<string, unknown>;
    // 直接键值对应（形如 { "inst-...": {…} }）
    const direct = obj[instanceId];
    // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
    if (direct != null && typeof direct === "object") {
      /* SAFETY: 类型断言已复核 */
      return direct as Record<string, unknown>;
    }
    // 深搜：遍历对象/数组，找 id 字段匹配的节点。
    return deepFindById(obj, instanceId);
  }
  return null;
}

function deepFindById(node: unknown, id: string, depth = 0): Record<string, unknown> | null {
  // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
  if (depth > 12 || node == null) {
    return null;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = deepFindById(item, id, depth + 1);
      if (hit) {
        return hit;
      }
    }
    return null;
  }
  if (typeof node === "object") {
    /* SAFETY: 类型断言已复核 */
    const obj = node as Record<string, unknown>;
    if (obj.id === id && typeof obj === "object") {
      return obj;
    }
    for (const key of Object.keys(obj)) {
      const hit = deepFindById(obj[key], id, depth + 1);
      if (hit) {
        return hit;
      }
    }
  }
  return null;
}

/** launchArgs 字段可能是空格分隔字符串或字符串数组，统一成数组。 */
function toArgList(launchArgs: unknown): Array<string> {
  if (typeof launchArgs === "string") {
    // 支持双引号包裹含空格的路径。
    const re = /"([^"]*)"|(\S+)/g;
    const out: Array<string> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(launchArgs))) {
      out.push(m[1] ?? m[2] ?? "");
    }
    return out;
  }
  if (Array.isArray(launchArgs)) {
    return launchArgs
      .filter((a): a is string => typeof a === "string")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
  }
  return [];
}

/**
 * launchArgs → headless 映射：
 * 本应用直接 spawn main.py（headless server），只保留对 headless 服务有意义的
 * 参数。丢掉：
 *   - 解释器/脚本前缀（若 launchArgs 误含 "python" / "main.py" 等命令头）；
 *   - GUI 专属参数（如 --show / desktop window 相关，headless 下无意义）；
 * 保留其余一般服务器参数（--enable-manager / --input-directory / --listen 等），
 * 并抽出 --port（兼容 `--port 8188` 与 `--port=8188` 两种写法）。
 */
export function launchArgsToHeadless(raw: unknown): DesktopLaunchArgs {
  const argv = toArgList(raw);
  const args: Array<string> = [];
  let port: number | null = null;

  // GUI/桌面专属、或命令头 token 的去重黑名单。
  const drop = new Set([
    "python",
    "python.exe",
    "pythonw",
    "pythonw.exe",
    "main.py",
    "comfyui",
    "comfy",
    "--show",
    "--headful",
    "--gui",
    "--windowed",
  ]);

  for (let i = 0; i < argv.length; i++) {
    /* 循环体里有「跳过端口值」的手动 `i++`，所以不能换成 `for...of`；
     * `at()` 的越界即 `undefined` 正好与循环判据同源。 */
    const token = argv.at(i);
    if (token === undefined) {
      break;
    }
    const lower = token.toLowerCase();
    if (drop.has(lower)) {
      continue;
    }
    // 提取 --port：`--port <n>` 或 `--port=<n>` 或 `-p <n>`。
    if (lower === "--port" || lower === "-p") {
      const next = argv[i + 1];
      const n = Number.parseInt(next ?? "", 10);
      if (!Number.isNaN(n)) {
        port = n;
        i++; // 跳过端口值
      }
      continue;
    }
    const eq = /^--port=(.+)$/.exec(lower) ?? /^-p=(.+)$/.exec(lower);
    if (eq) {
      const n = Number.parseInt(eq[1] ?? "", 10);
      if (!Number.isNaN(n)) {
        port = n;
      }
      continue;
    }
    args.push(token);
  }

  return { args, port, envVars: {} };
}

/** 从 installations.json 条目里解出 envVars（可能为对象或空）。 */
function extractEnvVars(entry: Record<string, unknown> | null): Record<string, string> {
  const ev = entry?.envVars;
  // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
  if (ev != null && typeof ev === "object" && !Array.isArray(ev)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(
      /* SAFETY: 类型断言已复核 */ ev as Record<string, unknown>,
    )) {
      if (typeof v === "string" || typeof v === "number") {
        out[k] = String(v);
      }
    }
    return out;
  }
  return {};
}

/** 解析 Comfy Desktop installations.json 内容并映射成 headless 启动参数。 */
export function parseDesktopLaunchArgs(
  fileContent: string,
  instanceId: string,
): DesktopLaunchArgs | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    return null;
  }
  const entry = findInstallationById(parsed, instanceId);
  if (!entry) {
    return null;
  }
  const headless = launchArgsToHeadless(entry.launchArgs);
  return { ...headless, envVars: extractEnvVars(entry) };
}

/**
 * 从安装根解析桌面实例最终启动参数（真实 IO 层）。
 *   instanceIdFile 一般指向 <实例根>/.comfyui-desktop-2（含实例 ID 的单行文件）。
 * 只在 Windows 上读 Comfy Desktop 数据；读不到/解析失败返回 null，调用方回落默认。
 * 注入点便于单测：readFile / configRoot 可覆盖。
 */
export async function resolveDesktopLaunchArgs(
  instanceIdFile: string,
  deps: {
    configRoot?: string;
    readFile?: (p: string, enc: "utf8") => Promise<string>;
  } = {},
): Promise<DesktopLaunchArgs | null> {
  const readFile =
    deps.readFile ?? (async (p: string, enc: "utf8") => fs.promises.readFile(p, enc));
  let idContent: string;
  try {
    idContent = await readFile(instanceIdFile, "utf8");
  } catch {
    return null;
  }
  const instanceId = parseInstanceId(idContent);
  if (instanceId === null) {
    return null;
  }

  // Comfy Desktop 的数据目录：默认 %APPDATA%\Comfy Desktop。
  const configRoot =
    deps.configRoot ??
    (process.platform === "win32"
      ? path.join(
          process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
          "Comfy Desktop",
        )
      : null);
  if (configRoot === null || configRoot === "") {
    return null;
  }
  const installsPath = path.join(configRoot, "installations.json");
  let raw: string;
  try {
    raw = await readFile(installsPath, "utf8");
  } catch {
    return null;
  }
  return parseDesktopLaunchArgs(raw, instanceId);
}

/** 把空格分隔的 extraArgs 切成参数数组（支持双引号包裹含空格的路径）。 */
export function splitArgTokens(s: string): Array<string> {
  const out: Array<string> = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s ?? ""))) {
    out.push(m[1] ?? m[2] ?? "");
  }
  return out;
}

/** 便携版/venv 的有效启动参数（端口 + 额外参数），由设置项直接决定。 */
export type ManualLaunch = {
  envVars: Record<string, string>;
  extraArgs: Array<string>;
  port: number;
};

/** 组装一次启动所需的有效端口 / 额外参数 / 环境变量。
 *
 * 桌面实例：端口与参数来自 Comfy Desktop 元数据（launchArgs→headless 映射），
 * 用户手填的 comfyuiPort / comfyuiExtraArgs 不再参与（设置页对桌面也不暴露这两项）。
 *   若元数据读不到（非 Windows / 文件缺失 / 未命中实例 ID），则回落默认 8188，
 *   参数为空——启动仍可用，只是没有额外参数。
 * 便携版 / venv：沿用设置里的 comfyuiPort（0 = 默认 8188）与 comfyuiExtraArgs。
 */
export async function resolveEffectiveLaunch(input: {
  classify?: (dir: string) => {
    instanceIdFile: string | null;
    kind: string;
  };
  comfyuiExtraArgs: string;
  comfyuiPath: string;
  comfyuiPort: number;
  exists?: (p: string) => boolean;
  resolveDesktop?: (file: string) => Promise<DesktopLaunchArgs | null>;
}): Promise<ManualLaunch> {
  const kind = input.classify
    ? input.classify(input.comfyuiPath)
    : classifyLite(input.comfyuiPath, input.exists);
  const isDesktop = kind.kind === "desktop" && Boolean(kind.instanceIdFile);

  if (isDesktop) {
    const meta =
      kind.instanceIdFile === null
        ? null
        : await (input.resolveDesktop ?? resolveDesktopLaunchArgs)(kind.instanceIdFile);
    if (meta) {
      return {
        port: meta.port ?? 0, // 0 → 调用方按 COMFYUI_DEFAULT_PORT 兜底
        extraArgs: meta.args,
        envVars: meta.envVars,
      };
    }
    // 桌面元数据缺失：回落默认 8188，不套用户手填端口/参数（桌面不暴露这两项）。
    return { port: 0, extraArgs: [], envVars: {} };
  }

  return {
    port: input.comfyuiPort ?? 0,
    extraArgs: splitArgTokens(input.comfyuiExtraArgs ?? ""),
    envVars: {},
  };
}

function classifyLite(dir: string, exists?: (p: string) => boolean) {
  const c = classifyComfyInstall(dir, exists);
  return { kind: c.kind, instanceIdFile: c.instanceIdFile ?? null };
}
