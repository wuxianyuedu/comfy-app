// resolveComfyLaunchPlan 路径解析单测：注入虚拟 exists 函数，覆盖
// 便携版 / 桌面版实例根 / venv 三种布局。
// 夹具根一律用 path.resolve（而非 normalize）：Windows 上 normalize 不补盘符，
// 而 resolveComfyLaunchPlan 内部 path.resolve 会补——两边不一致会让注入的
// exists 永远 miss（表现为「路径不存在」，在 Windows 上整组用例全红）。

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
    const root = path.resolve("/comfy/portable");
    const fsSet = fakeFs(
      root,
      path.join(root, "main.py"),
      path.join(root, "python_embeded", "python.exe"),
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));

    expect(plan).not.toHaveProperty("error");
    if ("error" in plan) return;
    expect(plan.cmd).toBe(path.join(root, "python_embeded", "python.exe"));
    expect(plan.mainPy).toBe(path.join(root, "main.py"));
    expect(plan.cwd).toBe(root);
  });

  it("桌面版实例根：配置根含 ComfyUI/main.py 与 standalone-env/python.exe", () => {
    const root = path.resolve("/comfy/instances/ComfyUI2");
    const fsSet = fakeFs(
      root,
      path.join(root, "ComfyUI", "main.py"),
      path.join(root, "standalone-env", "python.exe"),
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));

    expect(plan).not.toHaveProperty("error");
    if ("error" in plan) return;
    expect(plan.cmd).toBe(path.join(root, "standalone-env", "python.exe"));
    expect(plan.mainPy).toBe(path.join(root, "ComfyUI", "main.py"));
    expect(plan.cwd).toBe(path.join(root, "ComfyUI"));
  });

  it("桌面版源码根：配置指向 ComfyUI/ 源码，解释器在父级实例根 standalone-env", () => {
    const srcDir = path.resolve("/comfy/instances/ComfyUI2/ComfyUI");
    const instRoot = path.dirname(srcDir);
    const fsSet = fakeFs(
      srcDir,
      path.join(srcDir, "main.py"),
      path.join(instRoot, "standalone-env", "python.exe"),
    );
    const plan = resolveComfyLaunchPlan(srcDir, makeExists(fsSet));

    expect(plan).not.toHaveProperty("error");
    if ("error" in plan) return;
    expect(plan.cmd).toBe(path.join(instRoot, "standalone-env", "python.exe"));
    expect(plan.mainPy).toBe(path.join(srcDir, "main.py"));
  });

  it("venv 布局：.venv/Scripts/python.exe + main.py", () => {
    const root = path.resolve("/comfy/venv");
    const fsSet = fakeFs(
      root,
      path.join(root, "main.py"),
      path.join(root, ".venv", "Scripts", "python.exe"),
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));

    expect(plan).not.toHaveProperty("error");
    if ("error" in plan) return;
    expect(plan.cmd).toBe(path.join(root, ".venv", "Scripts", "python.exe"));
  });

  it("桌面版 vendor 构建：ComfyUI/.venv 优先于 standalone-env", () => {
    const root = path.resolve("/comfy/vendor");
    const fsSet = fakeFs(
      root,
      path.join(root, "ComfyUI", "main.py"),
      path.join(root, "ComfyUI", ".venv", "Scripts", "python.exe"),
      path.join(root, "standalone-env", "python.exe"),
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));

    expect(plan).not.toHaveProperty("error");
    if ("error" in plan) return;
    // .venv 排在 standalone-env 之前（vendor 构建的 torch 在 .venv 里）
    expect(plan.cmd).toBe(
      path.join(root, "ComfyUI", ".venv", "Scripts", "python.exe"),
    );
  });

  it("桌面版 Desktop 实例（.comfyui-desktop-2 标记）：standalone-env 优先于 .venv", () => {
    const root = path.resolve("/comfy/instances/ComfyUI2");
    const fsSet = fakeFs(
      root,
      path.join(root, ".comfyui-desktop-2"),
      path.join(root, "manifest.json"),
      path.join(root, "ComfyUI", "main.py"),
      path.join(root, "ComfyUI", ".venv", "Scripts", "python.exe"),
      path.join(root, "standalone-env", "python.exe"),
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));

    expect(plan).not.toHaveProperty("error");
    if ("error" in plan) return;
    // Desktop 实例 canonical 运行时是 standalone-env，即使源码内 .venv 存在也优先
    expect(plan.cmd).toBe(path.join(root, "standalone-env", "python.exe"));
    expect(plan.mainPy).toBe(path.join(root, "ComfyUI", "main.py"));
    // 两个候选都没装 torch（夹具无 site-packages/torch）→ hasDeps=false 标记
    expect(plan.hasDeps).toBe(false);
  });

  it("桌面实例 standalone-env 缺依赖、ComfyUI/.venv 带 torch → 跳过空壳选 .venv", () => {
    // 用户实际案例：桌面实例 dual 环境里，standalone-env 是未装依赖的空壳，
    // torch 在 ComfyUI/.venv——固定优先级会选中空壳导致
    // ModuleNotFoundError: No module named 'torch' 秒退。
    const root = path.resolve("/comfy/instances/ComfyUI2");
    const fsSet = fakeFs(
      root,
      path.join(root, ".comfyui-desktop-2"),
      path.join(root, "manifest.json"),
      path.join(root, "ComfyUI", "main.py"),
      path.join(root, "ComfyUI", ".venv", "Scripts", "python.exe"),
      path.join(root, "ComfyUI", ".venv", "Lib", "site-packages", "torch"),
      path.join(root, "standalone-env", "python.exe"),
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));

    expect(plan).not.toHaveProperty("error");
    if ("error" in plan) return;
    expect(plan.cmd).toBe(
      path.join(root, "ComfyUI", ".venv", "Scripts", "python.exe"),
    );
    expect(plan.hasDeps).toBe(true);
  });

  it("桌面实例 standalone-env 带 torch → 仍优先 standalone-env（老布局不变）", () => {
    const root = path.resolve("/comfy/instances/ComfyUI2");
    const fsSet = fakeFs(
      root,
      path.join(root, ".comfyui-desktop-2"),
      path.join(root, "manifest.json"),
      path.join(root, "ComfyUI", "main.py"),
      path.join(root, "ComfyUI", ".venv", "Scripts", "python.exe"),
      path.join(root, "standalone-env", "python.exe"),
      path.join(root, "standalone-env", "Lib", "site-packages", "torch"),
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));

    expect(plan).not.toHaveProperty("error");
    if ("error" in plan) return;
    expect(plan.cmd).toBe(path.join(root, "standalone-env", "python.exe"));
    expect(plan.hasDeps).toBe(true);
  });

  it("路径不存在：返回错误", () => {
    const plan = resolveComfyLaunchPlan("/not/exist", makeExists(fakeFs()));
    expect(plan).toHaveProperty("error");
  });

  it("有 main.py 但无解释器：返回错误", () => {
    const root = path.resolve("/comfy/no-py");
    const fsSet = fakeFs(root, path.join(root, "main.py"));
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));
    expect(plan).toHaveProperty("error");
    const err = (plan as { error: string }).error;
    // 文案要同时点出 Windows 与 POSIX 两种布局，用户才知道该配什么。
    expect(err).toContain("Python 解释器");
    expect(err).toContain(".venv/bin/python");
  });

  /* ── Web-only Linux 模式：POSIX 布局 ──────────────────────────────
   * 历史实现在这一组上全绿失败：10 处 python.exe、6 处 Scripts，一个
   * `bin/python` 候选都没有 —— Linux 上标准 venv 安装会被判「找不到
   * 可用的 python.exe」。 */
  it("Linux venv：.venv/bin/python + main.py 同层（POSIX 布局）", () => {
    const root = path.resolve("/srv/ComfyUI");
    const fsSet = fakeFs(
      root,
      path.join(root, "main.py"),
      path.join(root, ".venv", "bin", "python"),
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));
    expect(plan).not.toHaveProperty("error");
    expect((plan as { cmd: string }).cmd).toBe(
      path.join(root, ".venv", "bin", "python"),
    );
  });

  it("Linux venv 优先 bin/python3（POSIX 只保证 python3 存在）", () => {
    const root = path.resolve("/srv/ComfyUI3");
    const fsSet = fakeFs(
      root,
      path.join(root, "main.py"),
      path.join(root, ".venv", "bin", "python3"),
      path.join(root, ".venv", "bin", "python"),
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));
    expect((plan as { cmd: string }).cmd).toBe(
      path.join(root, ".venv", "bin", "python3"),
    );
  });

  it("Linux venv：torch 装在 lib/python3.12/site-packages 也认（不是 Lib/site-packages）", () => {
    const root = path.resolve("/srv/ComfyUI-torch");
    const envRoot = path.join(root, ".venv");
    const sp = path.join(envRoot, "lib", "python3.12", "site-packages");
    // 需要把中间目录也列进去：依赖目录链是逐级 exists 探到的，只声明叶子
    // 会让 site-packages 本身判为不存在（真实 fs 上不会出现这种状态）。
    const fsSet = fakeFs(
      root,
      path.join(root, "main.py"),
      path.join(envRoot, "bin"),
      path.join(envRoot, "bin", "python"),
      path.join(envRoot, "bin", "python3"),
      path.join(envRoot, "lib"),
      path.join(envRoot, "lib", "python3.12"),
      sp,
      path.join(sp, "torch"),
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));
    // 选中带 torch 的 .venv（依赖判据认 POSIX 的 lib/python3.x/site-packages）
    expect((plan as { cmd: string; hasDeps?: boolean }).cmd).toBe(
      path.join(envRoot, "bin", "python3"),
    );
    expect((plan as { hasDeps?: boolean }).hasDeps).toBe(true);
  });

  it("Linux venv 无 torch：仍返回解释器，但 hasDeps=false（交由调用方提示装依赖）", () => {
    const root = path.resolve("/srv/ComfyUI-nodeps");
    const envRoot = path.join(root, ".venv");
    const fsSet = fakeFs(
      root,
      path.join(root, "main.py"),
      path.join(envRoot, "bin", "python"),
    );
    const plan = resolveComfyLaunchPlan(root, makeExists(fsSet));
    expect(plan).not.toHaveProperty("error");
    expect((plan as { hasDeps?: boolean }).hasDeps).toBe(false);
  });
});
