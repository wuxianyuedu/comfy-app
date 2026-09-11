// 解释器反查单测（ISSUE #344 第 5 级判据）。
//
// 为什么值得单独测：Comfy Desktop 的 standalone-env 由 uv 创建，解释器落在
// uv 托管目录（不在实例根），按「实例根下解释器路径」查进程表必然落空。
// 这条「从 pyvenv.cfg / uv 缓存反查解释器」的链子读代码看不出错，只有把
// 「配置文本 → 候选路径」钉成断言才拦得住回归。
//
// 夹具一律用 path.resolve 构造（与 launch-path.test.ts 同因：Windows 上
// normalize 不补盘符，注入的 exists 会永远 miss）。

import path from "path";
import { describe, expect, it } from "vitest";
import {
  collectComfyPythonCandidates,
  parsePyvenvCfg,
  pythonPathsFromPyvenv,
  uvPythonDirs,
} from "./env-python";

describe("parsePyvenvCfg — 解析 venv 的基础解释器线索", () => {
  it("读出 home / executable（值含 Windows 反斜杠与空格）", () => {
    const cfg = parsePyvenvCfg(
      [
        "home = C:\\Users\\me\\AppData\\Local\\uv\\python\\cpython-3.12.8-windows-x86_64-none",
        "include-system-site-packages = false",
        "version = 3.12.8",
        "executable = C:\\Users\\me\\AppData\\Local\\uv\\python\\cpython-3.12.8-windows-x86_64-none\\python.exe",
      ].join("\n"),
    );
    expect(cfg.home).toBe(
      "C:\\Users\\me\\AppData\\Local\\uv\\python\\cpython-3.12.8-windows-x86_64-none",
    );
    expect(cfg.executable).toBe(
      "C:\\Users\\me\\AppData\\Local\\uv\\python\\cpython-3.12.8-windows-x86_64-none\\python.exe",
    );
  });

  it("键名大小写不敏感、忽略注释与未知键、缺字段为 null", () => {
    const cfg = parsePyvenvCfg(
      ["# 注释", "HOME = /usr/bin", "weird = x", ""].join("\r\n"),
    );
    expect(cfg.home).toBe("/usr/bin");
    expect(cfg.executable).toBeNull();
  });

  it("空内容 / 无 = 的行不炸，返回全 null", () => {
    expect(parsePyvenvCfg("")).toEqual({ home: null, executable: null });
    expect(parsePyvenvCfg("garbage line")).toEqual({
      home: null,
      executable: null,
    });
  });
});

describe("pythonPathsFromPyvenv — 由 cfg 推出解释器候选", () => {
  it("Windows：executable 直用，home 补 python/pythonw（含 install/ 一层）", () => {
    const list = pythonPathsFromPyvenv(
      {
        home: "C:\\uv\\cpython-3.12",
        executable: "C:\\uv\\cpython-3.12\\python.exe",
      },
      "win32",
    );
    expect(list).toContain("C:\\uv\\cpython-3.12\\python.exe");
    expect(list).toContain(path.join("C:\\uv\\cpython-3.12", "pythonw.exe"));
    expect(list).toContain(
      path.join("C:\\uv\\cpython-3.12", "install", "python.exe"),
    );
  });

  it("POSIX：补 bin 下的 python/python3", () => {
    const list = pythonPathsFromPyvenv(
      { home: "/opt/py", executable: null },
      "linux",
    );
    expect(list).toContain(path.join("/opt/py", "python"));
    expect(list).toContain(path.join("/opt/py", "python3"));
  });

  it("两者都缺 → 空数组（不凭空造路径）", () => {
    expect(pythonPathsFromPyvenv({ home: null, executable: null })).toEqual([]);
  });
});

describe("uvPythonDirs — uv 托管目录候选", () => {
  it("Windows 默认 %LOCALAPPDATA%\\uv\\python，且显式环境变量优先", () => {
    const dirs = uvPythonDirs(
      {
        LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
        UV_PYTHON_INSTALL_DIR: "D:\\uvpy",
      },
      "win32",
      "C:\\Users\\me",
    );
    expect(dirs[0]).toBe("D:\\uvpy");
    expect(dirs).toContain(
      path.join("C:\\Users\\me\\AppData\\Local", "uv", "python"),
    );
  });

  it("POSIX 默认走 XDG_DATA_HOME / ~/.local/share", () => {
    const dirs = uvPythonDirs({}, "linux", "/home/me");
    expect(dirs).toEqual([
      path.join("/home/me", ".local", "share", "uv", "python"),
    ]);
  });

  it("无环境变量时 Windows 用 homedir 拼 AppData\\Local", () => {
    const dirs = uvPythonDirs({}, "win32", "C:\\Users\\me");
    expect(dirs).toEqual([
      path.join("C:\\Users\\me", "AppData", "Local", "uv", "python"),
    ]);
  });
});

