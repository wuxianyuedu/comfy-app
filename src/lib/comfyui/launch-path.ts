// ComfyUI 启动路径解析：从 comfyuiPath 推导「源码根 + Python 解释器」。
// 与 lifecycle.ts 解耦，保持纯函数（无 spawn / logger 等副作用），可独立单测。

import "server-only";
import fs from "fs";
import path from "path";

export type ComfyLaunchPlan = {
  cmd: string;
  baseArgs: string[];
  cwd: string;
  mainPy: string;
  /** 所选解释器的 site-packages 里是否找到了 torch（依赖齐备的标志）。
   *  false = 没找到——启动大概率因缺依赖秒退，调用方可据此提前提示。 */
  hasDeps?: boolean;
};

/**
 * 候选解释器环境是否装了 torch：依赖都在 <环境根>\Lib\site-packages
 * （Windows 大小写不敏感）。环境根的判断：venv 布局的 python.exe 在
 * <env>\Scripts（Windows）/ <env>\bin（POSIX），环境根是其上一级；
 * 嵌入式 / standalone-env 的 python.exe 直接位于环境根。
 */
/** 解释器可执行名候选：Windows 是 python.exe；POSIX 是 bin/python（win 无后缀）。
 *  不含 pythonw / pythonw.exe —— 它们吞掉 stdout/stderr，ComfyUI 启动出错时
 *  看不到任何日志（排查不了），工坊只把 ComfyUI 当后端服务用。 */
const INTERPRETER_NAMES: Record<"win32" | "posix", readonly string[]> = {
  win32: ["python.exe"],
  posix: ["python3", "python"],
};

/** venv 目录候选（含平台特定的可执行子目录）。
 *  Windows 的 venv 把解释器放 `Scripts/`，POSIX 放 `bin/` —— 只认 `Scripts`
 *  时，Linux/macOS 上明明建好的 .venv 会被判「找不到解释器」。 */
function venvDirs(sourceRoot: string): string[] {
  return [
    path.join(sourceRoot, ".venv", "Scripts"),
    path.join(sourceRoot, ".venv", "bin"),
    path.join(sourceRoot, "venv", "Scripts"),
    path.join(sourceRoot, "venv", "bin"),
  ];
}

/** 在候选目录里找可用的解释器：按 INTERPRETER_NAMES 逐个试，命中即返回绝对路径。
 *  `pyDir` 可能是「解释器所在目录」（.venv/Scripts 或 .venv/bin），也可能是
 *  「环境根 / 源码根」（python_embeded、standalone-env，解释器直接在根下）。 */
function findInterpreterIn(
  pyDir: string,
  exists: (p: string) => boolean
): string | null {
  for (const names of Object.values(INTERPRETER_NAMES)) {
    for (const name of names) {
      const candidate = path.join(pyDir, name);
      if (exists(/*turbopackIgnore: true*/ candidate)) return candidate;
    }
  }
  return null;
}

export function envHasTorch(
  pyDir: string,
  exists: (p: string) => boolean
): boolean {
  const base = path.basename(pyDir).toLowerCase();
  const envRoot =
    base === "scripts" || base === "bin" ? path.dirname(pyDir) : pyDir;
  // 依赖目录随平台命名：
  //   Windows → <envRoot>/Lib/site-packages（大小写不敏感）
  //   POSIX   → <envRoot>/lib/python3.x/site-packages（带版本号子目录）
  // 只看 Windows 形态时，Linux 上明明装了 torch 也会判 hasDeps=false，
  // 退化成「按优先级选中空壳解释器」（启动即 No module named 'torch'）。
  if (
    exists(
      /*turbopackIgnore: true*/ path.join(envRoot, "Lib", "site-packages", "torch")
    )
  ) {
    return true;
  }
  return sitePackagesDirs(envRoot, exists).some((sp) =>
    exists(/*turbopackIgnore: true*/ path.join(sp, "torch"))
  );
}

/** 枚举环境根下的 POSIX site-packages 目录（`lib/python3.x/site-packages`）。
 *
 *  只用 `exists` 探有限个版本号，不做目录枚举 —— 原因有二：
 *   ① 本模块整体是「注入 exists 的纯函数」，用真实 fs.readdirSync 会让注入了
 *      虚拟路径的单测全部 miss（依赖判定的两个用例就是这么红起来的）；
 *   ② Turbopack 对目录枚举的静态分析会退化成全项目追踪（仓库既有约定：
 *      动态文件访问要收敛，见 docs §5 「pnpm run build 卡在 Collecting page data」）。
 *  版本号候选覆盖 3.9~3.14：够用且恒定，不做无边界探测。 */
const PYTHON_MINOR_CANDIDATES: readonly string[] = [
  "3.9",
  "3.10",
  "3.11",
  "3.12",
  "3.13",
  "3.14",
];

export function sitePackagesDirs(
  envRoot: string,
  exists: (p: string) => boolean
): string[] {
  const out: string[] = [];
  for (const minor of PYTHON_MINOR_CANDIDATES) {
    const sp = path.join(envRoot, "lib", `python${minor}`, "site-packages");
    // 只收实际存在的，免得把一堆猜测路径喂给下游（判 torch 时还要再 exists 一次）。
    if (exists(/*turbopackIgnore: true*/ sp)) out.push(sp);
  }
  return out;
}

