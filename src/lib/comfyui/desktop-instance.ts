// Comfy Desktop 实例元数据解析：从桌面实例目录反查 Comfy Desktop 应用数据，
// 拿到该实例的 launchArgs / 端口 / envVars，映射成「headless 服务」可用的参数；
// 并把 Comfy Desktop 登记的共享目录（模型 / 输入 / 输出）派生成对应启动参数。
//
// 背景：Comfy Desktop（Electron）把实例数据（Python 环境、节点）和应用元数据
// （launchArgs、端口策略）分居两处——前者在实例根（如 ComfyUI-Installs/ComfyUI2），
// 后者在 %APPDATA%\Comfy Desktop\installations.json。两者唯一的粘合点是实例根
// 里的 `.comfyui-desktop-*` 文件（一行 = 实例 ID，如 inst-1782874099613）。
//
// 共享目录（ISSUE #4843）：新版 Comfy Desktop 把共享模型 / 输入 / 输出目录登记在
// 应用数据目录（settings.json 的 inputDir / outputDir + instance-model-paths/<id>.yaml），
// **不写进 installations.json 的 launchArgs**，而是在启动瞬间动态追加
// `--extra-model-paths-config … --input-directory … --output-directory`（应用日志实证）。
// 本应用自己 spawn 桌面实例的 main.py，要跟桌面版行为对齐，就得把这三个参数
// 同样派生出来追加（argv 已带同名 flag 时不重复——用户在 launchArgs 里手填过的
// 以手填为准）。
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
import { isPlainRecord, isRecord } from "~/lib/is-record";
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
  const id = content.trim();
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
      if (isRecord(item) && item.id === instanceId) {
        return item;
      }
    }
    return null;
  }
  if (isRecord(data)) {
    // 直接键值对应（形如 { "inst-...": {…} }）
    const direct = data[instanceId];
    if (isRecord(direct)) {
      return direct;
    }
    // 深搜：遍历对象/数组，找 id 字段匹配的节点。
    return deepFindById(data, instanceId);
  }
  return null;
}

function deepFindById(node: unknown, id: string, depth = 0): Record<string, unknown> | null {
  if (depth > 12 || !isRecord(node)) {
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
  if (node.id === id) {
    return node;
  }
  for (const key of Object.keys(node)) {
    const hit = deepFindById(node[key], id, depth + 1);
    if (hit) {
      return hit;
    }
  }
  return null;
}

/** launchArgs 字段可能是空格分隔字符串或字符串数组，统一成数组。 */
function toArgList(launchArgs: unknown): Array<string> {
  if (typeof launchArgs === "string") {
    // 支持双引号包裹含空格的路径。
    const re = /"(?<quoted>[^"]*)"|(?<bare>\S+)/g;
    const out: Array<string> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(launchArgs))) {
      out.push(m.groups?.quoted ?? m.groups?.bare ?? "");
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
    const eq = /^--port=(?<port>.+)$/.exec(lower) ?? /^-p=(?<port>.+)$/.exec(lower);
    if (eq) {
      const n = Number.parseInt(eq.groups?.port ?? "", 10);
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
  if (isPlainRecord(ev)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(ev)) {
      if (typeof v === "string" || typeof v === "number") {
        out[k] = String(v);
      }
    }
    return out;
  }
  return {};
}

/* ── 共享目录参数（ISSUE #4843）────────────────────────────────────────
 *
 * Comfy Desktop 对共享目录的登记分两处、生效靠启动瞬间动态追加参数：
 *   · 共享输入 / 输出：settings.json 顶层的 `inputDir` / `outputDir`（全局一份）；
 *   · 共享模型：instance-model-paths/<实例ID>.yaml（按实例一份，内容是
 *     extra_model_paths 形状、base_path 指向共享 models）。
 * 本应用 spawn 桌面实例时按同形追加这三个参数，让 headless 与桌面版一致。
 */

/** Comfy Desktop 侧共享目录派生出的三个启动参数位（值都可能为 null = 没登记）。 */
export type DesktopSharedDirFlags = {
  /** 该实例生效的共享模型声明 yaml（instance-model-paths/<实例ID>.yaml）。 */
  extraModelPathsConfig: string | null;
  /** settings.json 的 inputDir（共享输入目录）。 */
  inputDir: string | null;
  /** settings.json 的 outputDir（共享输出目录）。 */
  outputDir: string | null;
};

/** argv 里是否已带某个 flag（`--x 值` 与 `--x=值` 两种写法都算）。 */
function hasFlag(args: ReadonlyArray<string>, flag: string): boolean {
  const lower = flag.toLowerCase();
  return args.some((token) => {
    const t = token.toLowerCase();
    return t === lower || t.startsWith(`${lower}=`);
  });
}

/**
 * 把共享目录参数并进既有 argv：三个位各判一次「已带同名 flag 就不重复追加」。
 * 用户在 Comfy Desktop 的启动参数里手填过的以手填为准 —— Desktop 启动时也是
 * 先放 launchArgs 再追加动态参数，同名 flag 由 ComfyUI 的 argparse 自己取舍。
 */
