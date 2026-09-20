// 解释器反查：从「实例自带的环境描述」推出可能承载 ComfyUI 的 python.exe 路径。
//
// 背景（ISSUE #344 的第 5 级判据）：Comfy Desktop 的实例由 `uv` 拉起，解释器
// 常常不在实例根的 `standalone-env\python.exe`，而在 uv 的托管目录
// （`%LOCALAPPDATA%\uv\python\cpython-3.x…\python.exe`）。此时按「实例根下的
// 解释器路径」查进程表必然落空，状态判定只剩 HTTP 探测一条腿——进程活着但
// 接口还没就绪时就被显示成「未运行」。
//
// 本模块只回答一个问题：**这个安装可能用哪些解释器跑起来**。两条线索：
//   ① `<环境根>\pyvenv.cfg` 的 `home` / `executable`——CPython venv 记录
//      创建它的基础解释器位置（uv 建的 venv 同样会写 uv 托管目录），顺藤
//      摸到真正在跑的那个 python.exe；
//   ② uv 缓存/托管目录里枚举 `cpython-*` 环境（`UV_PYTHON_INSTALL_DIR`、
//      `%LOCALAPPDATA%\uv\python`、`~/.local/share/uv/python` 这两处）。
// 两者都只是「候选」，是否真在跑由 status.ts 查进程表决定。
//
// 纯函数 + 注入 exists/readdir：不 spawn、不碰网络，可独立单测。真实调用方
// 注入默认的 fs 实现（见 collectComfyPythonCandidates 的默认参数）。

import "server-only";
import fs from "fs";
import os from "os";
import path from "path";
import { normalizeSlashes } from "~/lib/path-display";

/** pyvenv.cfg 里我们关心的字段：基础解释器所在目录与可执行文件全路径。 */
export type PyvenvConfig = {
  /** `home`：基础解释器所在目录。 */
  home: string | null;
  /** `executable`：基础解释器全路径。 */
  executable: string | null;
};

/**
 * 解析 pyvenv.cfg 文本。格式是 `key = value` 的逐行键值对（大小写不敏感、
 * 值可含空格与 Windows 反斜杠），未知键忽略。解析不出来返回全 null。
 */
export function parsePyvenvCfg(content: string): PyvenvConfig {
  const out: PyvenvConfig = { home: null, executable: null };
  for (const rawLine of (content ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, "");
    if (!value) continue;
    if (key === "home") out.home = value;
    else if (key === "executable") out.executable = value;
  }
  return out;
}

/**
 * 从一份 pyvenv.cfg 推出它的基础解释器候选路径。
 *
 * `executable` 最直接（就是那个 python.exe）；`home` 只给到目录，需要按平台
 * 补 `python.exe` / `python`。两者都缺失时返回空数组。
 */
export function pythonPathsFromPyvenv(
  cfg: PyvenvConfig,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const names =
    platform === "win32"
      ? ["python.exe", "pythonw.exe"]
      : ["python", "python3"];
  const out: string[] = [];
  if (cfg.executable) {
    out.push(cfg.executable);
  }
  if (cfg.home) {
    for (const n of names) out.push(path.join(cfg.home, n));
    // uv 托管目录里解释器常带 `install\` 一层（如
    // cpython-3.12.8-.../install/python.exe），补上这条常见形态。
    for (const n of names) out.push(path.join(cfg.home, "install", n));
  }
  return out;
}

/** 本模块只关心这几个环境变量，用一个窄结构体承接，便于单测注入完整的
 *  「空环境」（Next 生成的 ProcessEnv 把所有键当必填，直接传 {} 通不过类型检查）。 */
export type PythonEnvVars = {
  /** uv 解释器托管目录（显式指定时优先于平台默认位置）。 */
  UV_PYTHON_INSTALL_DIR?: string | undefined;
  /** Windows：`%LOCALAPPDATA%`。 */
  LOCALAPPDATA?: string | undefined;
  /* POSIX 侧的基准目录由 `$XDG_DATA_HOME` 决定。 */
  XDG_DATA_HOME?: string | undefined;
};

/** 一个待查进程表的解释器候选：路径 + 面向用户的中文来路描述。 */
export type PythonCandidate = {
  /** 解释器可执行文件路径（用于在进程命令行里做子串匹配）。 */
  exe: string;
  /** 该候选从哪来（状态行提示 / 日志用）。 */
  via: string;
};

/**
 * 从安装根枚举「可能承载 ComfyUI 的解释器」候选。
 *
 * 覆盖顺序（先具体后宽泛，调用方按序查进程表即可）：
 *   ① `<环境根>\pyvenv.cfg` 的 executable / home —— venv 与 uv venv 通用；
 *   ② uv 托管目录里各 `cpython-*` 环境的解释器。
 * 环境根候选：实例根本身 + 其下的 `standalone-env` / `.venv` / `venv`
 * （Comfy Desktop canonical 运行时是 standalone-env）。
 *
 * `exists` / `readFile` / `readdir` / `env` 可注入，便于单测与跨平台验证。
 */