/**
 * 从 comfyuiPath 推导启动命令。
 *
 * comfyuiPath 语义（桌面版推荐配「实例根」）：
 *   - 便携版 / venv：指向「源码根」——目录直接含 main.py，python_embeded
 *     或 .venv 与之同层（或 python_embeded 在便携根、main.py 在
 *     ComfyUI/ 子目录）。
 *   - ComfyUI Desktop 实例根：目录含 ComfyUI/ 子目录（main.py 在其中）
 *     与 standalone-env/（运行时解释器）。例如：
 *       ComfyUI-Installs/ComfyUI2/
 *       ├── ComfyUI/main.py
 *       └── standalone-env/python.exe
 *     把 comfyuiPath 配到实例根即可，无需精确到源码子目录。
 *   也兼容反向配置（把 comfyuiPath 指向实例内的 ComfyUI/ 源码根）——
 *   解释器会向上到父级实例根查找。
 *
 * 解释器选择（两段式）：在候选优先级之内，优先选 site-packages 里装有
 * torch 的环境——依赖位置随安装方式漂移，固定优先级会选中空壳解释器
 * （启动即 ModuleNotFoundError: No module named 'torch'）。全缺时按原
 * 优先级返回并在 hasDeps=false 标记，由调用方提示用户。
 *
 * 解释器一律解析为 python.exe（不用 pythonw.exe——后者吞掉 stdout/stderr，
 * ComfyUI 启动出错时看不到任何日志，无法排查）。工坊/工作室只把 ComfyUI 当
 * 后端服务（python.exe + main.py 起的是 server，不是桌面版 GUI）。
 */
export function resolveComfyLaunchPlan(
  installDir: string,
  exists: (p: string) => boolean = fs.existsSync
): ComfyLaunchPlan | { error: string } {
  const root = path.resolve(installDir);
  if (!exists(/*turbopackIgnore: true*/ root)) {
    return { error: `ComfyUI 路径不存在：${root}（请在设置页检查）` };
  }

  // 枚举「源码根」候选：配置根本身直接有 main.py，或 <root>/ComfyUI/main.py。
  const hasMain = (dir: string) => exists(/*turbopackIgnore: true*/ path.join(dir, "main.py"));
  const sourceRoots: string[] = [];
  if (hasMain(root)) sourceRoots.push(root);
  const comfySub = path.join(root, "ComfyUI");
  if (hasMain(comfySub)) sourceRoots.push(comfySub);
  if (sourceRoots.length === 0) {
    return {
      error:
        `在 ${root} 下找不到 main.py（不是有效的 ComfyUI 安装）。` +
        "桌面版请配置实例根目录（含 ComfyUI/ 子目录），便携版配置含 main.py 的目录。",
    };
  }

  // 检测是否为 ComfyUI Desktop 实例根（含 .comfyui-desktop-* 或 manifest.json）。
  // Desktop 实例的 canonical 运行时是 standalone-env；源码内若有 .venv 只是
  // 附带残留，不应优先于 standalone-env。
  const isDesktopInstance =
    exists(/*turbopackIgnore: true*/ path.join(root, ".comfyui-desktop-2")) ||
    exists(/*turbopackIgnore: true*/ path.join(root, "manifest.json"));

  // 对每个源码根枚举候选解释器目录（已含平台特定的可执行名）。
  // Desktop 实例：standalone-env 优先（ComfyUI 的官方运行时）。
  // 非 Desktop：python_embeded（便携）→ .venv/venv（源码内）→ standalone-env。
  for (const src of sourceRoots) {
    const parent = path.dirname(src); // 桌面版场景下 = 实例根
    const pyDirs = isDesktopInstance
      ? [
          path.join(root, "standalone-env"), // 桌面：实例根的官方运行时
          path.join(parent, "standalone-env"), // 桌面：父级实例根（兼容配了源码根）
          ...venvDirs(src), // 兜底：源码内 venv
          path.join(src, "python_embeded"), // 便携兜底
          path.join(root, "python_embeded"),
          src, // 极简：源码根直接带解释器
        ]
      : [
          path.join(src, "python_embeded"), // 便携：源码根内
          path.join(root, "python_embeded"), // 便携：便携根（main.py 在 ComfyUI/ 子目录）
          ...venvDirs(src), // venv/vendor：源码根内（含 torch）
          path.join(root, "standalone-env"), // 桌面：实例根
          path.join(parent, "standalone-env"), // 桌面：父级实例根（兼容配了源码根）
          src, // 极简：源码根直接带解释器
        ];
    const present = pyDirs
      .map((pyDir) => ({ pyDir, py: findInterpreterIn(pyDir, exists) }))
      .filter((c): c is { pyDir: string; py: string } => c.py !== null);
    if (present.length === 0) continue;
    // 两段选择：优先挑「装了 torch」的解释器——依赖装在哪个环境随安装方式
    // 漂移（老桌面在 standalone-env，vendor / 新版桌面在 ComfyUI/.venv，便携在
    // python_embeded，Linux 在 .venv），固定优先级会选中空壳解释器（No module
    // named 'torch' 秒退）。候选里谁都缺 torch 时退回原优先级，失败走启动日志的
    // 真实报错。
    const withDeps = present.find((c) => envHasTorch(c.pyDir, exists));
    const chosen = withDeps ?? present[0]!;
    const mainPy = path.join(src, "main.py");
    return {
      cmd: chosen.py,
      baseArgs: ["-s", mainPy],
      cwd: src,
      mainPy,
      hasDeps: !!withDeps,
    };
  }

  return {
    error:
      `在 ${root} 下找到 main.py 但找不到可用的 Python 解释器。` +
      "支持：python_embeded/python(.exe)（便携版）、standalone-env/python(.exe)" +
      "（桌面版，配置实例根）、.venv/Scripts/python.exe（Windows venv）、" +
      ".venv/bin/python（Linux/macOS venv）。",
  };
}