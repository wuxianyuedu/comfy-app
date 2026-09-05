// ComfyUI 启动路径解析：从 comfyuiPath 推导「源码根 + Python 解释器」。
// 与 lifecycle.ts 解耦，保持纯函数（无 spawn / logger 等副作用），可独立单测。

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
function envHasTorch(
  pyDir: string,
  exists: (p: string) => boolean
): boolean {
  const base = path.basename(pyDir).toLowerCase();
  const envRoot =
    base === "scripts" || base === "bin" ? path.dirname(pyDir) : pyDir;
  return exists(
    /*turbopackIgnore: true*/ path.join(envRoot, "Lib", "site-packages", "torch")
  );
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

  // 对每个源码根枚举候选解释器目录。
  // Desktop 实例：standalone-env 优先（ComfyUI 的官方运行时）。
  // 非 Desktop：python_embeded（便携）→ .venv/venv（源码内）→ standalone-env。
  for (const src of sourceRoots) {
    const parent = path.dirname(src); // 桌面版场景下 = 实例根
    const pyDirs = isDesktopInstance
      ? [
          path.join(root, "standalone-env"), // 桌面：实例根的官方运行时
          path.join(parent, "standalone-env"), // 桌面：父级实例根（兼容配了源码根）
          path.join(src, ".venv", "Scripts"), // 兜底：源码内 venv
          path.join(src, "venv", "Scripts"), // 兜底：源码内 venv
          path.join(src, "python_embeded"), // 便携兜底
          path.join(root, "python_embeded"),
          src, // 极简：源码根直接带 python.exe
        ]
      : [
          path.join(src, "python_embeded"), // 便携：源码根内
          path.join(root, "python_embeded"), // 便携：便携根（main.py 在 ComfyUI/ 子目录）
          path.join(src, ".venv", "Scripts"), // venv/vendor：源码根内（含 torch）
          path.join(src, "venv", "Scripts"), // venv：源码根内
          path.join(root, "standalone-env"), // 桌面：实例根
          path.join(parent, "standalone-env"), // 桌面：父级实例根（兼容配了源码根）
          src, // 极简：源码根直接带 python.exe
        ];
    const present = pyDirs
      .map((pyDir) => ({ pyDir, py: path.join(pyDir, "python.exe") }))
      .filter((c) => exists(/*turbopackIgnore: true*/ c.py));
    if (present.length === 0) continue;
    // 两段选择：优先挑「装了 torch」的解释器——依赖装在哪个环境随安装方式
    // 漂移（老桌面在 standalone-env，vendor / 新版桌面在 ComfyUI/.venv，便携在
    // python_embeded），固定优先级会选中空壳解释器（No module named 'torch'
    // 秒退）。候选里谁都缺 torch 时退回原优先级，失败走启动日志的真实报错。
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
      `在 ${root} 下找到 main.py 但找不到可用的 python.exe。` +
      "支持：python_embeded\\python.exe（便携版）、standalone-env\\python.exe（桌面版，配置实例根）、.venv\\Scripts\\python.exe（venv）。",
  };
}