export function collectComfyPythonCandidates(
  installRoot: string,
  deps: {
    exists?: (p: string) => boolean;
    readFile?: (p: string) => string;
    readdir?: (p: string) => string[];
    env?: PythonEnvVars;
    platform?: NodeJS.Platform;
    homedir?: string;
  } = {},
): PythonCandidate[] {
  const exists = deps.exists ?? ((p: string) => fs.existsSync(p));
  const readFile =
    deps.readFile ??
    ((p: string) => {
      try {
        return fs.readFileSync(/*turbopackIgnore: true*/ p, "utf8");
      } catch {
        return "";
      }
    });
  const readdir =
    deps.readdir ??
    ((p: string) => {
      try {
        return fs.readdirSync(/*turbopackIgnore: true*/ p);
      } catch {
        return [];
      }
    });
  // 默认从 process.env 只取本模块关心的三项，避免把整份 ProcessEnv 传进
  // 纯函数（也便于单测构造「空环境」）。
  const env: PythonEnvVars = deps.env ?? {
    UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  };
  const platform = deps.platform ?? process.platform;
  const home = deps.homedir ?? os.homedir();

  const out: PythonCandidate[] = [];
  const seen = new Set<string>();
  const push = (exe: string, via: string): void => {
    if (!exe) return;
    const key = normalizeSlashes(exe).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ exe, via });
  };

  const root = path.resolve(installRoot);

  // ① pyvenv.cfg：环境根候选逐个读，拿到基础解释器（uv 建的 venv 也写这里）。
  const envRoots = [
    root,
    path.join(root, "standalone-env"),
    path.join(root, ".venv"),
    path.join(root, "venv"),
    path.join(root, "ComfyUI", ".venv"),
    path.join(root, "ComfyUI", "venv"),
  ];
  for (const envRoot of envRoots) {
    const cfgPath = path.join(envRoot, "pyvenv.cfg");
    if (!exists(/*turbopackIgnore: true*/ cfgPath)) continue;
    const cfg = parsePyvenvCfg(readFile(cfgPath));
    const via = `${path.basename(envRoot)} 的 pyvenv.cfg`;
    for (const exe of pythonPathsFromPyvenv(cfg, platform)) {
      // home 只给出目录时可能并不真的存在该解释器，过滤掉不存在项，
      // 免得把一堆无意义的路径喂给进程表查询（查询本身不便宜）。
      if (exists(/*turbopackIgnore: true*/ exe)) push(exe, via);
    }
  }

  // ② uv 托管目录：枚举各 cpython-* 环境下的解释器。
  for (const dir of uvPythonDirs(env, platform, home)) {
    for (const entry of readdir(/*turbopackIgnore: true*/ dir)) {
      if (!/^cpython-/i.test(entry)) continue;
      const envDir = path.join(dir, entry);
      // 形态 A：<env>/python.exe；形态 B：<env>/install/python.exe。
      for (const rel of platform === "win32"
        ? ["python.exe", path.join("install", "python.exe")]
        : [
            "bin/python3",
            "bin/python",
            path.join("install", "bin", "python3"),
          ]) {
        const exe = path.join(envDir, rel);
        if (exists(/*turbopackIgnore: true*/ exe)) {
          push(exe, "uv 托管的解释器");
        }
      }
    }
  }

  return out;
}

/**
 * uv 的「解释器托管目录」候选列表（按优先级）。
 *   - `UV_PYTHON_INSTALL_DIR` 显式指定时优先（与 uv 自身语义一致）；
 *   - Windows 默认 `%LOCALAPPDATA%\uv\python`；
 *   - POSIX 默认 `$XDG_DATA_HOME/uv/python` / `~/.local/share/uv/python`。
 * 去重后返回，调用方按序枚举。
 */
export function uvPythonDirs(
  env: PythonEnvVars,
  platform: NodeJS.Platform,
  homedir: string,
): string[] {
  const dirs: string[] = [];
  const add = (d: string | undefined): void => {
    if (d && !dirs.includes(d)) dirs.push(d);
  };
  add(env.UV_PYTHON_INSTALL_DIR);
  if (platform === "win32") {
    const localAppData =
      env.LOCALAPPDATA ?? path.join(homedir, "AppData", "Local");
    add(path.join(localAppData, "uv", "python"));
  } else {
    const dataHome = env.XDG_DATA_HOME ?? path.join(homedir, ".local", "share");
    add(path.join(dataHome, "uv", "python"));
  }
  return dirs;
}
