// classifyComfyInstall 形态识别单测：注入虚拟 exists，覆盖桌面版 / 便携版 / venv
// / 无效路径四类。夹具根一律用 path.resolve（Windows normalize 不补盘符会让注入
// 的 exists 永远 miss）。

import path from "path";
import { describe, expect, it } from "vitest";
import { classifyComfyInstall, describeComfyInstance } from "./instance-kind";

function fakeFs(...paths: string[]): Set<string> {
  return new Set(paths.map((p) => path.normalize(p)));
}
function makeExists(set: Set<string>) {
  return (p: string): boolean => set.has(path.normalize(p));
}

describe("classifyComfyInstall", () => {
  it("桌面版：实例根带 .comfyui-desktop-2 标记 → desktop + instanceIdFile", () => {
    const root = path.resolve("/comfy/instances/ComfyUI2");
    const fsSet = fakeFs(
      root,
      path.join(root, ".comfyui-desktop-2"),
      path.join(root, "ComfyUI", "main.py"),
      path.join(root, "standalone-env", "python.exe"),
    );
    const c = classifyComfyInstall(root, makeExists(fsSet));
    expect(c.kind).toBe("desktop");
    expect(c.instanceRoot).toBe(root);
    expect(c.instanceIdFile).toBe(path.join(root, ".comfyui-desktop-2"));
  });

  it("桌面版：comfyuiPath 指向实例内 ComfyUI/ 源码 → 父级实例根 + 标记上溯", () => {
    const instRoot = path.resolve("/comfy/instances/ComfyUI2");
    const srcDir = path.join(instRoot, "ComfyUI");
    const fsSet = fakeFs(
      srcDir,
      path.join(srcDir, "main.py"),
      path.join(instRoot, ".comfyui-desktop-2"),
      path.join(instRoot, "standalone-env", "python.exe"),
    );
    const c = classifyComfyInstall(srcDir, makeExists(fsSet));
    expect(c.kind).toBe("desktop");
    expect(c.instanceRoot).toBe(instRoot);
    expect(c.instanceIdFile).toBe(path.join(instRoot, ".comfyui-desktop-2"));
  });

  it("桌面版布局：无标记但 ComfyUI/ 子目录 + standalone-env → desktop（无 ID 文件）", () => {
    const root = path.resolve("/comfy/instances/Manual");
    const fsSet = fakeFs(
      root,
      path.join(root, "ComfyUI", "main.py"),
      path.join(root, "standalone-env", "python.exe"),
    );
    const c = classifyComfyInstall(root, makeExists(fsSet));
    expect(c.kind).toBe("desktop");
    expect(c.instanceIdFile).toBeNull();
  });

  it("便携版：main.py + python_embeded 同层 → portable", () => {
    const root = path.resolve("/comfy/portable");
    const fsSet = fakeFs(
      root,
      path.join(root, "main.py"),
      path.join(root, "python_embeded", "python.exe"),
    );
    const c = classifyComfyInstall(root, makeExists(fsSet));
    expect(c.kind).toBe("portable");
    expect(c.instanceRoot).toBe(root);
  });

  it("venv：main.py + .venv/Scripts/python.exe → venv", () => {
    const root = path.resolve("/comfy/venv");
    const fsSet = fakeFs(
      root,
      path.join(root, "main.py"),
      path.join(root, ".venv", "Scripts", "python.exe"),
    );
    const c = classifyComfyInstall(root, makeExists(fsSet));
    expect(c.kind).toBe("venv");
  });

  it("路径不存在：unknown", () => {
    const c = classifyComfyInstall("/no/such/dir", makeExists(fakeFs()));
    expect(c.kind).toBe("unknown");
  });
});

/* 设置页用的形态视图：只暴露「徽标文案 + 端口/启动参数是否隐藏」这两件事。
 * 它是 fs-only 的（与运行态探测分开取，见 instance-kind.ts 的说明），因此这里
 * 只覆盖「路径 → 视图」的映射边界。 */
describe("describeComfyInstance", () => {
  it("未配置路径（null / 空串 / 全空白）→ 都不判定", () => {
    for (const dir of [null, undefined, "", "   "]) {
      expect(describeComfyInstance(dir, makeExists(fakeFs()))).toEqual({
        pathConfigured: false,
        instanceType: null,
        desktopManaged: false,
      });
    }
  });

  it("桌面版带实例 ID 文件 → desktop + desktopManaged", () => {
    const root = path.resolve("/comfy/instances/ComfyUI2");
    const fsSet = fakeFs(
      root,
      path.join(root, ".comfyui-desktop-2"),
      path.join(root, "ComfyUI", "main.py"),
      path.join(root, "standalone-env", "python.exe"),
    );
    expect(describeComfyInstance(root, makeExists(fsSet))).toEqual({
      pathConfigured: true,
      instanceType: "desktop",
      desktopManaged: true,
    });
  });

  it("桌面版布局但读不到实例 ID（只有 manifest.json）→ 不算 desktopManaged", () => {
    const root = path.resolve("/comfy/instances/Manual");
    const fsSet = fakeFs(
      root,
      path.join(root, "manifest.json"),
      path.join(root, "ComfyUI", "main.py"),
      path.join(root, "standalone-env", "python.exe"),
    );
    expect(describeComfyInstance(root, makeExists(fsSet))).toEqual({
      pathConfigured: true,
      instanceType: "desktop",
      desktopManaged: false,
    });
  });

  it("便携版 / venv → 各自形态，都不算 desktopManaged（端口/参数仍手填）", () => {
    const portable = path.resolve("/comfy/portable");
    const venv = path.resolve("/comfy/venv");
    const fsSet = fakeFs(
      portable,
      path.join(portable, "main.py"),
      path.join(portable, "python_embeded", "python.exe"),
      venv,
      path.join(venv, "main.py"),
      path.join(venv, ".venv", "Scripts", "python.exe"),
    );
    const exists = makeExists(fsSet);
    expect(describeComfyInstance(portable, exists)).toEqual({
      pathConfigured: true,
      instanceType: "portable",
      desktopManaged: false,
    });
    expect(describeComfyInstance(venv, exists)).toEqual({
      pathConfigured: true,
      instanceType: "venv",
      desktopManaged: false,
    });
  });

  it("不是有效安装（无 main.py）→ 路径算已配，但不判形态（UI 不显示徽标）", () => {
    const root = path.resolve("/comfy/empty");
    expect(describeComfyInstance(root, makeExists(fakeFs(root)))).toEqual({
      pathConfigured: true,
      instanceType: null,
      desktopManaged: false,
    });
  });
});