export function appendSharedDirFlags(
  args: ReadonlyArray<string>,
  shared: DesktopSharedDirFlags,
): Array<string> {
  const out = [...args];
  if (shared.extraModelPathsConfig !== null && !hasFlag(out, "--extra-model-paths-config")) {
    out.push("--extra-model-paths-config", shared.extraModelPathsConfig);
  }
  if (shared.inputDir !== null && !hasFlag(out, "--input-directory")) {
    out.push("--input-directory", shared.inputDir);
  }
  if (shared.outputDir !== null && !hasFlag(out, "--output-directory")) {
    out.push("--output-directory", shared.outputDir);
  }
  return out;
}

/**
 * 从 Comfy Desktop settings.json 内容解出共享输入 / 输出目录。
 * 键缺失、值非非空字符串、JSON 坏都按「没登记」处理（返回 null），不抛错 ——
 * 这份文件是 Comfy Desktop 的私产，读不出就该当没有，不该让启动链路炸掉。
 */
export function parseSharedDirsFromSettings(content: string): {
  inputDir: string | null;
  outputDir: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { inputDir: null, outputDir: null };
  }
  if (!isRecord(parsed)) {
    return { inputDir: null, outputDir: null };
  }
  const read = (key: string): string | null => {
    const v = parsed[key];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  return { inputDir: read("inputDir"), outputDir: read("outputDir") };
}

/** Comfy Desktop 的应用数据目录（%APPDATA%\Comfy Desktop）；非 Windows 为 null。 */
function comfyDesktopConfigRoot(override?: string): string | null {
  if (override !== undefined) {
    return override;
  }
  if (process.platform !== "win32") {
    return null;
  }
  return path.join(
    process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
    "Comfy Desktop",
  );
}

/**
 * 读 Comfy Desktop 登记的共享目录，派生三个启动参数位（真实 IO 层）。
 * settings.json / 实例 ID 文件 / instance-model-paths yaml 任一缺失或读挂都按
 * 「没登记这一项」处理 —— 共享目录是可选增强，读不出不该让启动链路失败。
 * 注入点便于单测不碰真实磁盘。
 */
export async function resolveDesktopSharedDirFlags(
  instanceIdFile: string | null,
  deps: {
    configRoot?: string;
    exists?: (p: string) => boolean;
    readFile?: (p: string, enc: "utf8") => Promise<string>;
  } = {},
): Promise<DesktopSharedDirFlags> {
  const flags: DesktopSharedDirFlags = {
    extraModelPathsConfig: null,
    inputDir: null,
    outputDir: null,
  };
  const configRoot = comfyDesktopConfigRoot(deps.configRoot);
  if (configRoot === null || configRoot === "") {
    return flags;
  }
  const readFile =
    deps.readFile ?? (async (p: string, enc: "utf8") => fs.promises.readFile(p, enc));
  const exists = deps.exists ?? fs.existsSync;

  try {
    const raw = await readFile(path.join(configRoot, "settings.json"), "utf8");
    const parsed = parseSharedDirsFromSettings(raw);
    flags.inputDir = parsed.inputDir;
    flags.outputDir = parsed.outputDir;
  } catch {
    // 没有 settings.json / 读挂：共享输入输出按没登记处理。
  }
  if (instanceIdFile !== null) {
    try {
      const id = parseInstanceId(await readFile(instanceIdFile, "utf8"));
      if (id !== null) {
        const yamlPath = path.join(configRoot, "instance-model-paths", `${id}.yaml`);
        if (exists(yamlPath)) {
          flags.extraModelPathsConfig = yamlPath;
        }
      }
    } catch {
      // 实例 ID 读不到：共享模型无从按实例关联，按没登记处理。
    }
  }
  return flags;
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
  const configRoot = comfyDesktopConfigRoot(deps.configRoot);
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
  const re = /"(?<quoted>[^"]*)"|(?<bare>\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    out.push(m.groups?.quoted ?? m.groups?.bare ?? "");
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
 *   若元数据读不到（非 Windows / 文件缺失 / 未命中实例 ID），则回落默认 8188——
 *   启动仍可用；共享目录参数（见上）与元数据互不依赖，照常派生追加。
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
  /** 共享目录参数的注入点（默认读 %APPDATA%\Comfy Desktop 的真实登记）。 */
  resolveShared?: (instanceIdFile: string | null) => Promise<DesktopSharedDirFlags>;
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
    /* 共享目录参数（ISSUE #4843）：Desktop 登记在应用数据目录、启动时动态追加，
     * 本应用 spawn 也照做——元数据缺失（读不到 installations.json）不影响这一步，
     * 两者互不依赖，spawn 出的实例一样要吃到共享模型 / 输入 / 输出。 */
    const shared = await (input.resolveShared ?? resolveDesktopSharedDirFlags)(kind.instanceIdFile);
    return {
      port: meta === null ? 0 : (meta.port ?? 0), // 0 → 调用方按 COMFYUI_DEFAULT_PORT 兜底
      extraArgs: appendSharedDirFlags(meta?.args ?? [], shared),
      envVars: meta?.envVars ?? {},
    };
  }

  return {
    port: input.comfyuiPort,
    extraArgs: splitArgTokens(input.comfyuiExtraArgs),
    envVars: {},
  };
}

function classifyLite(dir: string, exists?: (p: string) => boolean) {
  const c = classifyComfyInstall(dir, exists);
  return { kind: c.kind, instanceIdFile: c.instanceIdFile ?? null };
}
