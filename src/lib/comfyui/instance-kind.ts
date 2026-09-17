// ComfyUI 安装形态识别：把 comfyuiPath 归类为「桌面版 / 便携版 / venv」。
// 与 launch-path.ts（只关心解释器）与 lifecycle.ts（只关心拉起）解耦，保持纯
// 函数（无 spawn / logger / 网络副作用），可独立单测。
//
// 用途：
//   - 设置页在配置好 comfyuiPath 后展示「桌面版 / 便携版」形态徽标；
//   - 桌面版实例的启动参数/端口由 Comfy Desktop 元数据（installations.json）
//     决定，设置页不暴露端口/启动参数输入（见 desktop-instance.ts）；
//   - 便携版 / venv 沿用用户手填的端口与启动参数。
//
// 判定口径（按优先级，见 classifyComfyInstall）：
//   desktop = 带桌面标记（.comfyui-desktop-* / manifest.json），或采用 Comfy
//              Desktop 的 canonical 布局（ComfyUI/ 源码子目录 + standalone-env）；
//   portable = python_embeded（便携运行时）与 main.py 同层；
//   venv = 源码内 .venv / venv（自建 Python 虚拟环境）；
//   unknown = 无 main.py（不是有效安装）等无法判定的情形。

import "server-only";
import fs from "fs";
import path from "path";

export type ComfyInstallKind = "desktop" | "portable" | "venv" | "unknown";

export type ComfyInstallClassify = {
  kind: ComfyInstallKind;
  /**
   * 可判定的「实例根」：comfyuiPath 指向实例根时即它本身；指向实例内
   * ComfyUI/ 源码根时会向上取父级。桌面版元数据读取据此定位。
   */
  instanceRoot: string | null;
  /** 命中的桌面标记文件完整路径（如 <实例根>/.comfyui-desktop-2）。
   *  仅 kind === "desktop" 且存在标记文件时非空；用于反查实例 ID →
   *  Comfy Desktop installations.json（见 desktop-instance.ts）。 */
  instanceIdFile: string | null;
};

/** 从目录里找出桌面标记文件路径（优先 .comfyui-desktop-*，作为实例 ID 源）。 */
function pickDesktopFile(
  dir: string,
  exists: (p: string) => boolean,
): string | null {
  const candidates = [
    path.join(dir, ".comfyui-desktop-2"),
    path.join(dir, ".comfyui-desktop-1"),
    path.join(dir, ".comfyui-desktop-3"),
  ];
  for (const c of candidates) {
    if (exists(/*turbopackIgnore: true*/ c)) return c;
  }
  // manifest.json 可作为存在标记，但它不是实例 ID 源，返回 null 让上层知道
  // 「没有可反查实例 ID 的文件」。
  if (exists(/*turbopackIgnore: true*/ path.join(dir, "manifest.json"))) {
    return path.join(dir, "manifest.json");
  }
  return null;
}

function hasMainPy(dir: string, exists: (p: string) => boolean): boolean {
  return exists(/*turbopackIgnore: true*/ path.join(dir, "main.py"));
}

/**
 * 识别 comfyuiPath 的安装形态。返回 kind 及可用于进一步读元数据的
 * instanceRoot / instanceIdFile。
 */
export function classifyComfyInstall(
  installDir: string,
  exists: (p: string) => boolean = fs.existsSync,
): ComfyInstallClassify {
  const root = path.resolve(installDir);
  if (!exists(/*turbopackIgnore: true*/ root)) {
    return { kind: "unknown", instanceRoot: null, instanceIdFile: null };
  }

  // 候选「实例根」：comfyuiPath 指向源码根（root 直接含 main.py）时其父级
  // 可能是桌面实例根；否则实例根就是配置根。
  const hasSubMain = hasMainPy(path.join(root, "ComfyUI"), exists);
  const hasRootMain = hasMainPy(root, exists);
  if (!hasRootMain && !hasSubMain) {
    // 连 main.py 都没有——不是有效 ComfyUI 安装，无法判定形态。
    return { kind: "unknown", instanceRoot: root, instanceIdFile: null };
  }

  // 优先把 root 当实例根：带桌面标记 → desktop。
  const rootMarker = pickDesktopFile(root, exists);
  if (rootMarker) {
    return {
      kind: "desktop",
      instanceRoot: root,
      instanceIdFile: isInstanceIdSource(rootMarker) ? rootMarker : null,
    };
  }
  // root 本身不带标记但指向源码根（root/main.py），父级带桌面标记 → desktop。
  if (!hasSubMain) {
    const parent = path.dirname(root);
    const parentMarker = pickDesktopFile(parent, exists);
    if (parentMarker) {
      return {
        kind: "desktop",
        instanceRoot: parent,
        instanceIdFile: isInstanceIdSource(parentMarker) ? parentMarker : null,
      };
    }
  }

  // 未命中标记文件时，按「目录形态」判定：
  //   desktop 布局 = ComfyUI/ 源码子目录 + standalone-env（Comfy Desktop
  //                  canonical 运行时；注意与 root 直接放 main.py 的便携区分开）。
  //   portable = python_embeded；venv = .venv / venv。
  const desktopLayout =
    hasSubMain &&
    exists(
      /*turbopackIgnore: true*/ path.join(root, "standalone-env", "python.exe"),
    );
  if (desktopLayout) {
    return { kind: "desktop", instanceRoot: root, instanceIdFile: null };
  }

  // 便携 / venv：解释器与 main.py 同层（源码根或其父级）。
  const bases = [root, path.dirname(root)];
  for (const base of bases) {
    if (
      exists(
        /*turbopackIgnore: true*/ path.join(
          base,
          "python_embeded",
          "python.exe",
        ),
      )
    ) {
      return { kind: "portable", instanceRoot: root, instanceIdFile: null };
    }
  }
  for (const base of bases) {
    if (
      exists(
        /*turbopackIgnore: true*/ path.join(
          base,
          ".venv",
          "Scripts",
          "python.exe",
        ),
      ) ||
      exists(
        /*turbopackIgnore: true*/ path.join(
          base,
          "venv",
          "Scripts",
          "python.exe",
        ),
      )
    ) {
      return { kind: "venv", instanceRoot: root, instanceIdFile: null };
    }
  }

  // 有 main.py 但无上述特征：按便携兜底。
  return { kind: "portable", instanceRoot: root, instanceIdFile: null };
}

/** 标记文件是否可作为实例 ID 的读取源（只有 .comfyui-desktop-* 是 ID 文件）。 */
function isInstanceIdSource(file: string): boolean {
  return /\.comfyui-desktop-\d+$/.test(path.basename(file));
}
