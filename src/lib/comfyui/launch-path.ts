// ComfyUI 启动路径解析：从 comfyuiPath 推导「源码根 + Python 解释器」。
// 与 lifecycle.ts 解耦，保持纯函数（无 spawn / logger 等副作用），可独立单测。

import fs from "fs";
import path from "path";

export type ComfyLaunchPlan = {
  cmd: string;
  baseArgs: string[];
  cwd: string;
  mainPy: string;
};

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

  // 对每个源码根枚举候选解释器目录。
  // 优先级：python_embeded（便携）→ .venv/venv（源码内 venv/vendor）→
  // standalone-env（桌面实例根）——保持原实现 vendor-venv 优先于 standalone-env。
  for (const src of sourceRoots) {
    const parent = path.dirname(src); // 桌面版场景下 = 实例根
    const pyDirs = [
      path.join(src, "python_embeded"), // 便携：源码根内
      path.join(root, "python_embeded"), // 便携：便携根（main.py 在 ComfyUI/ 子目录）
      path.join(src, ".venv", "Scripts"), // venv/vendor：源码根内（含 torch）
      path.join(src, "venv", "Scripts"), // venv：源码根内
      path.join(root, "standalone-env"), // 桌面：实例根
      path.join(parent, "standalone-env"), // 桌面：父级实例根（兼容配了源码根）
      src, // 极简：源码根直接带 python.exe
    ];
    for (const pyDir of pyDirs) {
      const py = path.join(pyDir, "python.exe");
      if (exists(/*turbopackIgnore: true*/ py)) {
        const mainPy = path.join(src, "main.py");
        return { cmd: py, baseArgs: ["-s", mainPy], cwd: src, mainPy };
      }
    }
  }

  return {
    error:
      `在 ${root} 下找到 main.py 但找不到可用的 python.exe。` +
      "支持：python_embeded\\python.exe（便携版）、standalone-env\\python.exe（桌面版，配置实例根）、.venv\\Scripts\\python.exe（venv）。",
  };
}