describe("collectComfyPythonCandidates — 反查到真正在跑的解释器", () => {
  /** 构造注入用的 fs 桩：exists 按集合，readFile/readdir 按表。 */
  function fakeFs(opts: {
    exists: string[];
    files?: Record<string, string>;
    dirs?: Record<string, string[]>;
  }) {
    const existsSet = new Set(opts.exists.map((p) => path.normalize(p)));
    return {
      exists: (p: string) => existsSet.has(path.normalize(p)),
      readFile: (p: string) => opts.files?.[path.normalize(p)] ?? "",
      readdir: (p: string) => opts.dirs?.[path.normalize(p)] ?? [],
    };
  }

  it("读 standalone-env 的 pyvenv.cfg，反查出 uv 托管解释器（桌面版主路径）", () => {
    const root = path.resolve("/comfy/instances/ComfyUI2");
    const envRoot = path.join(root, "standalone-env");
    const uvExe = path.join(
      path.resolve("/uv/python"),
      "cpython-3.12.8-windows-x86_64-none",
      "install",
      "python.exe",
    );
    const cfgText = [
      `home = ${path.dirname(path.dirname(uvExe))}`,
      `executable = ${uvExe}`,
    ].join("\n");

    const cands = collectComfyPythonCandidates(root, {
      platform: "win32",
      homedir: path.resolve("/home/me"),
      env: {},
      ...fakeFs({
        exists: [path.join(envRoot, "pyvenv.cfg"), uvExe],
        files: { [path.normalize(path.join(envRoot, "pyvenv.cfg"))]: cfgText },
      }),
    });

    expect(cands.map((c) => c.exe)).toContain(uvExe);
    // 来路要能看出是 pyvenv.cfg 反查出来的（状态行提示 / 诊断用）。
    expect(cands.find((c) => c.exe === uvExe)?.via).toContain("pyvenv.cfg");
  });

  it("pyvenv.cfg 指向不存在的解释器时丢弃（不喂给进程表查询）", () => {
    const root = path.resolve("/comfy/v");
    const cfgPath = path.join(root, "pyvenv.cfg");
    const ghost = path.resolve("/nope/python.exe");
    const cands = collectComfyPythonCandidates(root, {
      platform: "linux",
      homedir: path.resolve("/home/me"),
      env: {},
      ...fakeFs({
        exists: [cfgPath],
        files: { [path.normalize(cfgPath)]: `executable = ${ghost}` },
      }),
    });
    expect(cands.map((c) => c.exe)).not.toContain(ghost);
  });

  it("枚举 uv 托管目录下的 cpython-* 环境（两种解释器布局都认）", () => {
    const root = path.resolve("/comfy/v");
    const uvDir = path.join(
      path.resolve("/home/me"),
      ".local",
      "share",
      "uv",
      "python",
    );
    const e1 = path.join(
      uvDir,
      "cpython-3.12.8-linux-x86_64-gnu",
      "bin",
      "python3",
    );
    const e2 = path.join(
      uvDir,
      "cpython-3.11.9-linux-x86_64-gnu",
      "install",
      "bin",
      "python3",
    );

    const cands = collectComfyPythonCandidates(root, {
      platform: "linux",
      homedir: path.resolve("/home/me"),
      env: {},
      ...fakeFs({
        exists: [e1, e2],
        dirs: {
          [path.normalize(uvDir)]: [
            "cpython-3.12.8-linux-x86_64-gnu",
            "cpython-3.11.9-linux-x86_64-gnu",
            "not-a-python",
          ],
        },
      }),
    });
    const exes = cands.map((c) => c.exe);
    expect(exes).toContain(e1);
    expect(exes).toContain(e2);
    expect(cands.find((c) => c.exe === e1)?.via).toContain("uv");
  });

  it("非 cpython-* 目录跳过；去重后同一解释器只出现一次", () => {
    const root = path.resolve("/comfy/v");
    const uvDir = path.join(
      path.resolve("/home/me"),
      ".local",
      "share",
      "uv",
      "python",
    );
    const exe = path.join(uvDir, "cpython-3.12.0-linux-gnu", "bin", "python3");
    // pyvenv.cfg 与 uv 枚举同时指向同一个解释器 → 只保留一条。
    const cfgPath = path.join(root, "pyvenv.cfg");
    const cands = collectComfyPythonCandidates(root, {
      platform: "linux",
      homedir: path.resolve("/home/me"),
      env: {},
      ...fakeFs({
        exists: [cfgPath, exe],
        files: { [path.normalize(cfgPath)]: `executable = ${exe}` },
        dirs: { [path.normalize(uvDir)]: ["cpython-3.12.0-linux-gnu"] },
      }),
    });
    expect(cands.filter((c) => c.exe === exe)).toHaveLength(1);
  });

  it("什么都查不到 → 空数组（纯尽力而为，不抛错）", () => {
    const cands = collectComfyPythonCandidates(path.resolve("/comfy/none"), {
      platform: "win32",
      homedir: path.resolve("/home/me"),
      env: {},
      ...fakeFs({ exists: [] }),
    });
    expect(cands).toEqual([]);
  });
});
