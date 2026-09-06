// classifyComfyInstall 形态识别单测：注入虚拟 exists，覆盖桌面版 / 便携版 / venv
// / 无效路径四类。夹具根一律用 path.resolve（Windows normalize 不补盘符会让注入
// 的 exists 永远 miss）。

import path from "path";
import { describe, expect, it } from "vitest";
import { classifyComfyInstall } from "./instance-kind";

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
