// resolveComfyLaunchPlan 路径解析单测：注入虚拟 exists 函数，覆盖
// 便携版 / 桌面版实例根 / venv 三种布局。

import path from "path";
import { describe, expect, it } from "vitest";
import { resolveComfyLaunchPlan } from "./launch-path";

type Fs = Set<string>;
/** 构造一组「存在」的路径，用于注入 exists 回调。 */
function fakeFs(...paths: string[]): Fs {
  return new Set(paths.map((p) => path.normalize(p)));
}

function makeExists(fsSet: Fs) {
  return (p: string): boolean => fsSet.has(path.normalize(p));
}

describe("resolveComfyLaunchPlan", () => {
  it("便携版：python_embeded/python.exe + main.py 同层", () => {
    const root = path.normalize("/comfy/portable");
    const fsSet = fakeFs(
      root,
      path.join(root, "main.py"),
      path.join(root, "python_embeded", "python.exe")
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));

    expect(plan).not.toHaveProperty("error");
    if ("error" in plan) return;
    expect(plan.cmd).toBe(path.join(root, "python_embeded", "python.exe"));
    expect(plan.mainPy).toBe(path.join(root, "main.py"));
    expect(plan.cwd).toBe(root);
  });

  it("桌面版实例根：配置根含 ComfyUI/main.py 与 standalone-env/python.exe", () => {
    const root = path.normalize("/comfy/instances/ComfyUI2");
    const fsSet = fakeFs(
      root,
      path.join(root, "ComfyUI", "main.py"),
      path.join(root, "standalone-env", "python.exe")
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));

    expect(plan).not.toHaveProperty("error");
    if ("error" in plan) return;
    expect(plan.cmd).toBe(path.join(root, "standalone-env", "python.exe"));
    expect(plan.mainPy).toBe(path.join(root, "ComfyUI", "main.py"));
    expect(plan.cwd).toBe(path.join(root, "ComfyUI"));
  });

  it("桌面版源码根：配置指向 ComfyUI/ 源码，解释器在父级实例根 standalone-env", () => {
    const srcDir = path.normalize("/comfy/instances/ComfyUI2/ComfyUI");
    const instRoot = path.dirname(srcDir);
    const fsSet = fakeFs(
      srcDir,
      path.join(srcDir, "main.py"),
      path.join(instRoot, "standalone-env", "python.exe")
    );
    const plan = resolveComfyLaunchPlan(srcDir, makeExists(fsSet));

    expect(plan).not.toHaveProperty("error");
    if ("error" in plan) return;
    expect(plan.cmd).toBe(path.join(instRoot, "standalone-env", "python.exe"));
    expect(plan.mainPy).toBe(path.join(srcDir, "main.py"));
  });

  it("venv 布局：.venv/Scripts/python.exe + main.py", () => {
    const root = path.normalize("/comfy/venv");
    const fsSet = fakeFs(
      root,
      path.join(root, "main.py"),
      path.join(root, ".venv", "Scripts", "python.exe")
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));

    expect(plan).not.toHaveProperty("error");
    if ("error" in plan) return;
    expect(plan.cmd).toBe(path.join(root, ".venv", "Scripts", "python.exe"));
  });

  it("桌面版 vendor 构建：ComfyUI/.venv 优先于 standalone-env", () => {
    const root = path.normalize("/comfy/vendor");
    const fsSet = fakeFs(
      root,
      path.join(root, "ComfyUI", "main.py"),
      path.join(root, "ComfyUI", ".venv", "Scripts", "python.exe"),
      path.join(root, "standalone-env", "python.exe")
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));

    expect(plan).not.toHaveProperty("error");
    if ("error" in plan) return;
    // .venv 排在 standalone-env 之前（vendor 构建的 torch 在 .venv 里）
    expect(plan.cmd).toBe(path.join(root, "ComfyUI", ".venv", "Scripts", "python.exe"));
  });

  it("桌面版 Desktop 实例（.comfyui-desktop-2 标记）：standalone-env 优先于 .venv", () => {
    const root = path.normalize("/comfy/instances/ComfyUI2");
    const fsSet = fakeFs(
      root,
      path.join(root, ".comfyui-desktop-2"),
      path.join(root, "manifest.json"),
      path.join(root, "ComfyUI", "main.py"),
      path.join(root, "ComfyUI", ".venv", "Scripts", "python.exe"),
      path.join(root, "standalone-env", "python.exe")
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));

    expect(plan).not.toHaveProperty("error");
    if ("error" in plan) return;
    // Desktop 实例 canonical 运行时是 standalone-env，即使源码内 .venv 存在也优先
    expect(plan.cmd).toBe(path.join(root, "standalone-env", "python.exe"));
    expect(plan.mainPy).toBe(path.join(root, "ComfyUI", "main.py"));
  });

  it("路径不存在：返回错误", () => {
    const plan = resolveComfyLaunchPlan("/not/exist", makeExists(fakeFs()));
    expect(plan).toHaveProperty("error");
  });

  it("有 main.py 但无 python.exe：返回错误", () => {
    const root = path.normalize("/comfy/no-py");
    const fsSet = fakeFs(root, path.join(root, "main.py"));
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));
    expect(plan).toHaveProperty("error");
    const err = (plan as { error: string }).error;
    expect(err).toContain("python.exe");
  });
});
