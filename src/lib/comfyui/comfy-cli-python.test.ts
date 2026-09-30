import { describe, expect, it } from "vitest";

import { comfyCliInterpreter, comfyCliMissingHint } from "./comfy-cli-python";

/**
 * comfy-cli 解释器的落点与「找不到」的提示（ISSUE #1239）。
 *
 * 签的口径是**与 `comfyuiPath` 同形**：桌包不随包 Python，用户自备后在设置页指路径。
 * 所以这里钉两件事：① 优先级（设置项 > 项目根 venv），它决定「设了环境变量的老用法」
 * 与「桌包只填设置项」两条路都通；② 提示按形态分叉——给桌包用户看 `pip install`
 * 等于没给出口（与 #1216 里那句「执行 pnpm db:push」同一种错）。
 */
describe("comfyCliInterpreter：设置项优先，留空退回项目根 venv", () => {
  it("设置项给了就用它，并 trim 掉首尾空白", () => {
    expect(
      comfyCliInterpreter(
        "  D:\\tools\\py\\python.exe  ",
        "C:\\ignored",
        "win32",
      ),
    ).toBe("D:\\tools\\py\\python.exe");
  });

  it("留空 / 未给 / 只有空白 → 退回 <cwd>/python-venv/comfy-cli 的平台落点", () => {
    // 「只有空白」这一档不是凑数：设置页里清空输入框提交的就是空串或空白，
    // 判成「已配置」会让执行链去 spawn 一个不存在的路径。
    for (const blank of ["", "   ", undefined]) {
      expect(
        comfyCliInterpreter(blank, "D:\\apps\\ComfyAPP", "win32"),
        `win32 / ${JSON.stringify(blank)}`,
      ).toBe("D:\\apps\\ComfyAPP\\python-venv\\comfy-cli\\Scripts\\python.exe");
      expect(
        comfyCliInterpreter(blank, "/opt/app", "linux"),
        `linux / ${JSON.stringify(blank)}`,
      ).toBe("/opt/app/python-venv/comfy-cli/bin/python");
    }
  });
});

describe("comfyCliMissingHint：按形态给可执行的出口", () => {
  it("桌包（非检出）：指设置页，不给开发者命令", () => {
    const hint = comfyCliMissingHint({ inCheckout: false, platform: "win32" });
    expect(hint).toContain("设置 → 创作后端 → comfy-cli 解释器");
    expect(hint).toContain("重试");
    // 这些在装好的桌包里都不成立：给出来就是把开发者出口当用户出口
    expect(hint).not.toMatch(/-m venv|pip install|COMFY_CLI_PYTHON/);
  });

  it("开发检出：保留 venv + pip 三条命令，并同时说出另两条出口", () => {
    const win = comfyCliMissingHint({ inCheckout: true, platform: "win32" });
    expect(win).toContain("python -m venv python-venv\\comfy-cli");
    expect(win).toContain("Scripts\\python.exe -m pip install comfy-cli");
    expect(win).toContain("COMFY_CLI_PYTHON");
    const nix = comfyCliMissingHint({ inCheckout: true, platform: "linux" });
    expect(nix).toContain("python3 -m venv python-venv/comfy-cli");
    expect(nix).toContain("comfy-cli/bin/python -m pip install comfy-cli");
    expect(nix).not.toContain("python-venv\\");
  });
});
